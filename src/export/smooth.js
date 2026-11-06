// Turns a dense closed polyline (mm) into straight lines and cubic Béziers for the cut file.
// Corners (sharp turns, e.g. tab corners) stay sharp; between them the points are fitted with
// Schneider's least-squares Bézier fit, and runs that are straight within tolerance become lines.
// Pure and deterministic: the same points always give the same path.

/** Largest allowed distance, in mm, between the smoothed path and the original polyline. */
export const SMOOTH_TOLERANCE_MM = 0.02;
/** A vertex that turns more than this (radians, 25 degrees) is a corner and stays sharp. */
export const CORNER_ANGLE = (25 * Math.PI) / 180;

const DUPLICATE_MM = 0.01; // points closer than this to the previous kept point are dropped
const FIT_TOLERANCE_MM = 0.012; // fit target, under SMOOTH_TOLERANCE_MM to leave slack for sampling
const TANGENT_WINDOW_MM = 0.4; // arc length used to estimate a tangent
const CHECK_SAMPLES = 40;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a); return l === 0 ? [0, 0] : [a[0] / l, a[1] / l]; };

const turnAt = (ring, i) => {
  const n = ring.length;
  const a = sub(ring[i], ring[(i - 1 + n) % n]);
  const b = sub(ring[(i + 1) % n], ring[i]);
  return Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b)));
};

/**
 * Prepare a closed polyline: drop repeated and near-duplicate points (never a corner, so real
 * corners keep their exact coordinates) and find the corners, the vertices that turn by more
 * than CORNER_ANGLE. Returns { ring, corners } with corners as indices into ring.
 */
function prepare(points) {
  const raw = points.filter((p, i) => len(sub(p, points[(i + 1) % points.length])) > 0);
  const isCorner = raw.map((_, i) => raw.length >= 3 && turnAt(raw, i) > CORNER_ANGLE);
  const ring = []; const flags = [];
  raw.forEach((p, i) => {
    const k = ring.length - 1;
    if (k >= 0 && len(sub(p, ring[k])) < DUPLICATE_MM) {
      if (isCorner[i] && !flags[k]) { ring[k] = p; flags[k] = true; }
    } else { ring.push(p); flags.push(isCorner[i]); }
  });
  while (ring.length > 1 && len(sub(ring[0], ring[ring.length - 1])) < DUPLICATE_MM) {
    if (flags[0] && !flags[flags.length - 1]) { ring.pop(); flags.pop(); } else if (!flags[0]) { ring.shift(); flags.shift(); } else break;
  }
  return { ring, corners: flags.flatMap((f, i) => (f ? [i] : [])) };
}

/** Ring indices from `i` to `j` going forward (wrapping), inclusive, as points. */
function runPoints(ring, i, j) {
  const n = ring.length;
  const out = [];
  for (let k = i; ; k = (k + 1) % n) { out.push(ring[k]); if (k === j) break; }
  return out;
}

// Unit tangent at pts[i] pointing along the run, estimated over TANGENT_WINDOW_MM of arc length.
function tangentAt(pts, i, dir) {
  let acc = 0;
  let j = i;
  const limit = Math.min(TANGENT_WINDOW_MM, runLength(pts) / 4);
  while (acc < limit && j + dir >= 0 && j + dir < pts.length) { acc += len(sub(pts[j + dir], pts[j])); j += dir; }
  return unit(sub(pts[j], pts[i]));
}
const runLength = (pts) => pts.slice(1).reduce((s, p, k) => s + len(sub(p, pts[k])), 0);

const bez = (p0, c1, c2, p3, t) => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
  ];
};
const bezD1 = (p0, c1, c2, p3, t) => {
  const u = 1 - t;
  return [
    3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]),
    3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1]),
  ];
};
const bezD2 = (p0, c1, c2, p3, t) => {
  const u = 1 - t;
  return [
    6 * u * (c2[0] - 2 * c1[0] + p0[0]) + 6 * t * (p3[0] - 2 * c2[0] + c1[0]),
    6 * u * (c2[1] - 2 * c1[1] + p0[1]) + 6 * t * (p3[1] - 2 * c2[1] + c1[1]),
  ];
};

const distToSegment = (p, a, b) => {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return len(sub(p, add(a, mul(d, t))));
};
const distToPolyline = (p, poly) => {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i - 1], poly[i]));
  return best;
};

// Worst distance from the points to the sampled curve and from the curve samples to the points.
function trueError(pts, curve) {
  const [p0, c1, c2, p3] = curve;
  const samples = [];
  const count = Math.max(CHECK_SAMPLES, Math.ceil(runLength(pts) / 0.05));
  for (let k = 0; k <= count; k++) samples.push(bez(p0, c1, c2, p3, k / count));
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, distToPolyline(p, samples));
  for (const s of samples) worst = Math.max(worst, distToPolyline(s, pts));
  return worst;
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  return u.map((v) => v / u[u.length - 1]);
}

// Least-squares control-point distances for fixed end tangents (Schneider).
function generate(pts, u, t1, t2) {
  const p0 = pts[0]; const p3 = pts[pts.length - 1];
  let c00 = 0; let c01 = 0; let c11 = 0; let x0 = 0; let x1 = 0;
  pts.forEach((p, i) => {
    const t = u[i]; const s = 1 - t;
    const b0 = s * s * s; const b1 = 3 * s * s * t; const b2 = 3 * s * t * t; const b3 = t * t * t;
    const a1 = mul(t1, b1); const a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(p, add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  });
  const det = c00 * c11 - c01 * c01;
  const chord = len(sub(p3, p0));
  let alpha1 = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let alpha2 = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  if (alpha1 < 1e-6 * chord || alpha2 < 1e-6 * chord) { alpha1 = chord / 3; alpha2 = chord / 3; }
  return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3];
}

function reparameterize(pts, u, curve) {
  const [p0, c1, c2, p3] = curve;
  return u.map((t, i) => {
    const d = sub(bez(p0, c1, c2, p3, t), pts[i]);
    const d1 = bezD1(p0, c1, c2, p3, t); const d2 = bezD2(p0, c1, c2, p3, t);
    const den = dot(d1, d1) + dot(d, d2);
    return den === 0 ? t : Math.max(0, Math.min(1, t - dot(d, d1) / den));
  });
}

const straightEnough = (pts) => pts.every((p) => distToSegment(p, pts[0], pts[pts.length - 1]) <= FIT_TOLERANCE_MM)
  && trueError(pts, [pts[0], pts[0], pts[pts.length - 1], pts[pts.length - 1]]) <= FIT_TOLERANCE_MM;

// Fit pts (one smooth run) with lines and cubics, splitting where the error is too large.
function fit(pts, t1, t2, out) {
  const last = pts[pts.length - 1];
  if (pts.length === 2 || straightEnough(pts)) { out.push({ type: 'L', to: last }); return; }
  let u = chordParams(pts);
  let curve = generate(pts, u, t1, t2);
  for (let iter = 0; iter < 6; iter++) {
    if (trueError(pts, curve) <= FIT_TOLERANCE_MM) {
      out.push({ type: 'C', c1: curve[1], c2: curve[2], to: last });
      return;
    }
    u = reparameterize(pts, u, curve);
    curve = generate(pts, u, t1, t2);
  }
  if (trueError(pts, curve) <= FIT_TOLERANCE_MM) { out.push({ type: 'C', c1: curve[1], c2: curve[2], to: last }); return; }
  // Split at the point farthest from the curve, with a shared tangent.
  const [p0, c1, c2, p3] = curve;
  let split = 1; let worst = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const e = len(sub(bez(p0, c1, c2, p3, u[i]), pts[i]));
    if (e > worst) { worst = e; split = i; }
  }
  const mid = unit(sub(pts[Math.max(0, split - 1)], pts[Math.min(pts.length - 1, split + 1)]));
  const midBack = mid; const midFwd = mul(mid, -1);
  fit(pts.slice(0, split + 1), t1, midBack, out);
  fit(pts.slice(split), midFwd, t2, out);
}

/**
 * Smooth a closed polyline (mm) into { start, segs } where each seg is { type: 'L', to } or
 * { type: 'C', c1, c2, to }; the last seg ends at `start`.
 */
export function smoothClosedPath(points) {
  const { ring, corners } = prepare(points);
  const n = ring.length;
  if (n < 3) return { start: ring[0], segs: ring.slice(1).concat([ring[0]]).map((to) => ({ type: 'L', to })) };
  let anchors = corners;
  const sharp = new Set(anchors);
  if (anchors.length === 0) anchors = [0, Math.floor(n / 2)];
  const segs = [];
  anchors.forEach((a, k) => {
    const b = anchors[(k + 1) % anchors.length];
    const pts = runPoints(ring, a, b);
    // Corner ends: tangent along the run. Smooth ends: tangent of the whole ring there.
    const startT = sharp.has(a) ? tangentAt(pts, 0, 1) : unit(sub(ring[(a + 1) % n], ring[(a - 1 + n) % n]));
    const endT = sharp.has(b) ? tangentAt(pts, pts.length - 1, -1) : unit(sub(ring[(b - 1 + n) % n], ring[(b + 1) % n]));
    fit(pts, startT, endT, segs);
  });
  return { start: ring[anchors[0]], segs };
}

/** Points along a smoothed path (including the start), about `step` mm apart on each segment. */
export function sampleSmoothPath(path, step = 0.01) {
  const out = [path.start];
  let from = path.start;
  for (const s of path.segs) {
    const c = s.type === 'C' ? [from, s.c1, s.c2, s.to] : [from, from, s.to, s.to];
    const chord = s.type === 'C' ? len(sub(s.c1, from)) + len(sub(s.c2, s.c1)) + len(sub(s.to, s.c2)) : len(sub(s.to, from));
    const count = Math.max(1, Math.ceil(chord / step));
    for (let k = 1; k <= count; k++) out.push(s.type === 'C' ? bez(...c, k / count) : add(from, mul(sub(s.to, from), k / count)));
    from = s.to;
  }
  return out;
}

// Douglas-Peucker on pts[0..n-1], keeping the endpoints.
function dp(pts, tol, out) {
  const a = pts[0]; const b = pts[pts.length - 1];
  let worst = -1; let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const e = distToSegment(pts[i], a, b);
    if (e > worst) { worst = e; at = i; }
  }
  if (worst > tol) { dp(pts.slice(0, at + 1), tol, out); dp(pts.slice(at), tol, out); } else out.push(b);
}

/**
 * A closed polyline with near-duplicate points dropped and collinear runs merged, within
 * SMOOTH_TOLERANCE_MM of the input; corners are kept. Vertices are a subset of the input's.
 */
export function simplifyClosed(points) {
  const { ring, corners } = prepare(points);
  const n = ring.length;
  if (n < 4) return ring;
  let anchors = corners;
  if (anchors.length === 0) anchors = [0, Math.floor(n / 2)];
  const out = [];
  anchors.forEach((a, k) => {
    const b = anchors[(k + 1) % anchors.length];
    out.push(ring[a]);
    const tail = [];
    dp(runPoints(ring, a, b), SMOOTH_TOLERANCE_MM, tail);
    out.push(...tail.slice(0, -1));
  });
  return out;
}
