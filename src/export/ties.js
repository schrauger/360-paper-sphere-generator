// Tab ties: small uncut bridges at the middle of each tab's tip, so the pieces stay attached to the
// sheet until punched out. A tie is a gap in the cut path, which then becomes a set of open runs.
import { prepare } from './smooth.js';

/** Default tie width (the uncut length along the tab tip), and the allowed range, in mm. */
export const TIE_WIDTH_MM = 0.5;
export const TIE_WIDTH_RANGE_MM = [0.1, 3];

const TAB_CORNERS = 5; // a tab adds five sharp corners: base A, three outer vertices, base B
const MAX_GAP_SHARE = 0.8; // a gap never spans more than this share of the tip edge

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Tab tips of a prepared ring: [{ a, b }] ring indices of each tip edge's ends, in ring order.
// Each tab is a run of five consecutive corner vertices; its tip is the longest of the four edges
// between them (the outermost edge, parallel to the seam).
function tipsOf(ring, corners) {
  const n = ring.length;
  const isCorner = new Set(corners);
  const starts = corners.filter((c) => !isCorner.has((c - 1 + n) % n));
  const tips = [];
  for (const s of starts) {
    const run = [s];
    while (isCorner.has((run[run.length - 1] + 1) % n) && run.length <= TAB_CORNERS) run.push((run[run.length - 1] + 1) % n);
    if (run.length !== TAB_CORNERS) continue;
    let best = 0;
    for (let k = 1; k < TAB_CORNERS - 1; k++) if (dist(ring[run[k]], ring[run[k + 1]]) > dist(ring[run[best]], ring[run[best + 1]])) best = k;
    tips.push({ a: run[best], b: run[best + 1] });
  }
  return tips.sort((x, y) => x.a - y.a);
}

/** The tip edge of every tab on a closed cut path (mm): [[start, end], …] in path order. */
export function tabTips(points) {
  const { ring, corners } = prepare(points);
  return tipsOf(ring, corners).map(({ a, b }) => [ring[a], ring[b]]);
}

/**
 * The cut path with a gap of `widthMm` centred on each tab tip: an array of open polylines (mm),
 * each running from one gap to the next with its corners intact. Null when the path has no tabs.
 */
export function tieRuns(points, widthMm) {
  const { ring, corners } = prepare(points);
  const tips = tipsOf(ring, corners);
  if (!tips.length) return null;
  const n = ring.length;
  const gaps = tips.map(({ a, b }) => {
    const [p, q] = [ring[a], ring[b]];
    const half = Math.min(widthMm, MAX_GAP_SHARE * dist(p, q)) / 2;
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const u = [(q[0] - p[0]) / dist(p, q), (q[1] - p[1]) / dist(p, q)];
    return { before: [m[0] - u[0] * half, m[1] - u[1] * half], after: [m[0] + u[0] * half, m[1] + u[1] * half] };
  });
  return tips.map((tip, k) => {
    const next = tips[(k + 1) % tips.length];
    const run = [gaps[k].after];
    for (let i = tip.b; ; i = (i + 1) % n) { run.push(ring[i]); if (i === next.a) break; }
    run.push(gaps[(k + 1) % tips.length].before);
    return run;
  });
}
