import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../src/model/360craft.js';
import { makeModelGeometry } from '../src/model/geometry.js';
import { layoutSheet } from '../src/layout/sheet.js';
import { normalizeOptions } from '../src/options.js';
import { edgeStretch, resolveBleed } from '../src/pipeline.js';
import { MAX_BLEED_R } from '../src/render/warp.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const layout = layoutSheet(MODEL_360CRAFT, outline, { page: { widthMm: 215.9, heightMm: 279.4 }, dpi: 300 });

test('edgeStretch is derived from the model and matches the documented sec²d ≈ 1.0690 within 1e-3', () => {
  // style.bleed in the model was derived with sec²d = 1.0690, so the derived value must agree with it
  const s = edgeStretch(MODEL_360CRAFT);
  assert.ok(Math.abs(s - 1.069) < 1e-3, `edgeStretch ${s}`);
});

test('resolveBleed converts mm to sphere R by the derived stretch (and clamps to MAX_BLEED_R)', () => {
  const { bleedR } = resolveBleed(normalizeOptions({ bleed: 1, dpi: 300 }), layout, MODEL_360CRAFT);
  const expected = ((1 / 25.4) * 300) / layout.pxPerR / edgeStretch(MODEL_360CRAFT);
  assert.ok(Math.abs(bleedR - expected) < 1e-12, `${bleedR} vs ${expected}`);
  const big = resolveBleed(normalizeOptions({ bleed: 50, dpi: 300 }), layout, MODEL_360CRAFT);
  assert.equal(big.bleedR, MAX_BLEED_R);
  assert.equal(big.warnings.length, 1);
});

test('resolveBleed auto uses the model bleed', () => {
  const { bleedR, warnings } = resolveBleed(normalizeOptions({ bleed: 'auto' }), layout, MODEL_360CRAFT);
  assert.equal(bleedR, MODEL_360CRAFT.style.bleed);
  assert.deepEqual(warnings, []);
});
