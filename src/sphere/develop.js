// Unrolling: lay the band-0 centre line flat with its geodesic curvature and offset
// points along geodesic normals. flat(s, d) = c(s) + d·n(s); sphere(s, d) = cos d·C + sin d·N.
import { bandPhase } from './band.js';

const HALF_PI = Math.PI / 2;
const NODES = 20000; // same resolution as the centre line's default table
const SIMPSON_PANELS = 4;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function makeUnrolling(spiral, centreLine) {
  const { length, thetaAt, sOfTheta, frame } = centreLine;
  const h = Math.PI / NODES;

  // Node tables on the uniform θ grid: arc length, curvature, heading, flat position.
  const sN = new Float64Array(NODES + 1);
  const kN = new Float64Array(NODES + 1);
  const psiN = new Float64Array(NODES + 1);
  const xN = new Float64Array(NODES + 1);
  const yN = new Float64Array(NODES + 1);
  const kM = new Float64Array(NODES); // curvature at the middle of each node interval
  for (let i = 0; i <= NODES; i++) {
    sN[i] = sOfTheta(i * h);
    kN[i] = frame(sN[i]).kg;
  }
  for (let i = 0; i < NODES; i++) kM[i] = frame(0.5 * (sN[i] + sN[i + 1])).kg;

  // Within node interval i the curvature is the quadratic through its two nodes and
  // midpoint, so the heading is cubic (exactly Simpson at the far node); c is
  // Simpson-integrated over that heading. Nodes and queries share this code, so
  // the polyline is continuous and c′ = t to quadrature error.
  function quad(i) {
    const dl = sN[i + 1] - sN[i];
    const b = (2 * (kN[i + 1] + kN[i] - 2 * kM[i])) / (dl * dl);
    return { a: (kN[i + 1] - kN[i]) / dl - b * dl, b };
  }
  function local(i, u) {
    const { a, b } = quad(i);
    const psiAt = (v) => psiN[i] + kN[i] * v + (a / 2) * v * v + (b / 3) * v * v * v;
    const m = SIMPSON_PANELS;
    const du = u / m;
    let sx = Math.cos(psiN[i]) + Math.cos(psiAt(u));
    let sy = Math.sin(psiN[i]) + Math.sin(psiAt(u));
    for (let k = 1; k < m; k++) {
      const p = psiAt(k * du);
      const w = k % 2 ? 4 : 2;
      sx += w * Math.cos(p);
      sy += w * Math.sin(p);
    }
    return { psi: psiAt(u), x: xN[i] + (sx * du) / 3, y: yN[i] + (sy * du) / 3 };
  }
  for (let i = 0; i < NODES; i++) {
    psiN[i + 1] = psiN[i] + ((kN[i] + 4 * kM[i] + kN[i + 1]) * (sN[i + 1] - sN[i])) / 6;
    const r = local(i, sN[i + 1] - sN[i]);
    xN[i + 1] = r.x;
    yN[i + 1] = r.y;
  }

  function nodeInterval(s) {
    let lo = 0;
    let hi = NODES;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (sN[m] <= s) lo = m;
      else hi = m;
    }
    return lo;
  }

  function flatFrame(sIn) {
    const s = Math.min(Math.max(sIn, 0), length);
    const i = nodeInterval(s);
    const u = s - sN[i];
    const r = local(i, u);
    const { a, b } = quad(i);
    const kappa = kN[i] + a * u + b * u * u;
    const cs = Math.cos(r.psi);
    const sn = Math.sin(r.psi);
    return { c: [r.x, r.y], t: [cs, sn], n: [-sn, cs], kappa };
  }

  function toFlat(s, d) {
    const f = flatFrame(s);
    return [f.c[0] + d * f.n[0], f.c[1] + d * f.n[1]];
  }

  function toSphere(s, d) {
    const { C, N } = frame(s);
    const cd = Math.cos(d);
    const sd = Math.sin(d);
    return [cd * C[0] + sd * N[0], cd * C[1] + sd * N[1], cd * C[2] + sd * N[2]];
  }

  function flatToStrip(x, y, sGuess) {
    let s = sGuess;
    let converged = false;
    for (let it = 0; it < 8; it++) {
      if (!(s >= 0 && s <= length)) return { s, d: 0, ok: false };
      const f = flatFrame(s);
      const qx = x - f.c[0];
      const qy = y - f.c[1];
      const g = qx * f.t[0] + qy * f.t[1];
      const d = qx * f.n[0] + qy * f.n[1];
      const gp = -1 + f.kappa * d;
      if (!(Math.abs(gp) > 1e-9)) return { s, d, ok: false };
      const ds = g / gp;
      s -= ds;
      if (Math.abs(ds) < 1e-12) {
        converged = true;
        break;
      }
    }
    if (!converged || !(s >= 0 && s <= length)) return { s, d: 0, ok: false };
    const f = flatFrame(s);
    return { s, d: (x - f.c[0]) * f.n[0] + (y - f.c[1]) * f.n[1], ok: true };
  }

  // Foot point of p, to first order: p sits phase φ off the centre line at its own θ;
  // projecting that sideways offset onto the spiral tangent (in the local (θ, sinθ·λ)
  // metric) gives the θ shift. Without it Newton can land on a neighbouring winding.
  function defaultGuess(p) {
    const theta = Math.acos(Math.min(1, Math.max(-1, p[2])));
    const st2 = Math.sin(theta) ** 2;
    const dl = spiral.dLambda(theta);
    const shift = (bandPhase(p, spiral) * dl * st2) / (1 + dl * dl * st2);
    return sOfTheta(Math.min(Math.max(theta + shift, 0), Math.PI));
  }

  // dT/ds = −C + kg·N on the unit sphere, so Newton on p·T(s) = 0 has slope −p·C + kg·p·N.
  function sphereToStrip(p, sGuess) {
    let s = sGuess ?? defaultGuess(p);
    for (let it = 0; it < 30; it++) {
      const f = frame(s);
      const g = dot(p, f.T);
      const gp = -dot(p, f.C) + f.kg * dot(p, f.N);
      if (!(Math.abs(gp) > 1e-12)) break;
      const ds = g / gp;
      s = Math.min(Math.max(s - ds, 0), length);
      if (Math.abs(ds) < 1e-13) break;
    }
    const f = frame(s);
    return { s, d: Math.atan2(dot(p, f.N), dot(p, f.C)) };
  }

  // Offsets where |phase| reaches π/2 on each side. phase(0) = 0 and |phase| grows
  // with |d|, so step outward until it passes π/2, then bisect. The band pinches to
  // zero width at the tips, where the first step already brackets the root.
  function edgeOffsets(s) {
    const { C, N } = frame(s);
    const over = (d) => {
      const cd = Math.cos(d);
      const sd = Math.sin(d);
      const p = [cd * C[0] + sd * N[0], cd * C[1] + sd * N[1], cd * C[2] + sd * N[2]];
      return Math.abs(bandPhase(p, spiral)) - HALF_PI;
    };
    const side = (sign) => {
      const step = 0.01;
      let lo = 0;
      let hi = step;
      while (over(sign * hi) < 0) {
        lo = hi;
        hi += step;
        if (hi > Math.PI) return sign * Math.PI;
      }
      for (let k = 0; k < 60 && hi - lo > 1e-14; k++) {
        const mid = 0.5 * (lo + hi);
        if (over(sign * mid) < 0) lo = mid;
        else hi = mid;
      }
      return sign * 0.5 * (lo + hi);
    };
    return { dPos: side(1), dNeg: side(-1) };
  }

  function seams(step = 0.002) {
    const pos = [];
    const neg = [];
    const count = Math.max(1, Math.ceil(length / step));
    for (let i = 0; i <= count; i++) {
      const s = i === count ? length : i * step;
      const { dPos, dNeg } = edgeOffsets(s);
      pos.push(toFlat(s, dPos));
      neg.push(toFlat(s, dNeg));
    }
    return { pos, neg };
  }

  return { flatFrame, toFlat, toSphere, flatToStrip, sphereToStrip, edgeOffsets, seams };
}
