// The render pipeline: panorama + RenderOptions → sheet image, layout, warnings and cut file.
import { MODEL_360CRAFT } from './model/360craft.js';
import { makeModelGeometry } from './model/geometry.js';
import { layoutSheet } from './layout/sheet.js';
import { composeSheet } from './render/compose.js';
import { MAX_BLEED_R, totalRotation } from './render/warp.js';
import { cutPathSvg } from './export/svg.js';
import { cutPathDxf } from './export/dxf.js';

const MM_PER_IN = 25.4;
// sec²d at the body edge (≈ 1.0690, as measure-style used for style.bleed, ruling R27): the flat
// map stretches distances across the edge by this factor over the sphere distance bleedR (R25).
const EDGE_STRETCH = 1.069;

/**
 * { image: RGBAImage, layout, warnings, diameterMm, cutFile: null | { type, content } } for the
 * panorama `pano` (RGBAImage, exactly 2:1) and `options` (normalizeOptions output). Library
 * RangeErrors from the layout (page too small, sheet too large, …) propagate.
 */
export function renderSheet(pano, options) {
  if (pano.width !== 2 * pano.height) throw new Error(`Panorama must be 2:1 (got ${pano.width}×${pano.height})`);
  const model = MODEL_360CRAFT;
  const geometry = makeModelGeometry(model);
  const { outline } = geometry;
  const { preset, dpi, bleedMm } = options;
  const layout = preset
    ? layoutSheet(model, outline, { preset, dpi })
    : layoutSheet(model, outline, { page: options.page, dpi, diameterMm: options.diameterMm, marginMm: options.marginMm, marks: options.marks });
  const warnings = [...layout.warnings];

  let bleedR = bleedMm === 'auto' ? model.style.bleed : ((bleedMm / MM_PER_IN) * dpi) / layout.pxPerR / EDGE_STRETCH;
  if (bleedR > MAX_BLEED_R) {
    const maxMm = (MAX_BLEED_R * EDGE_STRETCH * layout.pxPerR * MM_PER_IN) / dpi;
    warnings.push(`Bleed limited to ${maxMm.toFixed(2)} mm`);
    bleedR = MAX_BLEED_R;
  }

  const image = composeSheet(pano, layout, geometry, model, {
    outline: options.outline,
    bleedR,
    rotation: totalRotation(model, options.orientation),
  });
  const includeMarks = layout.marks.length > 0;
  let cutFile = null;
  if (options.cutFile === 'svg') cutFile = { type: 'svg', content: cutPathSvg(layout, outline, { includeMarks }) };
  else if (options.cutFile === 'dxf') cutFile = { type: 'dxf', content: cutPathDxf(layout, outline, { includeMarks }) };
  return { image, layout, warnings, diameterMm: layout.diameterMm, cutFile };
}
