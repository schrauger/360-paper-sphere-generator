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
 * Arc length is a Simpson-integrated table over a uniform θ grid, linearly
 * interpolated. C and T are analytic; kg = N·dT/ds uses a central difference
 * of the analytic T in θ (one-sided at the poles).
 */
export function makeCentreLine(spiral, { samples = 20000 } = {}) {
  const n = samples % 2 === 0 ? samples : samples + 1; // Simpson needs even intervals
  const h = Math.PI / n;
  const table = new Float64Array(n + 1); // table[i] = s at θ = i·h
  let prevF = speed(spiral, 0);
  for (let i = 1; i <= n; i++) {
    const a = (i - 1) * h;
    const mid = speed(spiral, a + h / 2);
    const f = speed(spiral, i * h);
    table[i] = table[i - 1] + ((prevF + 4 * mid + f) * h) / 6;
    prevF = f;
  }
  const length = table[n];

  function sOfTheta(theta) {
    const x = Math.min(Math.max(theta, 0), Math.PI) / h;
    const i = Math.min(Math.floor(x), n - 1);
    return table[i] + (x - i) * (table[i + 1] - table[i]);
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
    return (lo + (span > 0 ? (q - table[lo]) / span : 0)) * h;
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
    const e = 1e-5;
    const t0 = Math.max(t - e, 0);
    const t1 = Math.min(t + e, Math.PI);
    const T0 = tangent(t0);
    const T1 = tangent(t1);
    const dTds = [0, 1, 2].map((k) => (T1[k] - T0[k]) / (t1 - t0) / speed(spiral, t));
    const kg = N[0] * dTds[0] + N[1] * dTds[1] + N[2] * dTds[2];
    return { C, T, N, kg };
  }

  return { length, thetaAt, sOfTheta, frame };
}
