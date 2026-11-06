// The fixture × option-set matrix shared by test/golden.test.js and tools/update-golden.mjs.
// Each case renders a shareable fixture panorama (test/fixtures/*.jpg) to a sheet and compares it
// with test/fixtures/expected/<fixture>-<case>.png (and .svg when the case writes a cut file).
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { normalizeOptions } from '../../src/options.js';
import { renderSheet } from '../../src/pipeline.js';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const EXPECTED_DIR = `${FIXTURES_DIR}expected/`;

export const FIXTURES = ['blue-marble', 'pxhere-461435'];

export const CASES = [
  {
    name: 'letter-bleed-marks-yaw30',
    raw: { page: 'letter', dpi: 100, bleed: 'auto', marks: 'silhouette', orientation: { yaw: 30 } },
  },
  {
    name: 'a4-no-outline-svg',
    raw: { page: 'a4', dpi: 100, bleed: 'off', outline: false, cutFile: 'svg' },
  },
];

/** Decode a fixture JPEG to the RGBAImage the pipeline takes. */
export async function loadPanorama(fixture) {
  const { data, info } = await sharp(`${FIXTURES_DIR}${fixture}.jpg`)
    .toColourspace('srgb').flatten({ background: '#fff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Render one fixture with one case: { rgb: {width, height, data (RGB bytes)}, svg: string | null }. */
export function renderCase(pano, testCase) {
  const { image, cutFile } = renderSheet(pano, normalizeOptions(testCase.raw));
  const rgb = Buffer.alloc(image.width * image.height * 3);
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
    rgb[j] = image.data[i];
    rgb[j + 1] = image.data[i + 1];
    rgb[j + 2] = image.data[i + 2];
  }
  return { rgb: { width: image.width, height: image.height, data: rgb }, svg: cutFile?.type === 'svg' ? cutFile.content : null };
}
