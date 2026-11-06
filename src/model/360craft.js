// The 360craft warp model: spiral, base orientation and the layout of the two pieces on the
// original-low sheet. See docs/adr/0003-warp-model.md for the formula and how each value was
// measured. Every fitted value below comes from
// tools/research/fit-model.mjs, alaska+2018 matches + outline.dxf (accepted under ruling R16:
// correspondence median 0.31 px, DXF seam mean 0.55 px / p95 1.39 px).

export const MODEL_360CRAFT = {
  // fit-model.mjs, alaska+2018 matches + outline.dxf (Clelia only, ruling R9)
  spiral: { family: 'clelia', rate: 6.00528 },
  // fit-model.mjs, alaska+2018 matches + outline.dxf; degrees, M = Rz(yaw)·Ry(pitch)·Rx(roll)
  baseOrientation: { yaw: 89.529, pitch: -0.006, roll: 0.017 },
  layoutLow: {
    widthPx: 2850, // the original-low preset
    heightPx: 4160,
    pxPerR: 492.429, // fit-model.mjs, alaska+2018 matches + outline.dxf
    // fit-model.mjs, alaska+2018 matches + outline.dxf: flat origin (north tip) in sheet px,
    // y down, and the rotation of the flat frame. pieces[0] is the left piece (DXF MyLines1).
    pieces: [
      { band: 1, x: 882.9, y: 563.92, angleDeg: 118.104 },
      { band: 0, x: 2132.96, y: 563.85, angleDeg: 118.109 },
    ],
  },
  // tabs: added by T7; style: added by T10
};

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
