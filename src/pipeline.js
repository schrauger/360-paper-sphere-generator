// The render pipeline: panorama + RenderOptions → sheet image, layout, warnings and cut file.
import { MODEL_360CRAFT } from './model/360craft.js';
import { makeModelGeometry } from './model/geometry.js';
import { seamPoint } from './sphere/band.js';
import { layoutSheet } from './layout/sheet.js';
import { composeSheet } from './render/compose.js';
import { MAX_BLEED_R, totalRotation } from './render/warp.js';
import { cutPathSvg } from './export/svg.js';
import { cutPathDxf } from './export/dxf.js';
import { layoutInMm } from './export/pieces.js';
import { markOutlines } from './render/marks.js';
import { tieWarnings } from './export/ties.js';

const MM_PER_IN = 25.4;

/**
 * sec²d at the body's band edge: the stretch the flat map applies across the cut edge (R25/R27),
 * from the seam's strip distance d at the equator (the body). For MODEL_360CRAFT it is ≈ 1.0696.
 */
export function edgeStretch(model = MODEL_360CRAFT) {
  const { spiral, unrolling } = makeModelGeometry(model);
  const { d } = unrolling.sphereToStrip(seamPoint(spiral, Math.PI / 2, 1));
  return 1 / Math.cos(d) ** 2;
}

/** The layoutSheet arguments for `options` (a preset fixes the sheet; otherwise the page and its extras). */
export function layoutOptionsFor(options) {
  const { preset, dpi } = options;
  return preset
    ? { preset, dpi }
    : { page: options.page, dpi, diameterMm: options.diameterMm, marginMm: options.marginMm, marks: options.marks, copies: options.copies };
}

/** { bleedR, warnings }: the sphere bleed (R units) for options.bleedMm on `layout`, clamped to MAX_BLEED_R (R31). */
export function resolveBleed(options, layout, model = MODEL_360CRAFT) {
  const { bleedMm, dpi } = options;
  const warnings = [];
  const stretch = edgeStretch(model);
  let bleedR = bleedMm === 'auto' ? model.style.bleed : ((bleedMm / MM_PER_IN) * dpi) / layout.pxPerR / stretch;
  if (bleedR > MAX_BLEED_R) {
    const maxMm = (MAX_BLEED_R * stretch * layout.pxPerR * MM_PER_IN) / dpi;
    warnings.push(`Bleed limited to ${maxMm.toFixed(2)} mm`);
    bleedR = MAX_BLEED_R;
  }
  return { bleedR, warnings };
}

/**
 * { image: RGBAImage, layout, warnings, diameterMm, copies, cutFile: null | { type, content } } for the
 * panorama `pano` (RGBAImage, exactly 2:1) and `options` (normalizeOptions output). Library
 * RangeErrors from the layout (page too small, sheet too large, …) propagate.
 */
export function renderSheet(pano, options) {
  if (pano.width !== 2 * pano.height) throw new Error(`Panorama must be 2:1 (got ${pano.width}×${pano.height})`);
  const model = MODEL_360CRAFT;
  const geometry = makeModelGeometry(model);
  const { outline } = geometry;
  const layout = layoutSheet(model, outline, layoutOptionsFor(options));
  const bleed = resolveBleed(options, layout, model);
  const { bleedR } = bleed;
  const warnings = [...layout.warnings, ...bleed.warnings];

  const image = composeSheet(pano, layout, geometry, model, {
    outline: options.outline,
    bleedR,
    rotation: totalRotation(model, options.orientation),
  });
  const includeMarks = layout.marks.length > 0;
  if (options.cutFile && options.tieMm && layout.pieces.length) {
    warnings.push(...tieWarnings(layoutInMm(layout, outline, false, markOutlines).cuts[0], options.tieMm));
  }
  let cutFile = null;
  if (options.cutFile === 'svg') cutFile = { type: 'svg', content: cutPathSvg(layout, outline, { includeMarks, tieMm: options.tieMm }) };
  else if (options.cutFile === 'dxf') cutFile = { type: 'dxf', content: cutPathDxf(layout, outline, { includeMarks, tieMm: options.tieMm }) };
  return { image, layout, warnings, diameterMm: layout.diameterMm, copies: layout.copies, cutFile };
}
