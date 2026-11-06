// Silhouette registration marks, drawn black.
import { fillPolygons } from './raster.js';

const BLACK = [0, 0, 0];
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Draw layout.marks (SheetLayout `marks`: squares and L-corners, px) onto `img`, from markOutlines. */
export function drawMarks(img, marks) {
  fillPolygons(img, markOutlines(marks), BLACK);
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
