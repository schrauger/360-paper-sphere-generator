// The warp: each sheet pixel → flat piece point → strip coordinates → sphere direction →
// panorama colour.
//
// Alpha (rulings R14, R25): clamp(0.5 + pxPerR·k·(edgeDistance(p) + bleedR), 0, 1), p the
// pixel's band-0-frame sphere point and k = sec²d of its strip record (1 in tip cells), the
// flat/sphere stretch across the edge, so the anti-aliasing ramp is ≈ 1 sheet px wide and
// centred on the cut edge. bleedR is a SPHERE distance (R units, like edgeDistance): the
// printed bleed is ≈ 7% wider than bleedR·pxPerR at the body edge (sec²d ≈ 1.07 there).
// The unrolling tears ≈ 0.034 R outside the edge near the tips, so bleedR is clamped to
// MAX_BLEED_R (with a warning).
import { directionToEquirect, mul, rotationFromYPR, rotZ } from '../sphere/orient.js';
import { blend, transformPts } from './raster.js';
import { buildGuide } from './guide.js';
import { sampleEquirect } from './sample.js';

/** Widest bleed (sphere R units) the unrolling supports without tearing near the tips. */
export const MAX_BLEED_R = 0.03;

/** Panorama rotation for the user's yaw/pitch/roll (degrees) on top of the model's base orientation. */
export function totalRotation(model, ypr) {
  return mul(rotationFromYPR(ypr), rotationFromYPR(model.baseOrientation));
}

/**
 * { guide, bleedR, warnings, map(x, y, out) → alpha, mapPiece(k, x, y, out) → alpha } for a
 * SheetLayout. map takes sheet coordinates (a pixel centre is (i + 0.5, j + 0.5)); when
 * alpha > 0 it writes into `out` the unit vector of the pixel's point on its piece's band: the
 * band-0-frame point with rotZ(band·π) applied. Calls along a row, left to right, extrapolate
 * the previous pixels' s as flatToStrip's guess; elsewhere the guide's cell guess seeds it.
 * mapPiece is the same for piece k alone, without the guide (pixels outside its cells too).
 * bleedR above MAX_BLEED_R is clamped, with a message in `warnings`.
 */
export function makePixelMapper(layout, geometry, { bleedR = 0 } = {}) {
  if (!Number.isFinite(bleedR) || bleedR < 0) throw new RangeError(`bleedR must be a finite number ≥ 0 (got ${bleedR})`);
  const warnings = [];
  if (bleedR > MAX_BLEED_R) {
    warnings.push(`Bleed ${bleedR} R is wider than the supported ${MAX_BLEED_R} R; using ${MAX_BLEED_R} R`);
    bleedR = MAX_BLEED_R;
  }
  const { unrolling } = geometry;
  const { length } = unrolling;
  const { pxPerR } = layout;
  const guide = buildGuide(layout, geometry, { bleedR });
  const pieces = layout.pieces.map(({ band, affine: [a, b, c, d, e, f] }) => {
    const det = a * d - b * c;
    const edge = transformPts(geometry.outline.edge, [a, b, c, d, e, f]);
    const reach = bleedR * pxPerR * 1.25 + 2; // bleed (stretched) plus the anti-aliasing ramp
    return {
      box: edge.reduce((m, [x, y]) => [Math.min(m[0], x), Math.min(m[1], y), Math.max(m[2], x), Math.max(m[3], y)], [Infinity, Infinity, -Infinity, -Infinity])
        .map((v, i) => (i < 2 ? v - reach : v + reach)),
      inv: [d / det, -b / det, -c / det, a / det, e, f], // (x − e, y − f) ↦ (X, Y)
      rot: rotZ(band * Math.PI),
      lastX: NaN,
      lastY: NaN,
      lastS: NaN,
      prevS: NaN,
      run: 0,
    };
  });

  function mapPiece(k, x, y, out, cellGuess, interior) {
    const P = pieces[k];
    const [ia, ib, ic, id, e, f] = P.inv;
    const X = ia * (x - e) + ic * (y - f);
    const Y = ib * (x - e) + id * (y - f);
    // Along a row s changes smoothly: the previous two pixels' s extrapolate to a guess that
    // Newton refines in a step or two.
    const follows = y === P.lastY && x === P.lastX + 1;
    const guess = follows ? 2 * P.lastS - (P.run > 1 ? P.prevS : P.lastS) : cellGuess;
    const rec = unrolling.flatToStrip(X, Y, guess);
    P.run = follows ? P.run + 1 : 1;
    P.lastX = x;
    P.lastY = y;
    P.prevS = P.lastS;
    P.lastS = rec.s;
    if (!rec.ok || !(rec.s >= 0 && rec.s <= length)) return 0;
    const p = unrolling.stripToSphere(rec);
    const k2 = rec.cell === 'strip' ? 1 / Math.cos(rec.d) ** 2 : 1;
    // Interior cells are ≥ 3 px inside the edge: alpha is 1 without measuring the distance.
    const alpha = interior ? 1 : Math.min(1, Math.max(0, 0.5 + pxPerR * k2 * (unrolling.edgeDistance(p) + bleedR)));
    if (alpha > 0) {
      const m = P.rot;
      out[0] = m[0] * p[0] + m[1] * p[1] + m[2] * p[2];
      out[1] = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
      out[2] = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
    }
    return alpha;
  }

  const tmp = new Float64Array(3);
  function map(x, y, out) {
    const cell = guide.cellIndex(x, y);
    if (cell < 0) return 0;
    const k = guide.piece[cell];
    if (k === -1) return 0;
    if (k >= 0) return mapPiece(k, x, y, out, guide.sGuess[cell], guide.interior[cell] === 1);
    // Two pieces reach this cell: the one that covers the pixel most.
    let best = 0;
    for (let i = 0; i < pieces.length; i++) {
      const [bx0, by0, bx1, by1] = pieces[i].box;
      if (x < bx0 || x > bx1 || y < by0 || y > by1) continue; // many copies: skip pieces that cannot reach here
      const alpha = mapPiece(i, x, y, tmp, NaN, false);
      if (alpha > best) {
        best = alpha;
        out[0] = tmp[0];
        out[1] = tmp[1];
        out[2] = tmp[2];
      }
    }
    return best;
  }

  return { guide, bleedR, warnings, map, mapPiece: (k, x, y, out) => mapPiece(k, x, y, out, NaN, false) };
}

/**
 * Source-over draw of the panorama onto the RGBAImage `target` (sized to the layout) through
 * the warp, for sheet rows [rows[0], rows[1]). `rotation` maps band-frame points to panorama
 * directions (see totalRotation). Returns { warnings }.
 */
export function renderPieces(target, layout, geometry, pano, rotation, { bleedR = 0, rows = [0, target.height] } = {}) {
  const mapper = makePixelMapper(layout, geometry, { bleedR });
  const { guide } = mapper;
  const { width, data } = target;
  const W = pano.width;
  const H = pano.height;
  const dir = new Float64Array(3);
  const q = new Float64Array(3);
  const rgb = new Float64Array(3);
  const y0 = Math.max(0, rows[0]);
  const y1 = Math.min(target.height, rows[1]);
  for (let j = y0; j < y1; j++) {
    for (let i = 0; i < width; i++) {
      const cell = guide.cellIndex(i + 0.5, j + 0.5);
      if (cell < 0 || guide.piece[cell] === -1) {
        i = (Math.floor(i / guide.cellPx) + 1) * guide.cellPx - 1; // skip the rest of the cell
        continue;
      }
      const alpha = mapper.map(i + 0.5, j + 0.5, dir);
      if (alpha <= 0) continue;
      const m = rotation;
      q[0] = m[0] * dir[0] + m[1] * dir[1] + m[2] * dir[2];
      q[1] = m[3] * dir[0] + m[4] * dir[1] + m[5] * dir[2];
      q[2] = m[6] * dir[0] + m[7] * dir[1] + m[8] * dir[2];
      const [u, v] = directionToEquirect(q, W, H);
      sampleEquirect(pano, u, v, rgb, 0);
      blend(data, (j * width + i) * 4, rgb, alpha);
    }
  }
  return { warnings: mapper.warnings };
}
