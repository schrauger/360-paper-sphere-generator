// SVG cut file: mm units, y down. Cut paths are red and the registration marks black, so a
// Silhouette Studio user can cut by line colour and skip the marks.
import { markOutlines } from '../render/marks.js';
import { layoutInMm } from './pieces.js';
import { smoothClosedPath, smoothOpenPath } from './smooth.js';
import { tieRuns } from './ties.js';

const f4 = (v) => v.toFixed(4);
const d = (pts) => `M${pts.map(([x, y]) => `${f4(x)} ${f4(y)}`).join(' L')} Z`;

// Cut paths are smoothed: straight lines and cubic Béziers, corners kept sharp.
const smoothSub = ({ start, segs }) => `M${f4(start[0])} ${f4(start[1])} ${segs.map((s) => (s.type === 'C'
  ? `C${f4(s.c1[0])} ${f4(s.c1[1])} ${f4(s.c2[0])} ${f4(s.c2[1])} ${f4(s.to[0])} ${f4(s.to[1])}`
  : `L${f4(s.to[0])} ${f4(s.to[1])}`)).join(' ')}`;
const smoothD = (path) => `${smoothSub(path)} Z`;

// With ties the cut is open runs between the tab-tip gaps (no Z); a path without tabs stays closed.
const cutD = (pts, tieMm) => {
  const runs = tieMm ? tieRuns(pts, tieMm) : null;
  return runs ? runs.map((r) => smoothSub(smoothOpenPath(r))).join(' ') : smoothD(smoothClosedPath(pts));
};

export function cutPathSvg(layout, outline, { includeMarks = false, tieMm = null } = {}) {
  const { widthMm, heightMm, cuts, marks } = layoutInMm(layout, outline, includeMarks, markOutlines);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f4(widthMm)}mm" height="${f4(heightMm)}mm" viewBox="0 0 ${f4(widthMm)} ${f4(heightMm)}">`,
    '<g id="cut">',
    ...cuts.map((p) => `<path d="${cutD(p, tieMm)}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`),
    '</g>',
  ];
  if (includeMarks) {
    out.push('<g id="registration">', ...marks.map((p) => `<path d="${d(p)}" fill="#000" stroke="none"/>`), '</g>');
  }
  out.push('</svg>', '');
  return out.join('\n');
}
