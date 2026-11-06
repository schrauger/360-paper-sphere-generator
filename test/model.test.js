import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT, pieceAffine } from '../src/model/360craft.js';
import { makeSpiral } from '../src/sphere/spiral.js';
import { makeCentreLine } from '../src/sphere/band.js';
import { makeUnrolling } from '../src/sphere/develop.js';

const at = ([a, b, c, d, e, f], [X, Y]) => [a * X + c * Y + e, b * X + d * Y + f];
const close = (p, q, tol = 1e-9) => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol;

test('pieceAffine puts the flat origin (north tip) at (x, y) and scales by pxPerR·scale', () => {
  const piece = { x: 880, y: 560, angleDeg: 117.8 };
  const A = pieceAffine(piece, 492.5);
  assert.ok(close(at(A, [0, 0]), [880, 560]));
  const p = at(A, [1, 0]);
  assert.ok(Math.abs(Math.hypot(p[0] - 880, p[1] - 560) - 492.5) < 1e-9);
  const H = pieceAffine(piece, 492.5, 2);
  assert.ok(close(at(H, [0.3, -0.2]), at(A, [0.3, -0.2]).map((v) => 2 * v)));
});

test('pieceAffine reflects Y: flat (y up) keeps its handedness on the y-down sheet', () => {
  const A = pieceAffine({ x: 0, y: 0, angleDeg: 0 }, 1);
  assert.ok(close(at(A, [1, 0]), [1, 0]));
  assert.ok(close(at(A, [0, 1]), [0, -1])); // flat "up" is sheet "up" (smaller y)
  for (const angleDeg of [0, 37, 117.8, 250]) {
    const [a, b, c, d] = pieceAffine({ x: 0, y: 0, angleDeg }, 3);
    assert.ok(Math.abs(a * d - b * c + 9) < 1e-9, `det at ${angleDeg}°`);
  }
  // angleDeg turns the flat X axis clockwise on screen (towards +y).
  assert.ok(close(at(pieceAffine({ x: 0, y: 0, angleDeg: 90 }, 1), [1, 0]), [0, 1]));
});

// ---- Placement of the fitted pieces ----------------------------------------------------------
const { spiral: spiralCfg, layoutLow } = MODEL_360CRAFT;
const spiral = makeSpiral(spiralCfg);
const unrolling = makeUnrolling(spiral, makeCentreLine(spiral));
const flatOutline = (() => {
  const { pos, neg } = unrolling.seams(0.002);
  return [...pos, ...neg.slice(1, -1).reverse()];
})();
const sheetOutline = (piece) => flatOutline.map((p) => at(pieceAffine(piece, layoutLow.pxPerR), p));

function insidePolygon(poly, [x, y]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

test('both pieces lie inside the 2850×4160 sheet with ≥ 10 px to spare', () => {
  for (const piece of layoutLow.pieces) {
    for (const [x, y] of sheetOutline(piece)) {
      assert.ok(x >= 10 && y >= 10 && x <= layoutLow.widthPx - 10 && y <= layoutLow.heightPx - 10, `band ${piece.band}: (${x}, ${y})`);
    }
  }
});

test('the two placed pieces do not overlap (sample 5000 points of piece 0, none inside piece 1)', () => {
  const [p0, p1] = layoutLow.pieces;
  const other = sheetOutline(p1);
  const A = pieceAffine(p0, layoutLow.pxPerR);
  const xs = flatOutline.map((p) => p[0]);
  const ys = flatOutline.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let n = 0;
  while (n < 5000) {
    const q = [x0 + (x1 - x0) * r(), y0 + (y1 - y0) * r()];
    if (!insidePolygon(flatOutline, q)) continue;
    n++;
    const p = at(A, q);
    assert.ok(!insidePolygon(other, p), `piece-0 point (${p[0]}, ${p[1]}) lies inside piece 1`);
  }
});
