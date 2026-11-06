// Sheet layout. T7: the 360craft presets only; T11 adds page options to this function.
import { pieceAffine } from '../model/360craft.js';

const PRESETS = { 'original-low': 1, 'original-high': 2 }; // × the original-low sheet

/**
 * SheetLayout { widthPx, heightPx, dpi, pxPerR, pieces: [{ band, affine }], marks, warnings,
 * diameterMm } for a preset. `outline` (the PieceOutline) is not needed by the presets: the
 * 360craft placement is fixed.
 */
export function layoutSheet(model, outline, { preset, dpi = 300 } = {}) {
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
    diameterMm: ((2 * sheetPxPerR) / dpi) * 25.4,
  };
}
