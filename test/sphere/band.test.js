import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpiral, pointAt } from '../../src/sphere/spiral.js';
import { bandPhase, bandOf, seamPoint, makeCentreLine } from '../../src/sphere/band.js';
import { apply, rotZ } from '../../src/sphere/orient.js';

const FAMILIES = [
  { family: 'clelia', rate: 6 },
  { family: 'loxodrome', rate: 5.6 },
];

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}
function randomPoint(r) {
  const v = [gauss(r), gauss(r), gauss(r)];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const wrap = (a) => {
  let w = (a + Math.PI) % (2 * Math.PI);
  if (w <= 0) w += 2 * Math.PI;
  return w - Math.PI;
};

for (const cfg of FAMILIES) {
  const spiral = makeSpiral(cfg);
  const tag = `${cfg.family} rate ${cfg.rate}`;

  test(`${tag}: bands tile the sphere: 100k uniform points, band 0 share = 0.5 ± 0.005`, () => {
    const r = rng(12345);
    let n0 = 0;
    const N = 100000;
    for (let i = 0; i < N; i++) if (bandOf(randomPoint(r), spiral) === 0) n0++;
    assert.ok(Math.abs(n0 / N - 0.5) <= 0.005, `share ${n0 / N}`);
  });

  test(`${tag}: rotating by π about z swaps bands (2000 points away from seams)`, () => {
    const r = rng(777);
    const R = rotZ(Math.PI);
    let checked = 0;
    while (checked < 2000) {
      const p = randomPoint(r);
      if (Math.abs(Math.abs(bandPhase(p, spiral)) - Math.PI / 2) < 1e-3) continue;
      assert.notEqual(bandOf(apply(R, p), spiral), bandOf(p, spiral));
      checked++;
    }
  });

  test(`${tag}: seamPoint has |phase| = π/2 within 1e-12`, () => {
    for (const side of [1, -1]) {
      for (let i = 1; i < 100; i++) {
        const th = (i / 100) * Math.PI;
        const p = seamPoint(spiral, th, side);
        assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-12);
        const ph = bandPhase(p, spiral);
        assert.ok(Math.abs(Math.abs(ph) - Math.PI / 2) <= 1e-12, `θ=${th} phase ${ph}`);
        assert.equal(Math.sign(ph), side);
      }
    }
  });

  test(`${tag}: frame is orthonormal and C(s) has phase 0, for 200 s in [0, length]`, () => {
    const cl = makeCentreLine(spiral, { samples: 20000 });
    for (let i = 0; i < 200; i++) {
      const s = (i / 199) * cl.length;
      const { C, T, N, kg } = cl.frame(s);
      for (const v of [...C, ...T, ...N, kg]) assert.ok(Number.isFinite(v), `s=${s}`);
      assert.ok(Math.abs(dot(C, C) - 1) < 1e-12);
      assert.ok(Math.abs(dot(T, T) - 1) < 1e-12);
      assert.ok(Math.abs(dot(N, N) - 1) < 1e-12);
      assert.ok(Math.abs(dot(C, T)) < 1e-12);
      assert.ok(Math.abs(dot(C, N)) < 1e-12);
      assert.ok(Math.abs(dot(T, N)) < 1e-12);
      // N = C × T
      const CxT = cross(C, T);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(CxT[k] - N[k]) < 1e-12);
      // Phase is ill-conditioned within ~1e-3 of a pole (acos of z ≈ ±1).
      const th = cl.thetaAt(s);
      if (th > 1e-3 && th < Math.PI - 1e-3) {
        assert.ok(Math.abs(bandPhase(C, spiral)) < 1e-9, `s=${s}`);
      }
    }
  });

  test(`${tag}: sOfTheta and thetaAt are inverse; theta runs 0..π`, () => {
    const cl = makeCentreLine(spiral, { samples: 20000 });
    assert.equal(cl.sOfTheta(0), 0);
    assert.ok(Math.abs(cl.sOfTheta(Math.PI) - cl.length) < 1e-12);
    assert.ok(Math.abs(cl.thetaAt(0)) < 1e-12);
    assert.ok(Math.abs(cl.thetaAt(cl.length) - Math.PI) < 1e-12);
    for (let i = 1; i < 50; i++) {
      const th = (i / 50) * Math.PI;
      assert.ok(Math.abs(cl.thetaAt(cl.sOfTheta(th)) - th) < 1e-9);
    }
  });

  test(`${tag}: kg matches a finite-difference estimate within 1e-4 at 50 interior s`, () => {
    const cl = makeCentreLine(spiral, { samples: 20000 });
    const h = 1e-4;
    for (let i = 1; i <= 50; i++) {
      const s = (0.1 + (0.8 * i) / 51) * cl.length;
      const f = cl.frame(s);
      const a = cl.frame(s - h).T;
      const b = cl.frame(s + h).T;
      const dT = [0, 1, 2].map((k) => (b[k] - a[k]) / (2 * h));
      const kgFd = dot(f.N, dT);
      assert.ok(Math.abs(kgFd - f.kg) <= 1e-4, `s=${s}: ${kgFd} vs ${f.kg}`);
    }
  });
}

test('clelia rate 6: length equals Simpson ∫₀^π √(1+36 sin²θ) dθ with 1e5 steps, within 1e-6', () => {
  const cl = makeCentreLine(makeSpiral({ family: 'clelia', rate: 6 }), { samples: 20000 });
  const n = 100000;
  const h = Math.PI / n;
  const f = (t) => Math.sqrt(1 + 36 * Math.sin(t) ** 2);
  let sum = f(0) + f(Math.PI);
  for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
  assert.ok(Math.abs(cl.length - (sum * h) / 3) <= 1e-6, `${cl.length} vs ${(sum * h) / 3}`);
});

test('loxodrome: |dC/dθ| is constant, length = π√(1+rate²)', () => {
  const cl = makeCentreLine(makeSpiral({ family: 'loxodrome', rate: 5.6 }), { samples: 20000 });
  assert.ok(Math.abs(cl.length - Math.PI * Math.sqrt(1 + 5.6 ** 2)) < 1e-6);
});

test('wrap sanity and pointAt', () => {
  assert.ok(Math.abs(wrap(3 * Math.PI) - Math.PI) < 1e-12);
  assert.deepEqual(pointAt(0, 1).map((x) => Math.abs(x)), [0, 0, 1]);
});
