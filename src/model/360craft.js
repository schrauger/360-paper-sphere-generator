// The 360craft warp model: how the two flat pieces sit on the sheet.
//
// MODEL_360CRAFT (spiral, baseOrientation, layoutLow) is added once tools/research/fit-model.mjs
// meets its acceptance criteria (plan T6); until then only the layout transform lives here.

/**
 * Canvas-style affine [a, b, c, d, e, f] (x' = a·X + c·Y + e, y' = b·X + d·Y + f) taking flat
 * piece coordinates (X, Y) in R units (y up, origin at the north tip) to sheet px (y down).
 * Y is reflected before the rotation by angleDeg, so the flat frame keeps its handedness as
 * seen on the y-down sheet and the printed side is not mirrored. `scale` is sheet px per
 * original-low px (2 for original-high).
 */
export function pieceAffine(piece, pxPerR, scale = 1) {
  const k = pxPerR * scale;
  const a = (piece.angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [k * c, k * s, k * s, -k * c, piece.x * scale, piece.y * scale];
}
