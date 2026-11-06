// Sheet layout: the two 360craft presets, or any page size with an optional sphere diameter and
// Silhouette registration marks.
import { pieceAffine } from '../model/360craft.js';
import { MAX_COPIES, gridCandidates, gridPositions, packCopies, pairArea } from './pack.js';

const PRESETS = { 'original-low': 1, 'original-high': 2 }; // × the original-low sheet
const MM_PER_IN = 25.4;
const MAX_SHEET_PX = 2.5e8;
const CLEARANCE_MM = 3; // pieces keep this far from every registration mark
// Silhouette Studio's Type 1 registration marks at a 10 mm inset, measured from a Studio print
// (±0.05 mm). All in mm: the square sits top-left, the L-corners top-right and bottom-left.
const MARK_INSET_MM = 9.75; // each mark's outer edge from its two nearest page edges
const SQUARE_MM = 5.55;
const LEG_MM = 13.65;
const STROKE_MM = 0.54;
const MARK_MARGIN_MM = 10; // with marks the content rectangle is the page inset by this

const round1 = (v) => Number(v.toFixed(1));

// Grid candidates depend only on the pair's shape and size; the web re-lays out on every change.
const candidateCache = new WeakMap();
function candidatesFor(outline, pieceMm, diameterMm) {
  let byDiameter = candidateCache.get(outline);
  if (!byDiameter) candidateCache.set(outline, (byDiameter = new Map()));
  if (!byDiameter.has(diameterMm)) {
    if (byDiameter.size > 8) byDiameter.clear();
    byDiameter.set(diameterMm, gridCandidates(pieceMm));
  }
  return byDiameter.get(diameterMm);
}

/**
 * SheetLayout { widthPx, heightPx, dpi, pxPerR, copies, pieces: [{ band, affine }], marks, warnings,
 * diameterMm }. Either a preset ('original-low' | 'original-high') or a page { widthMm, heightMm }.
 * A preset uses the fixed 360craft placement: `outline`, page, diameterMm, marginMm, marks and the
 * DPI range are then ignored (dpi only sets the mm ↔ px scale). With a page, the two pieces keep
 * their layoutLow placement, scaled to the largest size that fits the page (or to `diameterMm`;
 * the sheet is then enlarged, with a warning, if the sphere does not fit) and centred.
 * marks: 'none' | 'silhouette' (entries in px, x/y = the mark's outer corner). With marks the
 * margin is 10 mm on every side automatically and `marginMm` is ignored.
 * copies: 'max' | N (≤ 60). With a `diameterMm`, as many pairs as fit in a grid (or exactly N; the sheet is enlarged,
 * with a warning, if N do not fit) are packed on a grid; without one the layout is the single
 * largest pair. `copies` in the result is the number of pairs; `pieces` holds each pair's two
 * pieces in turn.
 */
export function layoutSheet(model, outline, { preset, page, dpi = 300, diameterMm = null, marginMm = 6.35, marks = 'none', copies = 'max' } = {}) {
  if (preset !== undefined || !page) return presetLayout(model, preset, dpi);
  if (!(dpi >= 72 && dpi <= 1200)) throw new RangeError('DPI must be between 72 and 1200');
  if (!(marginMm >= 0) || !Number.isFinite(marginMm)) throw new RangeError('Margin must be a finite number of mm ≥ 0');
  if (copies !== 'max' && !(Number.isInteger(copies) && copies >= 1 && copies <= MAX_COPIES)) throw new RangeError(`Copies must be max or a whole number from 1 to ${MAX_COPIES}`);
  if (marks !== 'none' && marks !== 'silhouette') throw new RangeError(`Unknown marks: ${marks}. Use none or silhouette`);
  const pxPerMm = dpi / MM_PER_IN;
  checkSheetSize(page.widthMm * pxPerMm, page.heightMm * pxPerMm);

  const silhouette = marks === 'silhouette';
  const margin = silhouette ? MARK_MARGIN_MM : marginMm;
  const rectMm = (w, h) => ({ x0: margin, y0: margin, x1: w - margin, y1: h - margin });
  const markBoxesMm = (w, h) => (silhouette
    ? [
        [MARK_INSET_MM, MARK_INSET_MM, MARK_INSET_MM + SQUARE_MM, MARK_INSET_MM + SQUARE_MM],
        [w - MARK_INSET_MM - LEG_MM, MARK_INSET_MM, w - MARK_INSET_MM, MARK_INSET_MM + LEG_MM],
        [MARK_INSET_MM, h - MARK_INSET_MM - LEG_MM, MARK_INSET_MM + LEG_MM, h - MARK_INSET_MM],
      ]
    : []);

  let { widthMm, heightMm } = page;
  let rect = rectMm(widthMm, heightMm);
  if (!(rect.x1 > rect.x0 && rect.y1 > rect.y0)) {
    throw new RangeError(silhouette ? 'Page too small for registration marks' : 'Page too small for the margins');
  }

  // The arrangement at 1 px per R (cut-path points of both pieces); everything is linear in the scale.
  const { pieces: lowPieces, pxPerR: lowPxPerR } = model.layoutLow;
  const affinesAt = (pxPerR) => lowPieces.map((p) => pieceAffine(p, lowPxPerR, pxPerR / lowPxPerR));
  const unit = affinesAt(1).flatMap(([a, b, c, d, e, f]) => outline.cutPath.map(([X, Y]) => [a * X + c * Y + e, b * X + d * Y + f]));
  const bb = unit.reduce((m, [x, y]) => [Math.min(m[0], x), Math.min(m[1], y), Math.max(m[2], x), Math.max(m[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const bw = bb[2] - bb[0];
  const bh = bb[3] - bb[1];

  // The translation that centres the arrangement at `pxPerR` in the rectangle (mm).
  const centred = (pxPerR, r) => [
    ((r.x0 + r.x1) / 2) * pxPerMm - (pxPerR * (bb[0] + bb[2])) / 2,
    ((r.y0 + r.y1) / 2) * pxPerMm - (pxPerR * (bb[1] + bb[3])) / 2,
  ];
  const fits = (pxPerR, r, boxes) => {
    if (pxPerR * bw > (r.x1 - r.x0) * pxPerMm || pxPerR * bh > (r.y1 - r.y0) * pxPerMm) return false;
    const [tx, ty] = centred(pxPerR, r);
    const gap = CLEARANCE_MM * pxPerMm;
    return unit.every(([ux, uy]) => {
      const x = pxPerR * ux + tx;
      const y = pxPerR * uy + ty;
      return boxes.every(([x0, y0, x1, y1]) => {
        const dx = Math.max(x0 * pxPerMm - x, 0, x - x1 * pxPerMm);
        const dy = Math.max(y0 * pxPerMm - y, 0, y - y1 * pxPerMm);
        return Math.hypot(dx, dy) >= gap;
      });
    });
  };

  const warnings = [];
  let pxPerR;
  let packed = null; // { rot90, centres (mm) } when several pairs are placed
  if (diameterMm === null || diameterMm === undefined) {
    const boxes = markBoxesMm(widthMm, heightMm);
    let hi = Math.min(((rect.x1 - rect.x0) * pxPerMm) / bw, ((rect.y1 - rect.y0) * pxPerMm) / bh);
    if (fits(hi, rect, boxes)) pxPerR = hi;
    else {
      let lo = 0;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid, rect, boxes)) lo = mid;
        else hi = mid;
      }
      pxPerR = lo;
    }
    if (!(pxPerR > 0)) throw new RangeError(silhouette ? 'Page too small for registration marks' : 'Page too small for the margins');
  } else {
    if (!(diameterMm > 0) || !Number.isFinite(diameterMm)) throw new RangeError('Sphere diameter must be a positive number of mm');
    pxPerR = ((diameterMm / 2) / MM_PER_IN) * dpi;
    const boxes = markBoxesMm(widthMm, heightMm);
    // The pair's two cut paths in mm (centred by the packer).
    const rMm = diameterMm / 2;
    const pieceMm = affinesAt(1).map(([a, b, c, d, e, f]) => outline.cutPath.map(([X, Y]) => [(a * X + c * Y + e) * rMm, (b * X + d * Y + f) * rMm]));
    const candidates = () => candidatesFor(outline, pieceMm, diameterMm);
    // Two pairs cannot fit when their outlines alone are larger than the rectangle.
    const roomForMore = copies !== 1 && (copies === 'max' ? 2 : copies) * pairArea(pieceMm) <= (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
    if (roomForMore) {
      packed = packCopies(pieceMm, rect, boxes, { copies, candidates: candidates() });
      if (packed && packed.copies === 1) packed = null; // a single pair keeps the classic centring
    }
    if (copies !== 'max' && copies > 1 && (!packed || packed.copies !== copies)) {
      // N pairs do not fit: grow the sheet around a near-square grid of them.
      packed = null;
      // The smallest sheet over both orientations and every column count (squarer on a tie).
      let grid = null;
      for (const c of candidates()) {
        for (let cols = 1; cols <= copies; cols++) {
          const g = gridPositions(c, cols, Math.ceil(copies / cols), copies);
          const [w, h] = [g.box[2] - g.box[0], g.box[3] - g.box[1]];
          if (!grid || w * h < grid.area - 1e-6 || (Math.abs(w * h - grid.area) <= 1e-6 && Math.abs(w - h) < grid.skew)) grid = { ...g, area: w * h, skew: Math.abs(w - h), rot90: c.rot90 };
        }
      }
      const { centres, box } = grid;
      const pad = silhouette ? MARK_INSET_MM + LEG_MM + CLEARANCE_MM : marginMm;
      const newW = box[2] - box[0] + 2 * pad;
      const newH = box[3] - box[1] + 2 * pad;
      warnings.push(`${copies} spheres of ${round1(diameterMm)} mm do not fit on ${round1(widthMm)}×${round1(heightMm)} mm; sheet enlarged to ${round1(newW)}×${round1(newH)} mm`);
      widthMm = newW;
      heightMm = newH;
      rect = rectMm(widthMm, heightMm);
      checkSheetSize(widthMm * pxPerMm, heightMm * pxPerMm);
      packed = { copies, rot90: grid.rot90, centres: centres.map(([x, y]) => [x - box[0] + pad, y - box[1] + pad]) };
    } else if (!packed && !fits(pxPerR, rect, boxes)) {
      // Grow the sheet to the arrangement plus margins; with marks, the arrangement clears the
      // marks' legs and the clearance on every side (the legs reach MARK_INSET + LEG from the edge).
      // (A bounding-box bound: the real arrangement is not rectangular, so this may be generous.)
      const pad = silhouette ? MARK_INSET_MM + LEG_MM + CLEARANCE_MM : marginMm;
      const newW = (pxPerR * bw) / pxPerMm + 2 * pad;
      const newH = (pxPerR * bh) / pxPerMm + 2 * pad;
      warnings.push(`Sphere of ${round1(diameterMm)} mm does not fit on ${round1(widthMm)}×${round1(heightMm)} mm; sheet enlarged to ${round1(newW)}×${round1(newH)} mm`);
      widthMm = newW;
      heightMm = newH;
      rect = rectMm(widthMm, heightMm);
      checkSheetSize(widthMm * pxPerMm, heightMm * pxPerMm);
    }
    if (diameterMm < 30) warnings.push(`Sphere diameter ${round1(diameterMm)} mm is very small to assemble`);
  }

  const [tx, ty] = centred(pxPerR, rect);
  const toPx = (mm) => (mm / MM_PER_IN) * dpi;
  const markEntries = [];
  if (silhouette) {
    markEntries.push(
      { type: 'square', x: toPx(MARK_INSET_MM), y: toPx(MARK_INSET_MM), size: toPx(SQUARE_MM) },
      { type: 'corner', corner: 'top-right', x: toPx(widthMm - MARK_INSET_MM), y: toPx(MARK_INSET_MM), leg: toPx(LEG_MM), stroke: toPx(STROKE_MM) },
      { type: 'corner', corner: 'bottom-left', x: toPx(MARK_INSET_MM), y: toPx(heightMm - MARK_INSET_MM), leg: toPx(LEG_MM), stroke: toPx(STROKE_MM) },
    );
  }
  // Each copy: the pair centred on its bounding box, optionally turned 90°, moved to its centre.
  function packedPieces() {
    const cx = (pxPerR * (bb[0] + bb[2])) / 2;
    const cy = (pxPerR * (bb[1] + bb[3])) / 2;
    const base = affinesAt(pxPerR);
    return packed.centres.flatMap(([mx, my]) => lowPieces.map((piece, i) => {
      const [a, b, c, d, e, f] = base[i];
      const [le, lf] = [e - cx, f - cy];
      const m = packed.rot90 ? [-b, a, -d, c, -lf, le] : [a, b, c, d, le, lf]; // (x, y) ↦ (−y, x) when turned
      return { band: piece.band, affine: [m[0], m[1], m[2], m[3], m[4] + mx * pxPerMm, m[5] + my * pxPerMm] };
    }));
  }
  return {
    widthPx: Math.round(toPx(widthMm)),
    heightPx: Math.round(toPx(heightMm)),
    dpi,
    pxPerR,
    copies: packed ? packed.centres.length : 1,
    pieces: packed ? packedPieces() : lowPieces.map((piece, i) => {
      const [a, b, c, d, e, f] = affinesAt(pxPerR)[i];
      return { band: piece.band, affine: [a, b, c, d, e + tx, f + ty] };
    }),
    marks: markEntries,
    warnings,
    diameterMm: ((2 * pxPerR) / dpi) * MM_PER_IN,
  };
}

function checkSheetSize(widthPx, heightPx) {
  if (widthPx * heightPx > MAX_SHEET_PX) {
    throw new RangeError(`Sheet too large (${Math.round((widthPx * heightPx) / 1e6)} megapixels); lower the DPI`);
  }
}

function presetLayout(model, preset, dpi) {
  const scale = PRESETS[preset];
  if (scale === undefined) throw new Error(`Unknown sheet preset: ${preset}. Use ${Object.keys(PRESETS).join(' or ')}`);
  const { widthPx, heightPx, pxPerR, pieces } = model.layoutLow;
  const sheetPxPerR = pxPerR * scale;
  return {
    widthPx: widthPx * scale,
    heightPx: heightPx * scale,
    dpi,
    pxPerR: sheetPxPerR,
    pieces: pieces.map((piece) => ({ band: piece.band, affine: pieceAffine(piece, pxPerR, scale) })),
    marks: [],
    warnings: [],
    diameterMm: ((2 * sheetPxPerR) / dpi) * MM_PER_IN,
  };
}
