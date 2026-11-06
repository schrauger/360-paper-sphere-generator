// Glue tabs, built in the flat plane. The chart is only valid ≈ 0.036 R past the band edge, so a
// tab is never mapped to the sphere beyond its base: its outer vertices are placed from the flat
// seam polyline and the flat outward normal. MODEL_360CRAFT.tabs says where and what shape.
import { polygonArea } from './polygon.js';

const SEAM_STEP = 0.002; // R, spacing of the seam samples (develop.js default)
const cache = new WeakMap();

/**
 * Flat seams of an unrolling (pos and neg, north tip to south tip) with the arc length of each
 * vertex on the sphere (the centre line's s) and in the flat, and which side of the outline
 * is outward. Cached per unrolling.
 */
export function seamData(unrolling) {
  if (cache.has(unrolling)) return cache.get(unrolling);
  const { pos, neg } = unrolling.seams(SEAM_STEP);
  const L = unrolling.length;
  const side = (pts) => {
    const sphere = pts.map((_, i) => Math.min(i * SEAM_STEP, L));
    const flat = [0];
    for (let i = 1; i < pts.length; i++) flat.push(flat[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, arc: { sphere, flat } };
  };
  // Outline order: pos forward, neg backward (ends dropped: they are the tips).
  const outline = [...pos, ...neg.slice(1, -1).reverse()];
  const data = { pos: side(pos), neg: side(neg), outwardLeft: polygonArea(outline) < 0 };
  cache.set(unrolling, data);
  return data;
}

// Seam position at arc length σ: vertex index (fractional) and point.
function seamAt(side, arc, sigma) {
  let lo = 0;
  let hi = arc.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= sigma) lo = mid;
    else hi = mid;
  }
  const t = Math.min(1, Math.max(0, (sigma - arc[lo]) / (arc[hi] - arc[lo])));
  const a = side.pts[lo];
  const b = side.pts[hi];
  return { index: lo + t, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

/**
 * Tabs of one seam, in outline order. Each tab: { polygon, A, B, base: [index0, index1], outer }
 * where A→B is the base along the seam in outline order (seam indices, fractional, increasing
 * from base[0] to base[1]), outer the outer vertices from A's side to B's, and polygon the
 * closed tab (base vertices then the outer vertices backwards).
 */
export function tabPlacements(unrolling, seamSide, spec) {
  const data = seamData(unrolling);
  const side = seamSide > 0 ? data.pos : data.neg;
  const arc = side.arc[spec.along];
  const total = arc[arc.length - 1];
  const start = seamSide > 0 ? spec.startPos : spec.startNeg;
  const shape = seamSide > 0 ? spec.outer.pos : spec.outer.neg;
  const out = [];
  for (let k = 0; ; k++) {
    const sigma = start + k * spec.pitch;
    if (sigma + spec.length > total + 1e-9) break;
    const p0 = seamAt(side, arc, sigma);
    const p1 = seamAt(side, arc, sigma + spec.length);
    // Seam vertices strictly between the two base ends.
    const inner = [];
    for (let i = Math.floor(p0.index) + 1; i <= Math.floor(p1.index); i++) {
      if (i > p0.index && i < p1.index) inner.push(side.pts[i]);
    }
    const forward = seamSide > 0;
    const A = forward ? p0.point : p1.point;
    const B = forward ? p1.point : p0.point;
    const baseIdx = forward ? [p0.index, p1.index] : [p1.index, p0.index]; // along the seam array
    const basePts = forward ? [A, ...inner, B] : [A, ...inner.reverse(), B];
    const chord = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const t = [(B[0] - A[0]) / chord, (B[1] - A[1]) / chord];
    const n = data.outwardLeft ? [-t[1], t[0]] : [t[1], -t[0]];
    const outer = shape.map(([anchor, dx, h]) => [
      A[0] + (B[0] - A[0]) * anchor + (dx * t[0] + h * n[0]) * chord,
      A[1] + (B[1] - A[1]) * anchor + (dx * t[1] + h * n[1]) * chord,
    ]);
    out.push({ polygon: [...basePts, ...outer.slice().reverse()], A, B, base: baseIdx, outer });
  }
  return out;
}

/** Flat polygons (R units) of the tabs on one seam: seamSide +1 is the pos seam, −1 the neg seam. */
export function placeTabs(unrolling, seamSide, tabsSpec) {
  return tabPlacements(unrolling, seamSide, tabsSpec).map((t) => t.polygon);
}
