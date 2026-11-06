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
  // Glue tabs. measure-tabs.mjs on outline.dxf at the fitted model (100 tabs, 50 per seam).
  // Base positions fit a uniform pitch along the seam's arc length ON THE SPHERE (σ rms 0.67
  // px; along the flat seam it is 1.46 px, max 5.1 px). pitch, length, startPos and startNeg
  // are in R; a tab sits at σ = start + k·pitch (σ from the north tip) and is kept while
  // σ + length ≤ the seam length. Each tab is a pentagon, not the plan's quadrilateral: its
  // base A→B along the seam (outline order: pos seam forward, neg seam backward) and three
  // outer vertices [anchor, dx, h]: lerp(A, B, anchor) + (dx·t + h·n)·|AB|, t the unit chord
  // direction and n the outward flat normal. The shape scales with the chord, which shrinks to
  // 0.84 of its body length in the two tip curls (vertex error rms 0.73 px, max 2.24 px; a shape
  // constant in R has max 7 px there). Pos and neg tabs differ in shape, and their starts are
  // half a pitch apart, so tabs on mating seams never overlap.
  tabs: {
    along: 'sphere',
    pitch: 0.50446,
    length: 0.23737,
    startPos: 0.26396,
    startNeg: 0.01369,
    outer: {
      pos: [[0, -0.1508, 0.302], [1, -0.0999, 0.3018], [1, 0.1503, 0.1517]],
      neg: [[0, -0.0009, 0.3049], [1, 0.0001, 0.3047], [1, 0.1502, 0.1545]],
    },
  },
  // style: added by T10
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
