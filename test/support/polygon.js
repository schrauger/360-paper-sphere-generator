/** True if the closed polygon has no two non-adjacent edges that touch or cross. */
export function isSimplePolygon(points) {
  const n = points.length;
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSeg = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  const intersects = (p1, p2, p3, p4) => {
    const d1 = orient(p3, p4, p1);
    const d2 = orient(p3, p4, p2);
    const d3 = orient(p1, p2, p3);
    const d4 = orient(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return (d1 === 0 && onSeg(p3, p4, p1)) || (d2 === 0 && onSeg(p3, p4, p2)) || (d3 === 0 && onSeg(p1, p2, p3)) || (d4 === 0 && onSeg(p1, p2, p4));
  };
  // Sort edges by min x and sweep: only edges whose x ranges overlap can meet.
  const edges = points.map((p, i) => {
    const q = points[(i + 1) % n];
    return { i, p, q, x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]) };
  });
  edges.sort((a, b) => a.x0 - b.x0);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n && edges[b].x0 <= edges[a].x1; b++) {
      const gap = Math.abs(edges[a].i - edges[b].i);
      if (gap === 1 || gap === n - 1) continue; // adjacent edges share a vertex
      if (intersects(edges[a].p, edges[a].q, edges[b].p, edges[b].q)) return false;
    }
  }
  return true;
}

/** Ray-casting point-in-polygon. */
export function insidePolygon(points, [x, y]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
