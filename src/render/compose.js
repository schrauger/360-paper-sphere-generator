// The print sheet: background → glue tabs → warped pieces (with bleed over the tabs) → cut outline
// → registration marks.
import { createImage, fillPolygons, strokePolyline, transformPts } from './raster.js';
import { renderPieces } from './warp.js';
import { drawMarks } from './marks.js';

/**
 * RGBAImage of the sheet in `layout`. pano: the panorama (RGBAImage); geometry: makeModelGeometry(model);
 * rotation: the panorama rotation (totalRotation); bleedR: sphere distance in R units (0 = no bleed);
 * outline: draw the cut outline. model.style gives the colours and the outline width.
 */
export function composeSheet(pano, layout, geometry, model, { outline = true, bleedR = 0, rotation }) {
  if (!rotation) throw new TypeError('composeSheet needs the panorama rotation (see totalRotation)');
  const { style } = model;
  const { outline: pieceOutline } = geometry;
  const img = createImage(layout.widthPx, layout.heightPx, [...style.background, 255]);
  for (const { affine } of layout.pieces) {
    fillPolygons(img, pieceOutline.tabs.map((tab) => transformPts(tab, affine)), style.tabColor);
  }
  renderPieces(img, layout, geometry, pano, rotation, { bleedR });
  if (outline) {
    const width = style.outlineWidth * layout.pxPerR;
    for (const { affine } of layout.pieces) {
      strokePolyline(img, transformPts(pieceOutline.cutPath, affine), width, style.outlineColor, { closed: true });
    }
  }
  drawMarks(img, layout.marks);
  return img;
}
