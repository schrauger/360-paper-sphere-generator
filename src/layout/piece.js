// The cut outline of one piece: the band edge plus its glue tabs.
import { seamData, tabPlacements } from './tabs.js';

/**
 * PieceOutline { edge, tabs, cutPath } in flat R units (y up).
 *  - edge: the closed band boundary, pos seam forward then neg seam backward;
 *  - tabs: the tab polygons, pos seam's first, each in outline order;
 *  - cutPath: the closed boundary of edge ∪ tabs: each tab's outer vertices replace the seam
 *    between the tab's base ends.
 */
export function buildPieceOutline(unrolling, tabsSpec) {
  const { pos, neg } = seamData(unrolling);
  const n = pos.pts.length;
  const edge = [...pos.pts, ...neg.pts.slice(1, -1).reverse()];
  // Position along `edge` of a seam index: pos i ↦ i; neg m ↦ 2n − 2 − m (neg is reversed).
  const placed = [];
  for (const t of tabPlacements(unrolling, +1, tabsSpec)) placed.push({ ...t, u: t.base });
  for (const t of tabPlacements(unrolling, -1, tabsSpec)) placed.push({ ...t, u: [2 * n - 2 - t.base[0], 2 * n - 2 - t.base[1]] });
  // Tab bases never overlap, so ordering by base start is enough.
  const order = [...placed].sort((a, b) => a.u[0] - b.u[0]);
  const cutPath = [];
  let last = -1;
  for (const t of order) {
    for (let i = last + 1; i < edge.length && i < t.u[0] - 1e-9; i++) cutPath.push(edge[i]);
    cutPath.push(t.A, ...t.outer, t.B);
    last = Math.floor(t.u[1] + 1e-9);
  }
  for (let i = last + 1; i < edge.length; i++) cutPath.push(edge[i]);
  return { edge, tabs: placed.map((t) => t.polygon), cutPath };
}
