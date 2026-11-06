// Coarse lookup grid over the sheet: which piece (if any) a pixel can belong to, and a guess
// of its strip coordinate s. The renderer skips empty cells and seeds flatToStrip with the
// guess at the start of each run of pixels.
//
// Built from the flat geometry (ruling R26): a cell is marked for a piece when its centre is
// inside the piece's band edge (scanline at cell centres) or its box comes within `margin` px
// of the edge, then the marks are dilated by one cell. margin covers the bleed (a sphere
// distance, stretched by at most FLAT_STRETCH in the flat near the edge) plus the anti-aliasing
// ramp, so every pixel the warp gives alpha > 0 lies in a non-empty cell (tested).
import { transformPts } from './raster.js';

const FLAT_STRETCH = 1.25; // ≥ flat/sphere distance ratio across the edge (sec²d ≈ 1.07 at the body)
const AA_PX = 1; // the alpha ramp reaches 0.5 px (sheet) outside the edge; 1 px of slack
const D_MAX = 0.3; // |d| of the band edge plus bleed (develop.js); s guesses are sampled within it
const MAX_PIECES = 120; // piece indices live in Int8Array cells
const NONE = -1;
const MANY = -2;
// Fold piece k into a cell's record: NONE → k, k → k, another piece → MANY.
const addTo = (arr, i, k) => {
  const v = arr[i];
  arr[i] = v === NONE || v === k ? k : MANY; // (a MANY cell stays MANY)
};
const INTERIOR_PX = 3; // an interior cell is at least this far inside the edge (flat sheet px)

/**
 * Guide { cellPx, cols, rows, piece: Int8Array, interior: Uint8Array, sGuess: Float64Array,
 * cellIndex(x, y) } for a SheetLayout. piece[i] is the index into layout.pieces, −1 for an empty
 * cell and −2 for a cell two pieces reach; interior[i] = 1 if every point of the cell is at least
 * INTERIOR_PX inside its piece's edge (alpha is 1 there whatever the bleed); sGuess[i] is the s of
 * a strip sample of that piece inside the cell (NaN if none, e.g. in tip cells).
 */
export function buildGuide(layout, geometry, { bleedR = 0, cellPx = 8 } = {}) {
  if (layout.pieces.length > MAX_PIECES) throw new RangeError(`Guide supports at most ${MAX_PIECES} pieces (got ${layout.pieces.length})`);
  const { unrolling, outline } = geometry;
  const cols = Math.ceil(layout.widthPx / cellPx);
  const rows = Math.ceil(layout.heightPx / cellPx);
  const mask = new Int8Array(cols * rows).fill(NONE); // the piece reaching the cell, NONE or MANY
  const inside = new Int8Array(cols * rows).fill(NONE); // the piece whose edge contains the cell's centre
  const near = new Int8Array(cols * rows).fill(NONE); // the piece whose edge comes within INTERIOR_PX of the cell
  const margin = bleedR * layout.pxPerR * FLAT_STRETCH + AA_PX;
  const nearMargin = Math.max(margin, INTERIOR_PX);

  layout.pieces.forEach((piece, k) => {
    const poly = transformPts(outline.edge, piece.affine);
    const n = poly.length;
    // Cells whose box comes within `margin` (and `nearMargin`) of an edge segment
    // (bounding-box test, a superset).
    const markNear = (target, x0, y0, x1, y1, r) => {
      const a0 = Math.max(0, Math.floor((Math.min(x0, x1) - r) / cellPx));
      const a1 = Math.min(cols - 1, Math.floor((Math.max(x0, x1) + r) / cellPx));
      const b0 = Math.max(0, Math.floor((Math.min(y0, y1) - r) / cellPx));
      const b1 = Math.min(rows - 1, Math.floor((Math.max(y0, y1) + r) / cellPx));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) addTo(target, b * cols + a, k);
    };
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % n];
      markNear(mask, x0, y0, x1, y1, margin);
      markNear(near, x0, y0, x1, y1, nearMargin);
    }
    // Cells whose centre is inside the edge: even-odd scanline through the cell centres.
    const crossings = Array.from({ length: rows }, () => []);
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % n];
      if (y0 === y1) continue;
      const lo = Math.max(0, Math.ceil(Math.min(y0, y1) / cellPx - 0.5));
      const hi = Math.min(rows - 1, Math.ceil(Math.max(y0, y1) / cellPx - 0.5) - 1);
      for (let b = lo; b <= hi; b++) {
        const yc = (b + 0.5) * cellPx; // min(y0, y1) ≤ yc < max(y0, y1)
        crossings[b].push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    for (let b = 0; b < rows; b++) {
      const xs = crossings[b].sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a0 = Math.max(0, Math.ceil(xs[i] / cellPx - 0.5));
        const a1 = Math.min(cols - 1, Math.floor(xs[i + 1] / cellPx - 0.5));
        for (let a = a0; a <= a1; a++) {
          addTo(mask, b * cols + a, k);
          addTo(inside, b * cols + a, k);
        }
      }
    }
  });

  // Dilate by one cell (8-neighbourhood).
  const dilated = new Int8Array(mask.length).fill(NONE);
  for (let b = 0; b < rows; b++) {
    for (let a = 0; a < cols; a++) {
      const m = mask[b * cols + a];
      if (m === NONE) continue;
      for (let bb = Math.max(0, b - 1); bb <= Math.min(rows - 1, b + 1); bb++) {
        for (let aa = Math.max(0, a - 1); aa <= Math.min(cols - 1, a + 1); aa++) {
          if (m === MANY) dilated[bb * cols + aa] = MANY;
          else addTo(dilated, bb * cols + aa, m);
        }
      }
    }
  }
  const piece = new Int8Array(mask.length);
  const interior = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    piece[i] = dilated[i];
    // Centre inside and no edge within INTERIOR_PX of the cell: the whole cell is inside.
    if (piece[i] >= 0 && inside[i] === piece[i] && near[i] === NONE) interior[i] = 1;
  }

  // s guesses: strip samples (s, d) about cellPx/2 apart in the flat.
  const sGuess = new Float64Array(mask.length).fill(NaN);
  const step = cellPx / 2 / layout.pxPerR;
  const dStep = step * Math.cos(D_MAX) ** 2;
  for (let s = 0; s <= unrolling.length; ) {
    for (let d = -D_MAX; d <= D_MAX; d += dStep) {
      const [X, Y] = unrolling.toFlat(s, d);
      layout.pieces.forEach(({ affine: [a, b, c, dd, e, f] }, k) => {
        const ca = Math.floor((a * X + c * Y + e) / cellPx);
        const cb = Math.floor((b * X + dd * Y + f) / cellPx);
        if (ca < 0 || cb < 0 || ca >= cols || cb >= rows) return;
        if (piece[cb * cols + ca] === k) sGuess[cb * cols + ca] = s;
      });
    }
    // Along the strip the flat moves |1 − κ·tan d| per unit s.
    s += step / (1 + Math.abs(unrolling.flatFrame(s).kappa) * Math.tan(D_MAX));
  }

  const cellIndex = (x, y) => {
    const a = Math.floor(x / cellPx);
    const b = Math.floor(y / cellPx);
    return a >= 0 && b >= 0 && a < cols && b < rows ? b * cols + a : -1;
  };
  return { cellPx, cols, rows, piece, interior, sGuess, cellIndex };
}
