// Bands (the two interleaved spiral strips) and the centre line of band 0.
import { pointAt } from './spiral.js';

const TWO_PI = 2 * Math.PI;
const clamp1 = (z) => Math.min(1, Math.max(-1, z));

/** Wrap an angle to (−π, π]. */
function wrap(a) {
  let w = (a + Math.PI) % TWO_PI;
  if (w <= 0) w += TWO_PI;
  return w - Math.PI;
}

/** Signed longitude offset of p from the spiral centre line at p's θ, in (−π, π]. */
export function bandPhase(p, spiral) {
  const theta = Math.acos(clamp1(p[2]));
  return wrap(Math.atan2(p[1], p[0]) - spiral.lambda(theta));
}

/** 0 iff |phase| < π/2. Band 1 is band 0 rotated by π about z. */
export function bandOf(p, spiral) {
  return Math.abs(bandPhase(p, spiral)) < Math.PI / 2 ? 0 : 1;
}

/** Point on the seam between bands at polar angle θ (phase = side·π/2). */
export function seamPoint(spiral, theta, side) {
  return pointAt(theta, spiral.lambda(theta) + side * Math.PI / 2);
}

// dC/dθ for C(θ) = pointAt(θ, λ(θ)); its norm is √(1 + λ′² sin²θ).
// θ is nudged off the poles by 1e-9 so λ′·sinθ stays finite for the loxodrome
// (λ′ ~ 1/sinθ); this keeps |dC/dθ| = √(1+rate²) right at the tips.
function dCdTheta(spiral, t0) {
  const t = Math.min(Math.max(t0, 1e-9), Math.PI - 1e-9);
  const l = spiral.lambda(t);
  const dl = spiral.dLambda(t);
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const cl = Math.cos(l);
  const sl = Math.sin(l);
  return [ct * cl - st * sl * dl, ct * sl + st * cl * dl, -st];
}

const speed = (spiral, t) => Math.hypot(...dCdTheta(spiral, t));

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Centre line of band 0 from pole to pole, parameterised by arc length s.
 * Arc length is a Simpson-integrated table over a uniform θ grid, interpolated
 * by cubic Hermite with the analytic slopes ds/dθ = |dC/dθ| (and dθ/ds = 1/|dC/dθ|
 * the other way), so |dC/ds| = 1 to ~1e-10, not just at the nodes. C, T and kg
 * are all analytic.
 */
export function makeCentreLine(spiral, { samples = 20000 } = {}) {
  const n = samples % 2 === 0 ? samples : samples + 1; // Simpson needs even intervals
  const h = Math.PI / n;
  const table = new Float64Array(n + 1); // table[i] = s at θ = i·h
  const rate = new Float64Array(n + 1); // rate[i] = ds/dθ at θ = i·h
  rate[0] = speed(spiral, 0);
  for (let i = 1; i <= n; i++) {
    const a = (i - 1) * h;
    const mid = speed(spiral, a + h / 2);
    rate[i] = speed(spiral, i * h);
    table[i] = table[i - 1] + ((rate[i - 1] + 4 * mid + rate[i]) * h) / 6;
  }
  const length = table[n];

  // Cubic Hermite on [0, 1] with end values a, b and end slopes da, db.
  const hermite = (u, a, b, da, db) => {
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * da + (3 * u2 - 2 * u3) * b + (u3 - u2) * db;
  };

  function sOfTheta(theta) {
    const x = Math.min(Math.max(theta, 0), Math.PI) / h;
    const i = Math.min(Math.floor(x), n - 1);
    return hermite(x - i, table[i], table[i + 1], rate[i] * h, rate[i + 1] * h);
  }

  function thetaAt(s) {
    const q = Math.min(Math.max(s, 0), length);
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (table[m] <= q) lo = m;
      else hi = m;
    }
    const span = table[lo + 1] - table[lo];
    if (!(span > 0)) return lo * h;
    return hermite((q - table[lo]) / span, lo * h, (lo + 1) * h, span / rate[lo], span / rate[lo + 1]);
  }

  const tangent = (t) => {
    const d = dCdTheta(spiral, t);
    const k = Math.hypot(...d);
    return [d[0] / k, d[1] / k, d[2] / k];
  };

  function frame(s) {
    // Same pole nudge as dCdTheta so C and T are exactly perpendicular at the tips.
    const t = Math.min(Math.max(thetaAt(s), 1e-9), Math.PI - 1e-9);
    const C = pointAt(t, spiral.lambda(t));
    const T = tangent(t);
    const N = cross(C, T);
    // Analytic geodesic curvature: kg = (C × C′)·C″ / |C′|³ (θ-derivatives).
    // Loxodrome kg diverges like 1/θ at the tips, so the value at the clamped
    // tip is a convention (finite, but not a limit).
    const l = spiral.lambda(t);
    const dl = spiral.dLambda(t);
    const ddl = spiral.ddLambda(t);
    const st = Math.sin(t);
    const ct = Math.cos(t);
    const cl = Math.cos(l);
    const sl = Math.sin(l);
    const k2 = 1 + dl * dl;
    const C2 = [
      -st * cl * k2 - 2 * ct * sl * dl - st * sl * ddl,
      -st * sl * k2 + 2 * ct * cl * dl + st * cl * ddl,
      -ct,
    ];
    const C1 = dCdTheta(spiral, t);
    const CxC1 = cross(C, C1);
    const kg = (CxC1[0] * C2[0] + CxC1[1] * C2[1] + CxC1[2] * C2[2]) / Math.hypot(...C1) ** 3;
    return { C, T, N, kg };
  }

  return { length, thetaAt, sOfTheta, frame };
}
