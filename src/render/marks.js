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
