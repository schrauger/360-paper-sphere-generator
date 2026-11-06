import { transformPts } from '../render/raster.js';

const MM_PER_IN = 25.4;

/** Sheet size and the cut paths and mark outlines of a layout, in mm, y down, origin top-left. */
export function layoutInMm(layout, outline, includeMarks, markOutlines) {
  const k = MM_PER_IN / layout.dpi;
  const scale = (pts) => pts.map(([x, y]) => [x * k, y * k]);
  // A cut path may repeat its first vertex to close; the writers close it themselves.
  const open = (pts) => {
    const [f, l] = [pts[0], pts[pts.length - 1]];
    return pts.length > 1 && f[0] === l[0] && f[1] === l[1] ? pts.slice(0, -1) : pts;
  };
  return {
    widthMm: layout.widthPx * k,
    heightMm: layout.heightPx * k,
    cuts: layout.pieces.map((p) => scale(open(transformPts(outline.cutPath, p.affine)))),
    marks: includeMarks ? markOutlines(layout.marks).map(scale) : [],
  };
}
