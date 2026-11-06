// Unrolling: band 0 of the sphere ↔ one flat piece, by closest-point (Voronoi) coordinates
// on the centre line C (ruling R10).
//
// Sphere → strip. A point p is described by its nearest point on C:
//  - an interior foot s: strip coordinates (s, d), p = cos d·C(s) + sin d·N(s);
//  - a tip, when p lies behind an end of C and is nearer to it than to any interior foot:
//    polar coordinates (ρ, α) about the tip, α measured from T(tip) toward N(tip).
// Strip → flat (ruling R15). C is laid flat with its geodesic curvature (c, t, n), and
//  - (s, d) ↦ c(s) + tan d·n(s);
//  - (ρ, α) ↦ c(tip) + tan ρ·(cos α·t + sin α·n) + δ(ρ, α).
// That is the band projected centrally (from the sphere's centre) onto the tangent developable
// along C, whose rulings run along N and which lies flat onto (c, n) exactly, and behind each tip
// onto the tip's tangent plane (gnomonic). Stretches: sec d along the strip, sec²d across it, in
// every strip cell; sphere and flat focal distances coincide (tan d = 1/kg), so the strip chart
// has no singular point. d and ρ stay sphere geodesic distances everywhere in this API.
// δ is the tip correction. Near each tip kg reaches 12, so on the concave side the strip
// cells end on a medial axis M where the tip and a later stretch of C ("the arm") are equally
// near. The arm's strip chart and the tip's gnomonic chart project onto different planes and
// disagree along M (the sphere's curvature), so plain closest-point charts tear there and the
// cut outline gets a notch.
// δ moves the tip chart onto the arm chart along M (values everywhere; also the derivative
// across M, except near M's start deep inside the band), so the map is continuous, and C¹
// where the seam crosses M. δ vanishes on the tip's normal rays, where the tip chart meets the
// strip chart at s = 0, and fades out along M once M is past the bleed.
//
// Flat → strip is the exact inverse of that forward map (not the nearest foot on the flat
// centre line: the flat and sphere medial axes differ, and the nearest flat foot would give
// a different, inconsistent point in a sliver along M).
import { bandPhase } from './band.js';

const HALF_PI = Math.PI / 2;
const NODES = 20000; // same resolution as the centre line's default table
const COARSE = 0.01; // centre-line sample spacing for the global foot searches
const GRID = 0.05; // flat lookup grid cell size
const REACH = 0.45; // flatToStrip answers within this distance of the flat centre line
const TIP_ZONE = 2; // arc length from a tip within which tip cells and M can matter
const MEDIAL_STEP = 0.002; // arm arc-length step of the tip medial-axis tables
const BLEED_PHASE = 0.25; // M is matched exactly until this far (in phase) outside the band
const MEDIAL_PHASE_MARGIN = 0.45; // (≈ 0.035 R there, the bleed), then the match fades out by here
const V_FADE = 0.2; // arm length over which the derivative match fades in from M's start
const RAY_FROM = 0.02; // the tip correction runs along circles within this angle of the
const RAY_FULL = 0.3; // concave normal ray, along rays beyond RAY_FULL, blended between
const ARM_CHECK = 0.32; // past this |d|, within ARM_ZONE of a tip, a flat foot is checked
const ARM_ZONE = 2.5; // against every arm of C (see stripValid)
const FOOT_TOL = 1e-3; // coarse p·C within this of the best is refined as a candidate foot
const EDGE_EXACT_POLE = 0.5; // edgeDistance is exact within this of a pole…
const EDGE_EXACT_BAND = 0.1; // …and this of the edge; first order elsewhere, blended over
const EDGE_BLEND_POLE = 0.05; // these widths inside that zone (so it is continuous)
const EDGE_BLEND_BAND = 0.03;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp1 = (z) => Math.min(1, Math.max(-1, z));
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function makeUnrolling(spiral, centreLine) {
  const { length, thetaAt, sOfTheta, frame, basis } = centreLine;

  // ---- Flat centre line ------------------------------------------------------------------
  // Node tables on the uniform θ grid: arc length, curvature, heading, flat position.
  const h = Math.PI / NODES;
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

  // Within node interval i the curvature is the quadratic kN[i] + qa·u + qb·u² through its
  // two nodes and midpoint, so the heading is cubic (exactly Simpson at the far node); c is
  // Simpson-integrated (two panels) over that heading. Nodes and queries share this code, so
  // the polyline is continuous and c′ = t to quadrature error.
  const qa = new Float64Array(NODES);
  const qb = new Float64Array(NODES);
  const cosN = new Float64Array(NODES + 1);
  const sinN = new Float64Array(NODES + 1);
  for (let i = 0; i < NODES; i++) {
    const dl = sN[i + 1] - sN[i];
    qb[i] = (2 * (kN[i + 1] + kN[i] - 2 * kM[i])) / (dl * dl);
    qa[i] = (kN[i + 1] - kN[i]) / dl - qb[i] * dl;
  }
  // integrate(i, u) leaves the flat frame at sN[i] + u in these (no allocation: flatToStrip
  // runs it per pixel).
  let fX = 0;
  let fY = 0;
  let fCos = 1;
  let fSin = 0;
  let fKappa = 0;
  function integrate(i, u) {
    const k0 = kN[i];
    const a = qa[i] / 2;
    const b = qb[i] / 3;
    const v = u / 2;
    const pm = psiN[i] + v * (k0 + v * (a + v * b));
    const pe = psiN[i] + u * (k0 + u * (a + u * b));
    const cm = Math.cos(pm);
    const sm = Math.sin(pm);
    fCos = Math.cos(pe);
    fSin = Math.sin(pe);
    fX = xN[i] + (u / 6) * (cosN[i] + 4 * cm + fCos);
    fY = yN[i] + (u / 6) * (sinN[i] + 4 * sm + fSin);
    fKappa = k0 + u * (qa[i] + u * qb[i]);
    return pe;
  }
  cosN[0] = 1;
  for (let i = 0; i < NODES; i++) {
    psiN[i + 1] = integrate(i, sN[i + 1] - sN[i]);
    xN[i + 1] = fX;
    yN[i + 1] = fY;
    cosN[i + 1] = fCos;
    sinN[i + 1] = fSin;
  }

  // Node interval containing s: start from a uniform-s index (nodes are at most ~6 per bin).
  const binOf = new Int32Array(NODES + 1);
  for (let k = 0, i = 0; k <= NODES; k++) {
    const s = (k * length) / NODES;
    while (i < NODES - 1 && sN[i + 1] <= s) i++;
    binOf[k] = i;
  }
  function evalFlat(sIn) {
    const s = Math.min(Math.max(sIn, 0), length);
    let i = binOf[Math.min(NODES, Math.floor((s / length) * NODES))];
    while (i < NODES - 1 && sN[i + 1] <= s) i++;
    while (i > 0 && sN[i] > s) i--;
    integrate(i, s - sN[i]);
  }

  function flatFrame(s) {
    evalFlat(s);
    return { c: [fX, fY], t: [fCos, fSin], n: [-fSin, fCos], kappa: fKappa };
  }

  // d is the sphere geodesic offset; the flat offset is tan d.
  function toFlat(s, d) {
    evalFlat(s);
    const u = Math.tan(d);
    return [fX - u * fSin, fY + u * fCos];
  }

  function toSphere(s, d) {
    const { C, N } = basis(s);
    const cd = Math.cos(d);
    const sd = Math.sin(d);
    return [cd * C[0] + sd * N[0], cd * C[1] + sd * N[1], cd * C[2] + sd * N[2]];
  }

  // ---- Coarse samples of C, sphere and flat -----------------------------------------------
  const nC = Math.ceil(length / COARSE);
  const sampleS = (j) => Math.min(j * COARSE, length);
  const cC = new Float64Array(3 * (nC + 1));
  const cX = new Float64Array(nC + 1);
  const cY = new Float64Array(nC + 1);
  for (let j = 0; j <= nC; j++) {
    const s = sampleS(j);
    const { C } = frame(s);
    cC[3 * j] = C[0];
    cC[3 * j + 1] = C[1];
    cC[3 * j + 2] = C[2];
    const { c } = flatFrame(s);
    cX[j] = c[0];
    cY[j] = c[1];
  }
  const sampleIndex = (s) => Math.min(nC, Math.max(0, Math.round(s / COARSE)));

  // ---- Sphere: nearest interior foot --------------------------------------------------------
  // Maximise p·C(s) on [lo, hi]: Newton on g = p·T (slope −p·C + kg·p·N), falling back to
  // bisection on the sign of g. Returns null if the maximum is an end of [0, length] that is
  // not a critical point (then p lies behind that end of C).
  function sphereFootIn(p, lo, hi, s0) {
    let s = s0;
    for (let it = 0; it < 100; it++) {
      const f = frame(s);
      const g = dot(p, f.T);
      if (g > 0) lo = s;
      else hi = s;
      const gp = -dot(p, f.C) + f.kg * dot(p, f.N);
      let next = gp < 0 ? s - g / gp : 0.5 * (lo + hi);
      if (!(next >= lo && next <= hi)) next = 0.5 * (lo + hi);
      if (Math.abs(next - s) < 1e-13 || hi - lo < 1e-13) {
        s = next;
        break;
      }
      s = next;
    }
    const f = frame(s);
    if ((s <= 0 || s >= length) && Math.abs(dot(p, f.T)) > 1e-10) return null;
    return { s, d: Math.atan2(dot(p, f.N), dot(p, f.C)), value: dot(p, f.C) };
  }

  // First-order foot: p sits phase φ off the centre line at its own θ; projecting that
  // sideways offset onto the spiral tangent (local (θ, sinθ·λ) metric) gives the θ shift.
  function firstOrderGuess(p) {
    const theta = Math.acos(clamp1(p[2]));
    const st2 = Math.sin(theta) ** 2;
    const dl = spiral.dLambda(theta);
    const shift = (bandPhase(p, spiral) * dl * st2) / (1 + dl * dl * st2);
    return sOfTheta(Math.min(Math.max(theta + shift, 0), Math.PI));
  }

  // Global nearest interior foot. The foot's θ is within the geodesic distance D of p's θ for
  // any upper bound D, so only that window of coarse samples is scanned.
  function interiorFoot(p, sHint) {
    const theta = Math.acos(clamp1(p[2]));
    const s1 = Number.isFinite(sHint) ? Math.min(Math.max(sHint, 0), length) : firstOrderGuess(p);
    const D = Math.acos(clamp1(dot(p, frame(s1).C))) + 2 * COARSE;
    const j0 = Math.max(0, Math.floor(sOfTheta(Math.max(0, theta - D)) / COARSE) - 1);
    const j1 = Math.min(nC, Math.ceil(sOfTheta(Math.min(Math.PI, theta + D)) / COARSE) + 1);
    const v = new Float64Array(j1 - j0 + 1);
    for (let j = j0; j <= j1; j++) {
      const k = 3 * j;
      v[j - j0] = p[0] * cC[k] + p[1] * cC[k + 1] + p[2] * cC[k + 2];
    }
    // Coarse local maxima, best first; refine until the rest cannot beat the best foot. A
    // maximum at an end of C refines to null unless it hides an interior maximum.
    const peaks = [];
    for (let j = j0; j <= j1; j++) {
      const vj = v[j - j0];
      if ((j === j0 || v[j - j0 - 1] <= vj) && (j === j1 || v[j - j0 + 1] <= vj)) peaks.push(j);
    }
    peaks.sort((a, b) => v[b - j0] - v[a - j0]);
    let foot = null;
    for (const j of peaks) {
      if (foot && v[j - j0] < foot.value - FOOT_TOL) break;
      const cand = sphereFootIn(p, sampleS(Math.max(0, j - 1)), sampleS(Math.min(nC, j + 1)), sampleS(j));
      if (cand && (!foot || cand.value > foot.value)) foot = cand;
    }
    return foot;
  }

  // ---- Tips --------------------------------------------------------------------------------
  // Each tip uses the basis (out·T, σ·N) on the sphere and (out·t, σ·n) in the flat: out
  // points away from the strip and σ to the concave side, so β ∈ (−π/2, π/2) is "behind the
  // tip" (its cell) and β > 0 the concave quarter, at both ends.
  function makeTip(name, s0, out) {
    const f = frame(s0);
    const ff = flatFrame(s0);
    const sigma = f.kg < 0 ? -1 : 1;
    const C0 = f.C;
    const e1 = f.T.map((x) => out * x);
    const e2 = f.N.map((x) => sigma * x);
    const c0 = ff.c;
    const g1 = ff.t.map((x) => out * x);
    const g2 = ff.n.map((x) => sigma * x);

    const polar = (p) => {
      const a = dot(p, e1);
      const b = dot(p, e2);
      return { rho: Math.atan2(Math.hypot(a, b), dot(p, C0)), beta: Math.atan2(b, a) };
    };
    const sphereAt = (rho, beta) => {
      const cr = Math.cos(rho);
      const sr = Math.sin(rho);
      const cb = Math.cos(beta);
      const sb = Math.sin(beta);
      return [0, 1, 2].map((k) => cr * C0[k] + sr * (cb * e1[k] + sb * e2[k]));
    };
    const flatRadial = (beta) => [Math.cos(beta) * g1[0] + Math.sin(beta) * g2[0], Math.cos(beta) * g1[1] + Math.sin(beta) * g2[1]];

    // Medial axis M, tabulated along the arm (u = |s − s0|): on the arm's concave normal, M is
    // where the distance to the tip equals the distance to the arm. J = arm chart − gnomonic
    // chart there; V = the same for the derivative along the tip's radial geodesic (per unit
    // ρ). M starts at the tip's focal point (u = 0, β = π/2, ρ = atan(1/|kg|)), first radially,
    // then turns round the tip; both ρ and β along it are monotone.
    const rows = [{ beta: HALF_PI, rho: Math.atan(1 / Math.abs(f.kg)), J: [0, 0], V: [0, 0] }];
    for (let u = MEDIAL_STEP; u <= TIP_ZONE; u += MEDIAL_STEP) {
      const s = s0 - out * u;
      const fr = frame(s);
      const kc = sigma * fr.kg; // curvature towards the concave side
      const focal = kc > 0 ? Math.atan(1 / kc) : HALF_PI;
      // gap(r) = tip distance − r falls through 0 on (0, focal): Illinois (bracketed secant).
      const along = (r) => {
        const c = Math.cos(sigma * r);
        const n = Math.sin(sigma * r);
        return [0, 1, 2].map((k) => c * fr.C[k] + n * fr.N[k]);
      };
      const gap = (r) => polar(along(r)).rho - r;
      let lo = 0;
      let hi = focal;
      let glo = gap(lo);
      let ghi = gap(hi);
      if (ghi > 0) break;
      let r = hi;
      let side = 0;
      for (let k = 0; k < 100; k++) {
        r = (lo * ghi - hi * glo) / (ghi - glo);
        const gr = gap(r);
        if (Math.abs(gr) < 1e-16 || hi - lo < 1e-15) break;
        if (gr > 0) {
          lo = r;
          glo = gr;
          if (side === 1) ghi /= 2;
          side = 1;
        } else {
          hi = r;
          ghi = gr;
          if (side === -1) glo /= 2;
          side = -1;
        }
      }
      const d = sigma * r;
      const m = along(r);
      const { rho, beta } = polar(m);
      const last = rows.at(-1);
      if (!(beta < last.beta && rho > last.rho)) break;
      const arm = toFlat(s, d);
      const ur = flatRadial(beta);
      const tr = Math.tan(rho);
      const J = [arm[0] - (c0[0] + tr * ur[0]), arm[1] - (c0[1] + tr * ur[1])];
      // Radial geodesic direction er at m, split into the arm's ∂s (stretch sec d: the flat
      // (1 − κ tan d) over the sphere's cos d − kg sin d) and ∂d (stretch sec²d), in the flat;
      // the gnomonic chart's own radial derivative is sec²ρ·ur.
      const er = [0, 1, 2].map((k) => (Math.cos(rho) * m[k] - C0[k]) / Math.sin(rho));
      const cd = Math.cos(d);
      const sd = Math.sin(d);
      const a = dot(er, fr.T) / cd;
      const b = (-sd * dot(er, fr.C) + cd * dot(er, fr.N)) / (cd * cd);
      const fl = flatFrame(s);
      const dF = [0, 1].map((k) => a * fl.t[k] + b * fl.n[k]);
      const g = 1 + tr * tr;
      // The arm's foot moves fast near the focal point where M starts, so V fades in from there.
      // Past the bleed (M's phase beyond the edge by BLEED_PHASE) the correction fades out
      // along M: the match there would only serve band 1.
      const excess = Math.abs(bandPhase(m, spiral)) - HALF_PI;
      const keep = 1 - smoothstep((excess - BLEED_PHASE) / (MEDIAL_PHASE_MARGIN - BLEED_PHASE));
      const w = keep * smoothstep(u / V_FADE);
      rows.push({ beta, rho, J: [keep * J[0], keep * J[1]], V: [w * (dF[0] - g * ur[0]), w * (dF[1] - g * ur[1])] });
      if (keep === 0) break;
    }

    // Row of M at a given β (or ρ), linearly interpolated; both decrease (increase) along rows.
    function medialAt(key, value) {
      const sign = key === 'beta' ? -1 : 1;
      let lo = 0;
      let hi = rows.length - 1;
      const v = Math.min(Math.max(sign * value, sign * rows[0][key]), sign * rows[hi][key]);
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (sign * rows[m][key] <= v) lo = m;
        else hi = m;
      }
      const A = rows[lo];
      const B = rows[hi];
      const t = (v - sign * A[key]) / (sign * B[key] - sign * A[key]);
      const mix = (x, y) => x + (y - x) * t;
      return { rho: mix(A.rho, B.rho), J: [mix(A.J[0], B.J[0]), mix(A.J[1], B.J[1])], V: [mix(A.V[0], B.V[0]), mix(A.V[1], B.V[1])] };
    }

    // Tip correction δ(ρ, β), for β behind the tip. It must equal J on M (and, where possible,
    // match V across it) and vanish on the tip's two normal rays. Two extensions of J off M are
    // exact on M: along rays from the tip (with the V term; C¹ across M) and along circles about
    // the tip. Near M's start, M runs radially, so rays are nearly tangent to it and the ray
    // extension is steep; there the circle extension takes over (C⁰ across M; M is well inside
    // the band there). The ray extension fades in from the tip over the whole of [0, ρ_M]
    // (smoothstep, flat at M so C¹ holds; fading over half of it, as in the d model, strained the
    // tip end up to 1.16 in band 0 and 0.50–1.27 in the bleed); the circle extension is zero
    // inside ρ_F.
    function correction(rho, beta) {
      if (!(Math.abs(beta) < HALF_PI)) return [0, 0];
      const lambda = smoothstep((HALF_PI - beta - RAY_FROM) / (RAY_FULL - RAY_FROM));
      let x = 0;
      let y = 0;
      if (lambda > 0) {
        const M = medialAt('beta', beta);
        const k = lambda * smoothstep(rho / M.rho);
        const r = rho - M.rho;
        x += k * (M.J[0] + M.V[0] * r);
        y += k * (M.J[1] + M.V[1] * r);
      }
      if (lambda < 1 && rho > rows[0].rho) {
        const M = medialAt('rho', rho);
        x += (1 - lambda) * M.J[0];
        y += (1 - lambda) * M.J[1];
      }
      return [x, y];
    }

    function flatAt(rho, beta) {
      const ur = flatRadial(beta);
      const dl = correction(rho, beta);
      const tr = Math.tan(rho);
      return [c0[0] + tr * ur[0] + dl[0], c0[1] + tr * ur[1] + dl[1]];
    }

    // Inverse of flatAt: Newton in the tip's gnomonic plane (X, Y) = tan ρ·(cos β, sin β), with
    // a finite-difference Jacobian, from the plain gnomonic inverse.
    function fromFlat(x, y) {
      const at = (X, Y) => flatAt(Math.atan(Math.hypot(X, Y)), Math.atan2(Y, X));
      let X = (x - c0[0]) * g1[0] + (y - c0[1]) * g1[1];
      let Y = (x - c0[0]) * g2[0] + (y - c0[1]) * g2[1];
      const e = 1e-7;
      for (let it = 0; it < 40; it++) {
        const F = at(X, Y);
        const rx = F[0] - x;
        const ry = F[1] - y;
        if (Math.hypot(rx, ry) < 1e-15) break;
        const Fx = at(X + e, Y);
        const Fy = at(X, Y + e);
        const a = (Fx[0] - F[0]) / e;
        const c = (Fx[1] - F[1]) / e;
        const b = (Fy[0] - F[0]) / e;
        const d = (Fy[1] - F[1]) / e;
        const det = a * d - b * c;
        if (!(Math.abs(det) > 1e-9)) return { rho: Math.atan(Math.hypot(X, Y)), beta: Math.atan2(Y, X), ok: false };
        const dX = (d * rx - b * ry) / det;
        const dY = (a * ry - c * rx) / det;
        X -= dX;
        Y -= dY;
        if (Math.hypot(dX, dY) < 1e-15) break;
      }
      const F = at(X, Y);
      const ok = Math.hypot(F[0] - x, F[1] - y) < 1e-12;
      return { rho: Math.atan(Math.hypot(X, Y)), beta: Math.atan2(Y, X), ok };
    }

    // α (from T toward N, the ruling's convention) ↔ β.
    const alphaOf = (beta) => Math.atan2(sigma * Math.sin(beta), out * Math.cos(beta));
    const betaOf = (alpha) => Math.atan2(sigma * Math.sin(alpha), out * Math.cos(alpha));

    return { name, s0, c0, polar, sphereAt, flatAt, fromFlat, alphaOf, betaOf };
  }
  const tips = [makeTip('tipN', 0, -1), makeTip('tipS', length, 1)];
  const tipByName = { tipN: tips[0], tipS: tips[1] };

  // ---- Charts ------------------------------------------------------------------------------
  const tipPoint = (tip, rho, beta) => ({ cell: tip.name, s: tip.s0, d: NaN, rho, alpha: tip.alphaOf(beta), ok: true });

  // Closest-point coordinates of a sphere point. ok = false only if no foot converged.
  function sphereToStrip(p, sGuess) {
    const foot = interiorFoot(p, sGuess);
    let best = foot ? Math.abs(foot.d) : Infinity;
    let cell = null;
    for (const tip of tips) {
      const { rho, beta } = tip.polar(p);
      if (Math.abs(beta) < HALF_PI && rho < best) {
        best = rho;
        cell = tipPoint(tip, rho, beta);
      }
    }
    if (cell) return cell;
    if (!foot) return { cell: 'strip', s: 0, d: 0, ok: false };
    return { cell: 'strip', s: foot.s, d: foot.d, ok: true };
  }

  function stripToSphere(pt) {
    if (pt.cell === 'strip') return toSphere(pt.s, pt.d);
    const tip = tipByName[pt.cell];
    return tip.sphereAt(pt.rho, tip.betaOf(pt.alpha));
  }

  function stripToFlat(pt) {
    if (pt.cell === 'strip') return toFlat(pt.s, pt.d);
    const tip = tipByName[pt.cell];
    return tip.flatAt(pt.rho, tip.betaOf(pt.alpha));
  }

  // A flat foot (s, d) is the image of a sphere strip point iff that point's nearest foot is s:
  // it must be a maximum of p·C (inside the sphere focal distance), not nearer to a tip, and not
  // nearer to another arm of C. Medial axes between two arms come within REACH of C only for
  // feet within 2.22 of a tip, and there no nearer than 0.38 (Clelia 6, measured); band + bleed
  // reach |d| ≤ 0.30, so that full check runs only for pixels well outside the piece.
  function stripValid(s, d, kappa) {
    if (Math.abs(d) > ARM_CHECK && Math.min(s, length - s) < ARM_ZONE) {
      const foot = interiorFoot(toSphere(s, d), s);
      if (foot && Math.abs(foot.d) < Math.abs(d) - 1e-12) return false;
    }
    for (const tip of tips) {
      if (Math.abs(s - tip.s0) > TIP_ZONE) continue;
      // Focal check, only where it can fail (kg·tan d ≥ 1 there; flat and sphere foci coincide).
      if (Math.abs(kappa * Math.tan(d)) > 0.9 && !(Math.cos(d) - frame(s).kg * Math.sin(d) > 0)) return false;
      // The tip can only be nearer than the foot if C(s) is within 2|d| of it (the tips sit
      // at the poles, within 1e-9).
      const theta = thetaAt(s);
      if (Math.min(theta, Math.PI - theta) - 1e-8 > 2 * Math.abs(d)) continue;
      const { rho, beta } = tip.polar(toSphere(s, d));
      if (Math.abs(beta) < HALF_PI && rho < Math.abs(d)) return false;
    }
    return true;
  }

  // ---- Flat lookup grid ---------------------------------------------------------------------
  // Each cell lists the runs of coarse samples whose flat point lies within REACH (plus the
  // cell's half diagonal and a sample spacing) of the cell, so every foot within REACH of a
  // query point is inside one of its cell's runs.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let j = 0; j <= nC; j++) {
    minX = Math.min(minX, cX[j]);
    maxX = Math.max(maxX, cX[j]);
    minY = Math.min(minY, cY[j]);
    maxY = Math.max(maxY, cY[j]);
  }
  const pad = REACH + GRID;
  minX -= pad;
  minY -= pad;
  const gw = Math.ceil((maxX + pad - minX) / GRID);
  const gh = Math.ceil((maxY + pad - minY) / GRID);
  const cellRuns = Array.from({ length: gw * gh }, () => []);
  const incl2 = (REACH + GRID * Math.SQRT1_2 + COARSE) ** 2;
  const span = Math.ceil(Math.sqrt(incl2) / GRID);
  for (let j = 0; j <= nC; j++) {
    const ci = Math.floor((cX[j] - minX) / GRID);
    const cj = Math.floor((cY[j] - minY) / GRID);
    for (let b = Math.max(0, cj - span); b <= Math.min(gh - 1, cj + span); b++) {
      const dy = cY[j] - (minY + (b + 0.5) * GRID);
      for (let a = Math.max(0, ci - span); a <= Math.min(gw - 1, ci + span); a++) {
        const dx = cX[j] - (minX + (a + 0.5) * GRID);
        if (dx * dx + dy * dy > incl2) continue;
        const runs = cellRuns[b * gw + a];
        const last = runs.at(-1);
        if (last && j - last[1] <= 3) last[1] = j; // samples arrive in order
        else runs.push([j, j]);
      }
    }
  }
  const cellAt = (x, y) => {
    const a = Math.floor((x - minX) / GRID);
    const b = Math.floor((y - minY) / GRID);
    return a >= 0 && b >= 0 && a < gw && b < gh ? cellRuns[b * gw + a] : null;
  };

  // Nearest point of the flat centre line near s0: Newton on g = (q − c)·t, slope −1 + κ·u
  // (u = flat offset), bracketed in [lo, hi] when given. Returns the foot with the sphere offset
  // d = atan u, or null if it does not converge to a minimum.
  function flatFoot(x, y, s0, lo, hi, maxIt) {
    let s = s0;
    let a = lo;
    let b = hi;
    for (let it = 0; it < maxIt; it++) {
      evalFlat(s);
      const qx = x - fX;
      const qy = y - fY;
      const g = qx * fCos + qy * fSin;
      const u = qy * fCos - qx * fSin;
      const kappa = fKappa;
      const gp = -1 + kappa * u;
      // g falls through 0 at a minimum. g = 0 exactly at a maximum (a tip's own foot, for a
      // point exactly on its normal past the focal point) says nothing about the side.
      if (g > 0) a = s;
      else if (g < 0 || gp < 0) b = s;
      let next = gp < 0 ? s - g / gp : NaN;
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (!(next >= a && next <= b)) next = 0.5 * (a + b);
      } else if (!Number.isFinite(next) || Math.abs(next - s) > 0.05) {
        return null; // unbracketed and not converging: leave it to the bracketed search
      }
      if (Math.abs(next - s) < 1e-12) {
        // Converged: s is within 1e-12 of the root, so (s, d) reproduces q to ~1e-12·|g′|.
        if (!(s >= 0 && s <= length) || !(gp < 0)) return null;
        if ((s <= 0 || s >= length) && Math.abs(g) > 1e-9) return null;
        return { s, d: Math.atan(u), kappa, dist: Math.hypot(qx, qy) };
      }
      s = next;
    }
    return null;
  }

  // Exact inverse of the forward map. With a good sGuess (a neighbouring pixel's s) this is a
  // few Newton steps; otherwise every flat foot from the lookup grid is tried, then the tips.
  function flatToStrip(x, y, sGuess) {
    const fail = () => ({ cell: 'strip', s: Number.isFinite(sGuess) ? Math.min(Math.max(sGuess, 0), length) : 0, d: 0, ok: false });
    const runs = cellAt(x, y);
    if (!runs || runs.length === 0) return fail();
    if (Number.isFinite(sGuess)) {
      const g = Math.min(Math.max(sGuess, 0), length);
      const j = sampleIndex(g);
      // runs.length === 1 is the only case the guess can settle (below).
      if (runs.length === 1 && j >= runs[0][0] - 1 && j <= runs[0][1] + 1) {
        const foot = flatFoot(x, y, g, -Infinity, Infinity, 8);
        if (foot && foot.dist <= REACH && stripValid(foot.s, foot.d, foot.kappa)) {
          return { cell: 'strip', s: foot.s, d: foot.d, ok: true };
        }
      }
    }
    // Every local minimum of the flat distance along the cell's runs.
    const feet = [];
    for (const [a, b] of runs) {
      let prev = Infinity;
      let cur = Math.hypot(x - cX[a], y - cY[a]);
      for (let j = a; j <= b; j++) {
        const next = j < b ? Math.hypot(x - cX[j + 1], y - cY[j + 1]) : Infinity;
        if (cur <= prev && cur <= next) {
          const foot = flatFoot(x, y, sampleS(j), sampleS(Math.max(0, j - 1)), sampleS(Math.min(nC, j + 1)), 100);
          if (foot && foot.dist <= REACH && !feet.some((f) => Math.abs(f.s - foot.s) < 1e-9)) feet.push(foot);
        }
        prev = cur;
        cur = next;
      }
    }
    feet.sort((p, q) => p.dist - q.dist);
    for (const foot of feet) {
      if (stripValid(foot.s, foot.d, foot.kappa)) return { cell: 'strip', s: foot.s, d: foot.d, ok: true };
    }
    for (const tip of tips) {
      if (Math.hypot(x - tip.c0[0], y - tip.c0[1]) > REACH) continue;
      const { rho, beta, ok } = tip.fromFlat(x, y);
      if (!ok || !(Math.abs(beta) < HALF_PI)) continue;
      const foot = interiorFoot(tip.sphereAt(rho, beta));
      if (!foot || rho <= Math.abs(foot.d) + 1e-12) return tipPoint(tip, rho, beta);
    }
    // No consistent preimage: only where the forward map is discontinuous, far out in band 1
    // past the end of the tip correction. ok = false; s, d are the nearest flat foot (a usable
    // guess for the next pixel), not a preimage.
    if (feet.length) return { cell: 'strip', s: feet[0].s, d: feet[0].d, ok: false };
    return fail();
  }

  // ---- Band edge ----------------------------------------------------------------------------
  // Signed geodesic distance (R units) from p to the edge of band 0, positive inside. Away from
  // the poles: the phase margin over |∇phase| = √(1 + λ′² sin²θ) / sinθ (exact on the edge,
  // first order off it, within 1.5% up to 0.04 R from it). It is a sphere distance: across the
  // edge the flat map stretches by sec²d (strip cells; ≈ 1.07 at the body's edge), so a flat
  // distance there is ≈ sec²d·edgeDistance.
  function edgeDistance(p) {
    const theta = Math.acos(clamp1(p[2]));
    const st = Math.sin(theta);
    const dl = spiral.dLambda(theta);
    const first = ((HALF_PI - Math.abs(bandPhase(p, spiral))) * st) / Math.sqrt(1 + dl * dl * st * st);
    const w =
      smoothstep((EDGE_EXACT_POLE - Math.min(theta, Math.PI - theta)) / EDGE_BLEND_POLE) *
      smoothstep((EDGE_EXACT_BAND - Math.abs(first)) / EDGE_BLEND_BAND);
    if (w === 0) return first;
    // Near the poles the seams curl tightly and meet, so measure the distance to them
    // exactly: each seam is C rotated by ±π/2 about z, and its ends are the poles.
    const toSeam = (q) => {
      const foot = interiorFoot(q);
      return Math.min(foot ? Math.abs(foot.d) : Infinity, theta, Math.PI - theta);
    };
    const dist = Math.min(toSeam([p[1], -p[0], p[2]]), toSeam([-p[1], p[0], p[2]]));
    return first + w * ((first < 0 ? -dist : dist) - first);
  }

  // Flat seams from the north tip to the south tip: the images of the sphere seams
  // phase = ±π/2. Each seam is C rotated by ±π/2 about z, so it has C's arc length, and
  // sampling it at C's arc-length steps gives vertices about `step` apart.
  function seams(step = 0.002) {
    const pos = [];
    const neg = [];
    const count = Math.max(1, Math.ceil(length / step));
    let hintPos;
    let hintNeg;
    for (let i = 0; i <= count; i++) {
      const s = i === count ? length : i * step;
      const C = frame(s).C;
      const a = sphereToStrip([-C[1], C[0], C[2]], hintPos);
      const b = sphereToStrip([C[1], -C[0], C[2]], hintNeg);
      hintPos = a.s;
      hintNeg = b.s;
      pos.push(stripToFlat(a));
      neg.push(stripToFlat(b));
    }
    return { pos, neg };
  }

  return { length, flatFrame, toFlat, toSphere, sphereToStrip, flatToStrip, stripToSphere, stripToFlat, edgeDistance, seams };
}
