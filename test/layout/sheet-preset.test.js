import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const low = layoutSheet(MODEL_360CRAFT, outline, { preset: 'original-low' });
const high = layoutSheet(MODEL_360CRAFT, outline, { preset: 'original-high' });

test('original-low is 2850×4160, original-high 5700×8320 with pxPerR doubled', () => {
  assert.equal(low.widthPx, 2850);
  assert.equal(low.heightPx, 4160);
  assert.equal(high.widthPx, 5700);
  assert.equal(high.heightPx, 8320);
  assert.equal(high.pxPerR, 2 * low.pxPerR);
  assert.equal(low.pxPerR, MODEL_360CRAFT.layoutLow.pxPerR);
  // Two pieces, left (band 1) first; the high affine is the low one with scale and offset doubled.
  assert.deepEqual(low.pieces.map((p) => p.band), [1, 0]);
  low.pieces.forEach((p, i) => assert.deepEqual(high.pieces[i].affine, p.affine.map((v) => 2 * v)));
  assert.deepEqual(low.marks, []);
  assert.deepEqual(low.warnings, []);
});

test('diameterMm at original-low with dpi 300 = 2·pxPerR/300·25.4', () => {
  assert.equal(low.dpi, 300);
  assert.equal(low.diameterMm, ((2 * low.pxPerR) / 300) * 25.4);
  assert.ok(Math.abs(low.diameterMm - 83.4) < 0.5); // ≈ 83.4 mm
  assert.equal(layoutSheet(MODEL_360CRAFT, outline, { preset: 'original-low', dpi: 150 }).diameterMm, low.diameterMm * 2);
});

test('an unknown preset is an error', () => {
  assert.throws(() => layoutSheet(MODEL_360CRAFT, outline, { preset: 'huge' }), /Unknown sheet preset/);
});
