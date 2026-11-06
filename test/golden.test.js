// Golden renders of the shareable fixtures (real panoramas, public domain / CC0; see
// test/fixtures/README.md). Re-renders each fixture × case and compares it with the committed
// PNG (exact size, MAE ≤ 0.5 per channel) and SVG (identical text).
// Regenerate with `node tools/update-golden.mjs` after an intended rendering change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { CASES, EXPECTED_DIR, FIXTURES, loadPanorama, renderCase } from './support/golden-cases.js';

const MAX_MAE = 0.5;

for (const fixture of FIXTURES) {
  for (const testCase of CASES) {
    test(`golden: ${fixture} / ${testCase.name}`, async () => {
      const got = renderCase(await loadPanorama(fixture), testCase);
      const base = `${EXPECTED_DIR}${fixture}-${testCase.name}`;
      const { data, info } = await sharp(`${base}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(got.rgb.width, info.width, 'width differs from golden');
      assert.equal(got.rgb.height, info.height, 'height differs from golden');
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += Math.abs(got.rgb.data[i] - data[i]);
      const mae = sum / data.length;
      assert.ok(mae <= MAX_MAE, `MAE ${mae.toFixed(3)} per channel exceeds ${MAX_MAE}`);
      if (testCase.raw.cutFile === 'svg') {
        assert.equal(got.svg, readFileSync(`${base}.svg`, 'utf8'), 'cut-file SVG differs from golden');
      } else {
        assert.equal(got.svg, null);
      }
    });
  }
}
