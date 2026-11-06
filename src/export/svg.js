// SVG cut file: mm units, y down. Cut paths are red and the registration marks black, so a
// Silhouette Studio user can cut by line colour and skip the marks.
import { markOutlines } from '../render/marks.js';
import { layoutInMm } from './pieces.js';

const f4 = (v) => v.toFixed(4);
const d = (pts) => `M${pts.map(([x, y]) => `${f4(x)} ${f4(y)}`).join(' L')} Z`;

export function cutPathSvg(layout, outline, { includeMarks = false } = {}) {
  const { widthMm, heightMm, cuts, marks } = layoutInMm(layout, outline, includeMarks, markOutlines);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f4(widthMm)}mm" height="${f4(heightMm)}mm" viewBox="0 0 ${f4(widthMm)} ${f4(heightMm)}">`,
    '<g id="cut">',
    ...cuts.map((p) => `<path d="${d(p)}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`),
    '</g>',
  ];
  if (includeMarks) {
    out.push('<g id="registration">', ...marks.map((p) => `<path d="${d(p)}" fill="#000" stroke="none"/>`), '</g>');
  }
  out.push('</svg>', '');
  return out.join('\n');
}
