// CI-visible regression guard: a synthetic panorama rendered at letter/72 dpi must match the committed
// golden PNG. Needs no local data, so it never skips. Tolerances absorb last-ulp float differences
// between Node versions. Set UPDATE_GOLDEN=1 to rewrite the golden (the test then fails on purpose).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { normalizeOptions } from '../src/options.js';
import { renderSheet } from '../src/pipeline.js';
import { gradientPanorama } from './support/synthetic.js';

const GOLDEN = fileURLToPath(new URL('./golden/letter-72.png', import.meta.url));
const MAX_MAE = 0.5;
const MAX_BAD_FRACTION = 0.001; // pixels differing by more than BAD_DELTA in any channel
const BAD_DELTA = 8;

const options = normalizeOptions({ page: 'letter', dpi: 72, marks: 'silhouette', bleed: 'auto', orientation: { yaw: 30 } });

// RGB bytes of the render (alpha dropped, as the CLI writes it).
const renderRGB = (image) => {
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    rgb[j] = image.data[i];
    rgb[j + 1] = image.data[i + 1];
    rgb[j + 2] = image.data[i + 2];
  }
  return { width: image.width, height: image.height, data: rgb };
};

async function decodeRGB(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

test('golden sheet: letter 72 dpi synthetic render matches the committed PNG within tolerance', async () => {
  const { image } = renderSheet(gradientPanorama(1024, 512), options);
  const got = renderRGB(image);

  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
    mkdirSync(path.dirname(GOLDEN), { recursive: true });
    await sharp(got.data, { raw: { width: got.width, height: got.height, channels: 3 } }).png().toFile(GOLDEN);
    assert.fail(`golden ${GOLDEN} was (re)generated; review it and commit it`);
  }

  const want = await decodeRGB(GOLDEN);
  assert.equal(got.width, want.width, 'width differs from golden');
  assert.equal(got.height, want.height, 'height differs from golden');

  let sum = 0;
  let bad = 0;
  for (let p = 0; p < got.data.length; p += 3) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(got.data[p + c] - want.data[p + c]);
      sum += d;
      if (d > worst) worst = d;
    }
    if (worst > BAD_DELTA) bad++;
  }
  const mae = sum / got.data.length;
  const badFraction = bad / (got.width * got.height);
  assert.ok(mae <= MAX_MAE, `MAE ${mae.toFixed(4)} per channel exceeds ${MAX_MAE}`);
  assert.ok(badFraction <= MAX_BAD_FRACTION, `${(badFraction * 100).toFixed(3)}% of pixels differ by more than ${BAD_DELTA} (limit 0.1%)`);
});
