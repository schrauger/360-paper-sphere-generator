// Distance from a point to a polyline (open or closed), with a uniform grid so that a query
// only visits the segments near the point. Shared by measure-tabs.mjs and the shape regression.

/** Points every `step` along a polyline (the first vertex of each segment is kept). */
export function resample(points, step, { closed = true } = {}) {
  const out = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/**
 * Index over the segments of a polyline. nearest(x, y) returns { dist, seg, t } for the closest
 * point (segment index and parameter along it), searching up to `maxDist` (default 50, in the polyline's units);
 * dist is Infinity if nothing is that close.
 */
export function makePolylineIndex(points, { closed = true, cell = 5 } = {}) {
  const n = points.length;
  const segCount = closed ? n : n - 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const gw = Math.floor((maxX - minX) / cell) + 1;
  const gh = Math.floor((maxY - minY) / cell) + 1;
  const cells = Array.from({ length: gw * gh }, () => []);
  const cx = (x) => Math.floor((x - minX) / cell);
  const cy = (y) => Math.floor((y - minY) / cell);
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = cy(Math.min(a[1], b[1])); j <= cy(Math.max(a[1], b[1])); j++) {
      for (let k = cx(Math.min(a[0], b[0])); k <= cx(Math.max(a[0], b[0])); k++) cells[j * gw + k].push(i);
    }
  }
  function nearest(x, y, maxDist = 50) {
    let best = { dist: Infinity, seg: -1, t: 0 };
    const i0 = Math.max(0, cx(x - maxDist));
    const i1 = Math.min(gw - 1, cx(x + maxDist));
    const j0 = Math.max(0, cy(y - maxDist));
    const j1 = Math.min(gh - 1, cy(y + maxDist));
    for (let j = j0; j <= j1; j++) {
      for (let k = i0; k <= i1; k++) {
        for (const i of cells[j * gw + k]) {
          const a = points[i];
          const b = points[(i + 1) % n];
          const ex = b[0] - a[0];
          const ey = b[1] - a[1];
          const l2 = ex * ex + ey * ey;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2)) : 0;
          const d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey);
          if (d < best.dist) best = { dist: d, seg: i, t };
        }
      }
    }
    return best;
  }
  return { nearest };
}
