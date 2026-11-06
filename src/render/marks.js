// Silhouette registration marks, drawn black.
import { fillPolygons } from './raster.js';

const BLACK = [0, 0, 0];
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Draw layout.marks (SheetLayout `marks`: squares and L-corners, px) onto `img`. */
export function drawMarks(img, marks) {
  for (const m of marks) {
    if (m.type === 'square') fillPolygons(img, [rect(m.x, m.y, m.x + m.size, m.y + m.size)], BLACK);
    else if (m.type === 'corner') {
      // x, y = the outer corner; the legs run from it along the sheet edges' directions into the page
      const right = m.corner === 'top-right';
      const [x0, x1] = right ? [m.x - m.leg, m.x] : [m.x, m.x + m.leg];
      const [y0, y1] = right ? [m.y, m.y + m.leg] : [m.y - m.leg, m.y];
      const [vx0, vx1] = right ? [m.x - m.stroke, m.x] : [m.x, m.x + m.stroke];
      const [hy0, hy1] = right ? [m.y, m.y + m.stroke] : [m.y - m.stroke, m.y];
      fillPolygons(img, [rect(x0, hy0, x1, hy1), rect(vx0, y0, vx1, y1)], BLACK);
    }
  }
}

/**
 * Closed outlines (px) of layout.marks, matching what drawMarks fills: a square is its
 * 4-vertex rectangle, an L-corner its 6-vertex L (leg × stroke).
 */
export function markOutlines(marks) {
  return marks.map((m) => {
    if (m.type === 'square') return rect(m.x, m.y, m.x + m.size, m.y + m.size);
    const sx = m.corner === 'top-right' ? -1 : 1;
    const sy = m.corner === 'top-right' ? 1 : -1;
    const at = (u, v) => [m.x + sx * u, m.y + sy * v];
    return [at(0, 0), at(m.leg, 0), at(m.leg, m.stroke), at(m.stroke, m.stroke), at(m.stroke, m.leg), at(0, m.leg)];
  });
}
