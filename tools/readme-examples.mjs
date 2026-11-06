// Renders the README's example images from the test fixtures: panorama on the left, the sheet
// (letter, 72 dpi, bleed auto, outline on) on the right, with the photo credit burned into the image.
// Usage: node tools/readme-examples.mjs
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { FIXTURES_DIR, loadPanorama, renderCase } from '../test/support/golden-cases.js';

const EXAMPLES = [
  { fixture: 'blue-marble', credit: 'Panorama: NASA Blue Marble 2002 (Terra/MODIS), public domain' },
  { fixture: 'pxhere-461435', credit: 'Panorama: PxHere #461435, CC0' },
];
const OUT = new URL('../docs/img/', import.meta.url);
const SHEET_CASE = { name: 'readme', raw: { page: 'letter', dpi: 72, bleed: 'auto' } };

mkdirSync(OUT, { recursive: true });
for (const { fixture, credit } of EXAMPLES) {
  const { rgb } = renderCase(await loadPanorama(fixture), SHEET_CASE);
  const sheet = await sharp(rgb.data, { raw: { width: rgb.width, height: rgb.height, channels: 3 } }).png().toBuffer();
  const pano = await sharp(`${FIXTURES_DIR}${fixture}.jpg`).resize(640, 320).toBuffer();
  const W = 640 + 24 + rgb.width + 24;
  const H = rgb.height + 24 + 30;
  const label = (x, y, text) => `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#1f2933">${text}</text>`;
  const caption = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      label(12, 20, 'equirectangular input (2:1)') + label(12 + 640 + 24, 20, 'output sheet') +
      `<rect x="0" y="${H - 28}" width="${W}" height="28" fill="#fff"/>${label(12, H - 9, credit)}</svg>`,
  );
  const file = new URL(`example-${fixture}.jpg`, OUT);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([
      { input: pano, left: 12, top: 32 + 140 },
      { input: sheet, left: 12 + 640 + 24, top: 32 },
      { input: caption, left: 0, top: 0 },
    ])
    .jpeg({ quality: 88 })
    .toFile(file.pathname);
  console.log(`wrote docs/img/example-${fixture}.jpg (${W}x${H})`);
}
