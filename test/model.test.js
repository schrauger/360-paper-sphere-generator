import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceAffine } from '../src/model/360craft.js';

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
