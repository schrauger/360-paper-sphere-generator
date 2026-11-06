import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotationFromYPR, yprFromRotation, mul, transpose, apply, rotZ,
  orthonormalize, directionToEquirect, equirectToDirection,
} from '../../src/sphere/orient.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const nearVec = (a, b, tol = 1e-12) => a.forEach((x, i) => near(x, b[i], tol, `[${i}]`));
const maxDiff = (A, B) => Math.max(...Array.from(A, (x, i) => Math.abs(x - B[i])));
const I = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('identity at 0/0/0', () => {
  const M = rotationFromYPR({ yaw: 0, pitch: 0, roll: 0 });
  assert.ok(M instanceof Float64Array && M.length === 9);
  assert.ok(maxDiff(M, I) <= 1e-15);
});

test('yaw 90 maps +x to +y', () => {
  nearVec(apply(rotationFromYPR({ yaw: 90, pitch: 0, roll: 0 }), [1, 0, 0]), [0, 1, 0], 1e-15);
});

test('pitch 90 maps +x to -z', () => {
  nearVec(apply(rotationFromYPR({ yaw: 0, pitch: 90, roll: 0 }), [1, 0, 0]), [0, 0, -1], 1e-15);
});

test('roll 90 maps +y to +z', () => {
  nearVec(apply(rotationFromYPR({ yaw: 0, pitch: 0, roll: 90 }), [0, 1, 0]), [0, 0, 1], 1e-15);
});

test('mul, transpose and rotZ compose consistently', () => {
  const M = rotationFromYPR({ yaw: 30, pitch: 20, roll: 10 });
  assert.ok(maxDiff(mul(M, transpose(M)), I) <= 1e-15);
  nearVec(apply(rotZ(Math.PI / 2), [1, 0, 0]), [0, 1, 0], 1e-15);
});

test('yprFromRotation round-trips 1000 random angles with |pitch| < 89.9', () => {
  const r = rng(1);
  for (let i = 0; i < 1000; i++) {
    const ypr = { yaw: r() * 360 - 180, pitch: (r() * 2 - 1) * 89.9, roll: r() * 360 - 180 };
    const M = rotationFromYPR(ypr);
    const back = yprFromRotation(M);
    assert.ok(back.pitch >= -90 && back.pitch <= 90);
    assert.ok(maxDiff(rotationFromYPR(back), M) <= 1e-9);
  }
});

test('gimbal lock: pitch +-90 gives angles that rebuild the same matrix', () => {
  const r = rng(2);
  for (const pitch of [90, -90]) {
    for (let i = 0; i < 50; i++) {
      const M = rotationFromYPR({ yaw: r() * 360 - 180, pitch, roll: r() * 360 - 180 });
      const back = yprFromRotation(M);
      assert.ok(Object.values(back).every(Number.isFinite));
      assert.equal(back.roll, 0);
      assert.ok(maxDiff(rotationFromYPR(back), M) <= 1e-9);
    }
  }
  // Slightly beyond 1 from float error must not give NaN.
  const M = rotationFromYPR({ yaw: 10, pitch: 90, roll: 0 });
  M[6] = -1.0000000000000002;
  assert.ok(Number.isFinite(yprFromRotation(M).pitch));
});

test('equirect: +x -> (W/2, H/2); +z -> v = 0; lon -pi -> u = 0', () => {
  const W = 400, H = 200;
  const [u, v] = directionToEquirect([1, 0, 0], W, H);
  near(u, W / 2, 1e-9); near(v, H / 2, 1e-9);
  near(directionToEquirect([0, 0, 1], W, H)[1], 0, 1e-9);
  near(directionToEquirect([0, 0, -1], W, H)[1], H, 1e-9);
  const [u2] = directionToEquirect([-1, -0, 0], W, H);
  near(u2, 0, 1e-9);
  const [u3] = directionToEquirect([-1, 1e-12, 0], W, H);
  assert.ok(u3 >= 0 && u3 < W);
  nearVec(equirectToDirection(W / 2, H / 2, W, H), [1, 0, 0], 1e-12);
});

test('equirectToDirection o directionToEquirect is identity on 1000 random unit vectors', () => {
  const r = rng(3);
  const W = 5700, H = 2850;
  for (let i = 0; i < 1000; i++) {
    const z = r() * 2 - 1, lon = r() * 2 * Math.PI - Math.PI, s = Math.sqrt(1 - z * z);
    const d = [s * Math.cos(lon), s * Math.sin(lon), z];
    const [u, v] = directionToEquirect(d, W, H);
    assert.ok(u >= 0 && u < W && v >= 0 && v <= H);
    nearVec(equirectToDirection(u, v, W, H), d, 1e-12);
  }
});

test('orthonormalize returns M*Mt = I within 1e-12 for a perturbed rotation', () => {
  const r = rng(4);
  const M = rotationFromYPR({ yaw: 40, pitch: -25, roll: 70 });
  const P = Float64Array.from(M, (x) => x + (r() - 0.5) * 1e-3);
  const O = orthonormalize(P);
  assert.ok(maxDiff(mul(O, transpose(O)), I) <= 1e-12);
  assert.ok(maxDiff(O, M) < 5e-3);
});
