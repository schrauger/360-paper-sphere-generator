import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSpiral } from '../../src/sphere/spiral.js';
import { bandOf, makeCentreLine } from '../../src/sphere/band.js';
import { makeUnrolling } from '../../src/sphere/develop.js';

// Clelia rate 6 only (ruling R9). Every test covers the full band, tips included (ruling R10).
// Transverse rule (ruling R15): strip (s, d) ↦ c(s) + tan d·n(s), tip cell (ρ, α) ↦ c(tip) +
// tan ρ·(cos α·t + sin α·n) + δ: the band projected centrally onto the tangent developable along C.
const FAMILIES = [{ family: 'clelia', rate: 6 }];
// Tip cells: measured ranges of the principal stretches in band 0 ([0.9988, 1.0570]) and over
// band + bleed ([0.851, 1.089], the low end in the bleed next to the tip end), from the task-5
// report, fix round 2; pinned so a regression shows up. Strip cells have exact model bounds (below).
const STRETCH_TIP_BAND = [0.99, 1.07];
const STRETCH_TIP = [0.84, 1.1];
const BLEED = 0.035; // R: 360craft's bleed (25–35 px at original-high), the tip correction's reach

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
// Uniform point within geodesic distance `cap` of the pole `z` (±1).
function pointNearPole(r, z, cap) {
  const c = 1 - (1 - Math.cos(cap)) * r();
  const s = Math.sqrt(1 - c * c);
  const l = 2 * Math.PI * r();
  return [s * Math.cos(l), s * Math.sin(l), z * c];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrap = (a) => {
  let w = (a + Math.PI) % (2 * Math.PI);
  if (w <= 0) w += 2 * Math.PI;
  return w - Math.PI;
};
function insidePolygon(poly, [x, y]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a / 2);
}
const sameStripPoint = (a, b, tol) =>
  a.cell === b.cell &&
  (a.cell === 'strip'
    ? Math.abs(a.s - b.s) < tol && Math.abs(a.d - b.d) < tol
    : Math.abs(a.rho - b.rho) < tol && Math.abs(wrap(a.alpha - b.alpha)) * Math.max(a.rho, 1e-3) < tol);

for (const cfg of FAMILIES) {
  const spiral = makeSpiral(cfg);
  const cl = makeCentreLine(spiral);
  const un = makeUnrolling(spiral, cl);
  const L = cl.length;
  const tag = `${cfg.family} ${cfg.rate}`;
  const outline = (() => {
    const { pos, neg } = un.seams(0.002);
    return [...pos, ...neg.slice(1, -1).reverse()];
  })();
  // Band-0 points: half uniform over the sphere, half within 0.6 rad of a pole (the tips).
  const bandPoints = (seed, n) => {
    const r = rng(seed);
    const out = [];
    while (out.length < n) {
      const p = out.length % 2 ? randomPoint(r) : pointNearPole(r, r() < 0.5 ? 1 : -1, 0.6);
      if (bandOf(p, spiral) === 0) out.push(p);
    }
    return out;
  };

  test(`${tag}: flat centre line preserves arc length: |toFlat(s+h,0) − toFlat(s,0)| = h within 1e-9 (h = 1e-4), whole length`, () => {
    const r = rng(1);
    const h = 1e-4;
    for (let i = 0; i < 1000; i++) {
      const s = i < 20 ? (i * h) / 2 : i < 40 ? L - h - ((i - 20) * h) / 2 : (L - h) * r();
      const a = un.toFlat(s, 0);
      const b = un.toFlat(s + h, 0);
      assert.ok(Math.abs(dist2(a, b) - h) < 1e-9, `s=${s}`);
    }
  });

  test(`${tag}: flat heading change over [s, s+h] equals ∫kg within 1e-8, whole length`, () => {
    const r = rng(2);
    const h = 0.01;
    const heading = (s) => {
      const t = un.flatFrame(s).t;
      return Math.atan2(t[1], t[0]);
    };
    assert.deepEqual(un.flatFrame(0).c, [0, 0]);
    assert.ok(Math.abs(heading(0)) < 1e-12);
    for (let i = 0; i < 300; i++) {
      const s = i < 10 ? i * h : i < 20 ? L - h - (i - 10) * h : (L - h) * r();
      const M = 40; // composite Simpson on analytic kg
      let sum = cl.frame(s).kg + cl.frame(s + h).kg;
      for (let k = 1; k < M; k++) sum += cl.frame(s + (k * h) / M).kg * (k % 2 ? 4 : 2);
      const integral = (sum * h) / M / 3;
      assert.ok(Math.abs(wrap(heading(s + h) - heading(s)) - integral) < 1e-8, `s=${s}`);
    }
  });

  test(`${tag}: toSphere(s, 0) = C(s), and |toSphere| = 1`, () => {
    const r = rng(3);
    for (let i = 0; i < 300; i++) {
      const s = L * r();
      const C = cl.frame(s).C;
      const p0 = un.toSphere(s, 0);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(p0[k] - C[k]) < 1e-12);
      const p = un.toSphere(s, (r() - 0.5) * 3);
      assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-12);
    }
  });

  test(`${tag}: transverse rule: toFlat(s, d) = c(s) + tan d·n(s) (d = sphere geodesic offset); a tip's normal rays at tan ρ`, () => {
    const r = rng(31);
    for (let i = 0; i < 500; i++) {
      const s = i < 10 ? 0 : i < 20 ? L : L * r();
      const d = (r() - 0.5) * 0.9;
      const { c, n } = un.flatFrame(s);
      const want = [c[0] + Math.tan(d) * n[0], c[1] + Math.tan(d) * n[1]];
      assert.ok(dist2(un.toFlat(s, d), want) < 1e-12, `s=${s} d=${d}`);
      assert.ok(dist2(un.stripToFlat({ cell: 'strip', s, d }), want) < 1e-12);
    }
    // The tip cell meets the s = 0 / L strip cell on the tip's normal rays (α = ±π/2), with no
    // correction there: c(tip) ± tan ρ·n(tip).
    for (const [cell, s] of [['tipN', 0], ['tipS', L]]) {
      for (let i = 0; i < 100; i++) {
        const rho = 0.5 * r();
        for (const sign of [1, -1]) {
          const q = un.stripToFlat({ cell, s, d: NaN, rho, alpha: (sign * Math.PI) / 2 });
          assert.ok(dist2(q, un.toFlat(s, sign * rho)) < 1e-12, `${cell} rho=${rho} sign=${sign}`);
        }
      }
    }
  });

  test(`${tag}: isometric along the centre line: |∂toSphere/∂s| = |∂toSphere/∂d| = 1 at d = 0 within 1e-6, whole length`, () => {
    const r = rng(4);
    // band.js holds C(0) and C(L) 1e-9 off the poles (its pole nudge), so the stencil keeps
    // one step clear of the end points.
    const e = 1e-5;
    for (let i = 0; i < 300; i++) {
      const s = 2 * e + (L - 4 * e) * (i < 10 ? i / 1e4 : i < 20 ? 1 - (i - 10) / 1e4 : r());
      const along = dist3(un.toSphere(s + e, 0), un.toSphere(s - e, 0)) / (2 * e);
      const across = dist3(un.toSphere(s, e), un.toSphere(s, -e)) / (2 * e);
      assert.ok(Math.abs(along - 1) < 1e-6 && Math.abs(across - 1) < 1e-6, `s=${s}: ${along}, ${across}`);
      const flatAlong = dist2(un.toFlat(s + e, 0), un.toFlat(s - e, 0)) / (2 * e);
      const flatAcross = dist2(un.toFlat(s, e), un.toFlat(s, -e)) / (2 * e);
      assert.ok(Math.abs(flatAlong - 1) < 1e-6 && Math.abs(flatAcross - 1) < 1e-6, `s=${s}: flat ${flatAlong}, ${flatAcross}`);
    }
  });

  test(`${tag}: sphereToStrip is the closest-point chart: strip feet are the global nearest point of C, tip cells only behind a tip`, () => {
    // Brute force over a fine sampling of C (step 2e-4): no sample is nearer than the
    // reported foot (distance tolerance 1e-7).
    const M = Math.ceil(L / 2e-4);
    const Cs = Array.from({ length: M + 1 }, (_, i) => cl.frame((L * i) / M).C);
    for (const p of bandPoints(5, 1500)) {
      const pt = un.sphereToStrip(p);
      assert.ok(pt.ok, `p=${p}`);
      let best = -2;
      for (const C of Cs) best = Math.max(best, dot(p, C));
      const nearest = Math.acos(Math.min(1, best));
      const q = un.stripToSphere(pt);
      assert.ok(dist3(q, p) < 1e-9, `stripToSphere ∘ sphereToStrip: p=${p} → ${JSON.stringify(pt)}`);
      const reported = pt.cell === 'strip' ? Math.abs(pt.d) : pt.rho;
      assert.ok(reported <= nearest + 1e-7, `p=${p}: ${pt.cell} at ${reported} but C is ${nearest} away`);
      if (pt.cell === 'strip') {
        assert.ok(pt.s >= 0 && pt.s <= L);
        assert.ok(Math.abs(dot(p, cl.frame(pt.s).T)) < 1e-9, 'foot is a critical point');
      } else {
        const tipS = pt.cell === 'tipN' ? 0 : L;
        assert.equal(pt.s, tipS);
        const T = cl.frame(tipS).T;
        assert.ok((pt.cell === 'tipN' ? -1 : 1) * dot(p, T) > 0, 'tip cells lie behind the tip');
      }
    }
  });

  test(`${tag}: both tip cells occur, at both poles`, () => {
    const cells = new Set(bandPoints(6, 4000).map((p) => un.sphereToStrip(p).cell));
    assert.deepEqual([...cells].sort(), ['strip', 'tipN', 'tipS']);
  });

  test(`${tag}: sphereToStrip ∘ toSphere recovers (s, d) within 1e-9 for strip points`, () => {
    let n = 0;
    for (const p of bandPoints(7, 2000)) {
      const pt = un.sphereToStrip(p);
      if (pt.cell !== 'strip') continue;
      n++;
      const again = un.sphereToStrip(un.toSphere(pt.s, pt.d), pt.s + 0.01);
      assert.ok(sameStripPoint(again, pt, 1e-9), `${JSON.stringify(pt)} → ${JSON.stringify(again)}`);
    }
    assert.ok(n > 1800, `${n} strip points`);
  });

  test(`${tag}: flatToStrip ∘ stripToFlat recovers the strip point within 1e-9 (2000 band points incl. tips; with and without sGuess)`, () => {
    const r = rng(8);
    for (const p of bandPoints(8, 2000)) {
      const pt = un.sphereToStrip(p);
      const q = un.stripToFlat(pt);
      const guess = Math.min(L, Math.max(0, pt.s + (r() - 0.5) * 0.02));
      for (const out of [un.flatToStrip(q[0], q[1], guess), un.flatToStrip(q[0], q[1])]) {
        assert.ok(out.ok, `q=${q}`);
        assert.ok(sameStripPoint(out, pt, 1e-9), `${JSON.stringify(pt)} → ${JSON.stringify(out)}`);
      }
    }
  });

  test(`${tag}: round trip flat → sphere → flat within 0.01 px at 994 px/R, over the whole piece (tips sampled densely)`, () => {
    const r = rng(9);
    const PX = 994;
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const tips = [un.flatFrame(0).c, un.flatFrame(L).c];
    let n = 0;
    let worst = 0;
    while (n < 6000) {
      const q =
        n % 2
          ? [x0 + (x1 - x0) * r(), y0 + (y1 - y0) * r()]
          : (() => {
              const c = tips[n % 4 === 0 ? 0 : 1];
              return [c[0] + (r() - 0.5) * 1.2, c[1] + (r() - 0.5) * 1.2];
            })();
      if (!insidePolygon(outline, q)) continue;
      n++;
      const pt = un.flatToStrip(q[0], q[1]);
      assert.ok(pt.ok, `q=${q}`);
      const back = un.stripToFlat(un.sphereToStrip(un.stripToSphere(pt)));
      const err = dist2(back, q) * PX;
      worst = Math.max(worst, err);
      assert.ok(err < 0.01, `q=${q}: ${JSON.stringify(pt)} comes back ${err} px away`);
    }
    assert.ok(worst < 0.01);
  });

  // T9 renders a raster and feeds each pixel the previous pixel's s as the guess, including guesses
  // from a tip cell (s = 0 / L) or from across the medial axis. Every answer must equal the
  // unguided one, and every ok = true answer must be a consistent preimage: it maps back to the
  // query and is the closest-point record of its own sphere point. Covers the tips out to 0.6 R,
  // i.e. band 0, the bleed and the band-1 surroundings where no consistent preimage may exist.
  test(`${tag}: flatToStrip raster-style (previous pixel's s as guess) round both tips: same as unguided, ok = true only for consistent answers`, () => {
    const STEP = 1 / 150;
    const HALF = 0.6;
    const cells = new Set();
    let okCount = 0;
    let notOk = 0;
    for (const s0 of [0, L]) {
      const c0 = un.flatFrame(s0).c;
      for (let y = c0[1] - HALF; y <= c0[1] + HALF; y += STEP) {
        let guess;
        for (let x = c0[0] - HALF; x <= c0[0] + HALF; x += STEP) {
          const a = un.flatToStrip(x, y, guess);
          const b = un.flatToStrip(x, y);
          guess = a.s;
          assert.equal(a.ok, b.ok, `(${x}, ${y}) guess vs none: ${JSON.stringify(a)} ${JSON.stringify(b)}`);
          if (!a.ok) {
            notOk++;
            continue;
          }
          okCount++;
          cells.add(a.cell);
          assert.ok(sameStripPoint(a, b, 1e-9), `(${x}, ${y}): ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
          assert.ok(dist2(un.stripToFlat(a), [x, y]) < 1e-9, `(${x}, ${y}) does not map back: ${JSON.stringify(a)}`);
          const again = un.sphereToStrip(un.stripToSphere(a), a.s);
          assert.ok(sameStripPoint(again, a, 1e-8), `(${x}, ${y}): ${JSON.stringify(a)} is not closest-point: ${JSON.stringify(again)}`);
        }
      }
    }
    assert.deepEqual([...cells].sort(), ['strip', 'tipN', 'tipS']);
    assert.ok(okCount > 40000 && notOk > 0, `${okCount} ok, ${notOk} not ok`);
  });

  test(`${tag}: flatToStrip reports ok = false far from the piece`, () => {
    for (const [x, y] of [[1e6, 1e6], [-50, 3], [0, 40]]) {
      const out = un.flatToStrip(x, y, L / 2);
      assert.equal(out.ok, false);
      for (const v of [out.s, out.d]) assert.ok(Number.isFinite(v));
    }
  });

  test(`${tag}: no gaps or overlaps: band-0 sphere points map inside the flat outline, nearby band-1 points outside`, () => {
    const r = rng(10);
    let n0 = 0;
    let n1 = 0;
    while (n0 + n1 < 20000) {
      const p = (n0 + n1) % 2 ? randomPoint(r) : pointNearPole(r, r() < 0.5 ? 1 : -1, 0.6);
      const e = un.edgeDistance(p);
      if (Math.abs(e) < 1e-6 || e < -0.1) continue;
      const q = un.stripToFlat(un.sphereToStrip(p));
      const inside = insidePolygon(outline, q);
      if (e > 0) n0++;
      else n1++;
      assert.equal(inside, e > 0, `p=${p} edgeDistance ${e} → q=${q} inside=${inside}`);
    }
    assert.ok(n1 > 1000);
  });

  test(`${tag}: edgeDistance is a signed distance to the band edge: 0 on the seams, + in band 0, slope 1`, () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const s = L * r();
      const C = cl.frame(s).C;
      for (const p of [[-C[1], C[0], C[2]], [C[1], -C[0], C[2]]]) assert.ok(Math.abs(un.edgeDistance(p)) < 1e-12);
    }
    for (const p of bandPoints(12, 3000)) {
      const e = un.edgeDistance(p);
      assert.ok(e > 0);
      // Slope: moving by h along the steepest direction changes it by h (first order).
      const h = 1e-6;
      const z = [0, 0, 1];
      const east = [-p[1], p[0], 0];
      const ne = Math.hypot(...east);
      if (ne < 1e-3) continue;
      const north = [z[0] - p[2] * p[0], z[1] - p[2] * p[1], z[2] - p[2] * p[2]];
      const nn = Math.hypot(...north);
      const move = (v, k) => [p[0] + (h * k * v[0]), p[1] + (h * k * v[1]), p[2] + (h * k * v[2])];
      const ge = (un.edgeDistance(move(east, 1 / ne)) - un.edgeDistance(move(east, -1 / ne))) / (2 * h);
      const gn = (un.edgeDistance(move(north, 1 / nn)) - un.edgeDistance(move(north, -1 / nn))) / (2 * h);
      if (e < 0.02) assert.ok(Math.abs(Math.hypot(ge, gn) - 1) < 0.05, `p=${p}: |grad| ${Math.hypot(ge, gn)}`);
    }
  });

  // edgeDistance is exact near the poles and the edge, first order elsewhere, blended in between.
  // Near a pole first order is off by up to ~50% 0.1 R from the edge, so the blend's slope reaches
  // ~3.5 there (0.07–0.1 R from the edge by first order, clear of the bleed edge, which stays
  // exact); a jump (round 1: up to 2e-2 R) would show as a far larger step.
  test(`${tag}: edgeDistance is continuous where it switches between first order and exact (meridian sweeps near both poles)`, () => {
    const STEP = 2e-5;
    let worst = 0;
    for (const z of [1, -1]) {
      for (let k = 0; k < 5; k++) {
        const lon = (2 * Math.PI * (k + 0.37)) / 5;
        const at = (theta) => [Math.sin(theta) * Math.cos(lon), Math.sin(theta) * Math.sin(lon), z * Math.cos(theta)];
        let prev = un.edgeDistance(at(0.02));
        for (let theta = 0.02 + STEP; theta < 0.62; theta += STEP) {
          const e = un.edgeDistance(at(theta));
          worst = Math.max(worst, Math.abs(e - prev) / STEP);
          assert.ok(Math.abs(e - prev) <= 4 * STEP, `z=${z} lon=${lon} θ=${theta}: step ${e - prev}`);
          prev = e;
        }
      }
    }
    assert.ok(worst > 0.9, `slope ${worst}`);
  });

  test(`${tag}: seams run tip to tip, continuous (vertices ≤ 2·step apart) and smooth (turn ≤ 3° per vertex)`, () => {
    const step = 0.002;
    const { pos, neg } = un.seams(step);
    assert.ok(pos.length > 1000 && pos.length === neg.length);
    for (const side of [pos, neg]) {
      assert.ok(dist2(side[0], un.flatFrame(0).c) < 1e-8); // C(0) is 1e-9 off the pole (band.js)
      assert.ok(dist2(side.at(-1), un.flatFrame(L).c) < 1e-8);
      for (const p of side) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
    }
    // Closed outline: pos forward, then neg backward; it passes straight through both tips.
    const ring = [...pos, ...neg.slice(1, -1).reverse()];
    let maxTurn = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length];
      const b = ring[i];
      const c = ring[(i + 1) % ring.length];
      assert.ok(dist2(a, b) <= 2 * step, `gap at vertex ${i}: ${dist2(a, b)}`);
      const turn = Math.abs(wrap(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])));
      maxTurn = Math.max(maxTurn, turn);
      assert.ok(turn <= (3 * Math.PI) / 180, `turn ${(turn * 180) / Math.PI}° at vertex ${i} (${b})`);
    }
  });

  test(`${tag}: the closed outline is a simple polygon (no self-intersections)`, () => {
    const { pos, neg } = un.seams(0.01);
    const ring = [...pos, ...neg.slice(1, -1).reverse()];
    const n = ring.length;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const hit = (p1, p2, p3, p4) =>
      cross(p3, p4, p1) * cross(p3, p4, p2) < 0 && cross(p1, p2, p3) * cross(p1, p2, p4) < 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        assert.ok(!hit(a, b, ring[j], ring[(j + 1) % n]), `segments ${i} and ${j} cross`);
      }
    }
  });

  test(`${tag}: the forward map is continuous across every cell boundary (no notch): Lipschitz ≤ 1.3 for 1e-6 steps near the tips`, () => {
    const r = rng(13);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const p = pointNearPole(r, i % 2 ? 1 : -1, 0.45);
      const e = un.edgeDistance(p);
      if (e < -0.03) continue;
      const v = randomPoint(r);
      const k = dot(v, p);
      const t = [v[0] - k * p[0], v[1] - k * p[1], v[2] - k * p[2]];
      const nt = Math.hypot(...t);
      const h = 1e-6;
      const p2 = [p[0] + (h * t[0]) / nt, p[1] + (h * t[1]) / nt, p[2] + (h * t[2]) / nt];
      const n2 = Math.hypot(...p2);
      const q1 = un.stripToFlat(un.sphereToStrip(p));
      const q2 = un.stripToFlat(un.sphereToStrip(p2.map((x) => x / n2)));
      const ratio = dist2(q1, q2) / h;
      worst = Math.max(worst, ratio);
      assert.ok(ratio < 1.3, `p=${p}: ${ratio}`);
    }
    assert.ok(worst > 0.9);
  });

  // Principal stretches of the forward map (flat length / sphere length), from a finite-difference
  // Jacobian. `clean`: all five sample points share p's cell (and, in a strip cell, its arm of C),
  // so the differences do not straddle the medial axis, where the map is only C⁰ in places.
  const stretches = (p) => {
    const z = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = [p[1] * z[2] - p[2] * z[1], p[2] * z[0] - p[0] * z[2], p[0] * z[1] - p[1] * z[0]];
    const n1 = Math.hypot(...e1);
    for (let k = 0; k < 3; k++) e1[k] /= n1;
    const e2 = [p[1] * e1[2] - p[2] * e1[1], p[2] * e1[0] - p[0] * e1[2], p[0] * e1[1] - p[1] * e1[0]];
    const h = 1e-6;
    const pt = un.sphereToStrip(p);
    let clean = true;
    const F = (v, t) => {
      const q = un.sphereToStrip(p.map((x, k) => x * Math.cos(t) + v[k] * Math.sin(t)));
      if (q.cell !== pt.cell || Math.abs(q.s - pt.s) > 1e-3) clean = false;
      return un.stripToFlat(q);
    };
    const [qa, qb, qc, qd] = [F(e1, h), F(e1, -h), F(e2, h), F(e2, -h)];
    const a = (qa[0] - qb[0]) / (2 * h);
    const b = (qc[0] - qd[0]) / (2 * h);
    const c = (qa[1] - qb[1]) / (2 * h);
    const d = (qc[1] - qd[1]) / (2 * h);
    const T = a * a + b * b + c * c + d * d;
    const D = a * d - b * c;
    const disc = Math.sqrt(Math.max(0, (T * T) / 4 - D * D));
    return { lo: Math.sqrt(T / 2 - disc), hi: Math.sqrt(T / 2 + disc), det: D, pt, clean };
  };

  // The tips' focal points F: where the medial axis starts, at distance atan(1/|kg|) along the
  // concave normal. Under the old flat offset d the strip chart was singular there (flat focal
  // distance 1/kg ≠ sphere atan(1/kg)); under tan d both foci coincide, so no disc is excluded.
  const focalPoints = [0, L].map((s) => {
    const kg = cl.frame(s).kg;
    return un.toSphere(s, Math.sign(kg) * Math.atan(1 / Math.abs(kg)));
  });
  const nearPoint = (r, F, cap) => {
    const v = randomPoint(r);
    const k = dot(v, F);
    const t = [v[0] - k * F[0], v[1] - k * F[1], v[2] - k * F[2]];
    const nt = Math.hypot(...t);
    const rad = cap * Math.sqrt(r());
    return F.map((x, j) => x * Math.cos(rad) + (t[j] / nt) * Math.sin(rad));
  };
  // Band + bleed sample: half uniform, half near a pole, plus discs of 0.02 R round both F.
  const bleedPoints = (seed, n) => {
    const r = rng(seed);
    const out = [];
    while (out.length < n) {
      const k = out.length % 4;
      const p = k === 0 ? randomPoint(r) : k === 1 ? pointNearPole(r, r() < 0.5 ? 1 : -1, 0.6) : nearPoint(r, focalPoints[k - 2], 0.02);
      const e = un.edgeDistance(p);
      if (e > -BLEED && Math.abs(e) > 1e-5) out.push(p); // differences must not straddle the cut
    }
    return out;
  };
  // Largest |d| of a strip cell in band 0: on the seams (|d| grows along each foot's normal, and
  // the medial axis inside the band ends on the seam).
  const D_EDGE = (() => {
    let m = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i <= 2000; i++) {
        const C = cl.frame((L * i) / 2000).C;
        const pt = un.sphereToStrip([-side * C[1], side * C[0], C[2]]);
        if (pt.cell === 'strip') m = Math.max(m, Math.abs(pt.d));
      }
    }
    return m;
  })();

  // Strip-cell stretch, derived from the model. On the sphere, p = cos d·C + sin d·N has metric
  // (cos d − kg sin d)² ds² + dd² (Darboux frame: C′ = T, N′ = −kg·T). The flat image
  // c(s) + tan d·n(s) has metric (1 − κ tan d)² ds² + sec⁴d dd², with flat curvature κ = kg.
  // So the stretch along the strip is (1 − kg tan d)/(cos d − kg sin d) = sec d exactly (the
  // flat curvature term cancels against the sphere's, also at the focal distance tan d = 1/kg),
  // the stretch across it is sec²d, and the two directions stay orthogonal: principal stretches
  // (sec d, sec²d), in [1, sec²D_EDGE] over band 0 (≈ 1.07 at the body's edge d ≈ 0.258).
  test(`${tag}: stretch bound: in every strip cell (band + bleed, focal points included) the principal stretches are (sec d, sec²d); within [1, sec²D_edge] over band 0`, () => {
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    let focal = 0;
    for (const p of bleedPoints(14, 12000)) {
      const st = stretches(p);
      assert.ok(st.det > 0, `p=${p}: det ${st.det}`);
      if (st.pt.cell !== 'strip' || !st.clean) continue;
      n++;
      if (focalPoints.some((F) => dist3(p, F) < 0.02)) focal++;
      const sec = 1 / Math.cos(st.pt.d);
      assert.ok(Math.abs(st.lo - sec) < 1e-6 && Math.abs(st.hi - sec * sec) < 1e-6, `p=${p} d=${st.pt.d}: [${st.lo}, ${st.hi}] vs [${sec}, ${sec * sec}]`);
      if (un.edgeDistance(p) > 0) {
        lo = Math.min(lo, st.lo);
        hi = Math.max(hi, st.hi);
      }
    }
    assert.ok(n > 8000 && focal > 3000, `${n} samples, ${focal} near the focal points`);
    const bound = 1 / Math.cos(D_EDGE) ** 2;
    assert.ok(lo >= 1 - 1e-6 && hi <= bound + 1e-6, `measured [${lo}, ${hi}], bound sec²(${D_EDGE}) = ${bound}`);
  });

  // Tip cells: without δ the tip chart is the gnomonic projection about the tip, principal
  // stretches sec ρ (round the tip) and sec²ρ (radial): within [1, sec²0.23] = [1, 1.055] in
  // band 0 (tip cells reach ρ = 0.23 on the seam) and [1, sec²0.275] = [1, 1.08] with the bleed.
  // δ (which moves the chart onto the arm's along the medial axis) adds its own strain; the
  // measured ranges are pinned.
  test(`${tag}: tip cells: orientation-preserving (band + bleed); principal stretches within [${STRETCH_TIP_BAND}] in band 0, [${STRETCH_TIP}] with the bleed`, () => {
    const range = { band: [Infinity, -Infinity], all: [Infinity, -Infinity] };
    let n = 0;
    for (const p of bleedPoints(16, 120000)) {
      if (un.sphereToStrip(p).cell === 'strip') continue;
      const st = stretches(p);
      n++;
      assert.ok(st.det > 0, `p=${p}: det ${st.det}`);
      for (const key of un.edgeDistance(p) > 0 ? ['band', 'all'] : ['all']) {
        range[key][0] = Math.min(range[key][0], st.lo);
        range[key][1] = Math.max(range[key][1], st.hi);
      }
    }
    assert.ok(n > 1000, `${n} tip-cell samples`);
    const within = ([lo, hi], [a, b]) => lo >= a && hi <= b;
    assert.ok(within(range.band, STRETCH_TIP_BAND) && within(range.all, STRETCH_TIP), `measured ${JSON.stringify(range)}`);
  });

  // Area: the outline encloses the image of band 0 (area 2π), so its area / 2π is the mean area
  // stretch over band 0: sec³d in strip cells (from the stretch bound), the Jacobian in tip cells.
  test(`${tag}: flat outline area = 2π · mean area stretch over band 0 (sec³d in strip cells)`, () => {
    const r = rng(18);
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    while (n < 20000) {
      const p = randomPoint(r);
      if (bandOf(p, spiral) !== 0) continue;
      const pt = un.sphereToStrip(p);
      const j = pt.cell === 'strip' ? 1 / Math.cos(pt.d) ** 3 : stretches(p).det;
      sum += j;
      sum2 += j * j;
      n++;
    }
    const mean = sum / n;
    const se = Math.sqrt((sum2 / n - mean * mean) / n);
    const ratio = polygonArea(outline) / (2 * Math.PI);
    assert.ok(Math.abs(ratio - mean) < 4 * se, `area ratio ${ratio}, mean area stretch ${mean} ± ${se}`);
  });

  // The tip correction δ makes the tip chart meet the arm's strip chart on the medial axis M
  // (points equally near the tip and an arm foot s), through band 0 and the bleed.
  test(`${tag}: tip and strip charts agree on the medial axis within 1e-6 R, through band + bleed`, () => {
    let n = 0;
    let outside = 0;
    let worst = 0;
    for (const s0 of [0, L]) {
      const f0 = cl.frame(s0);
      const out = s0 === 0 ? -1 : 1;
      const sigma = Math.sign(f0.kg);
      const tipDist = (p) => Math.acos(Math.min(1, dot(p, f0.C)));
      for (let u = 0.003; u < 2; u += 0.004) {
        const s = s0 - out * u;
        const fr = cl.frame(s);
        const along = (x) => fr.C.map((c, k) => Math.cos(sigma * x) * c + Math.sin(sigma * x) * fr.N[k]);
        const kc = sigma * fr.kg;
        let lo = 0;
        let hi = kc > 0 ? Math.atan(1 / kc) : Math.PI / 2;
        if (tipDist(along(hi)) > hi) break; // M has ended
        for (let k = 0; k < 60; k++) {
          const mid = 0.5 * (lo + hi);
          if (tipDist(along(mid)) > mid) lo = mid;
          else hi = mid;
        }
        const x = 0.5 * (lo + hi);
        const m = along(x);
        const e = un.edgeDistance(m);
        if (e < -BLEED) break;
        if (!(out * dot(m, f0.T) > 0)) continue; // not behind the tip
        const arm = un.stripToFlat({ cell: 'strip', s, d: sigma * x });
        const tip = un.stripToFlat({ cell: s0 === 0 ? 'tipN' : 'tipS', s: s0, d: NaN, rho: tipDist(m), alpha: Math.atan2(dot(m, f0.N), dot(m, f0.T)) });
        const gap = dist2(arm, tip);
        worst = Math.max(worst, gap);
        n++;
        if (e < 0) outside++;
        assert.ok(gap <= 1e-6, `s0=${s0} u=${u} edge ${e}: charts ${gap} R apart`);
      }
    }
    assert.ok(n > 100 && outside > 5, `${n} medial points, ${outside} in the bleed`);
  });
}
