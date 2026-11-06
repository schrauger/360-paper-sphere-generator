// Re-render every fixture × case and overwrite test/fixtures/expected/. Review the diff before committing.
// Usage: node tools/update-golden.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { CASES, EXPECTED_DIR, FIXTURES, loadPanorama, renderCase } from '../test/support/golden-cases.js';

mkdirSync(EXPECTED_DIR, { recursive: true });
for (const fixture of FIXTURES) {
  const pano = await loadPanorama(fixture);
  for (const testCase of CASES) {
    const { rgb, svg } = renderCase(pano, testCase);
    const base = `${EXPECTED_DIR}${fixture}-${testCase.name}`;
    await sharp(rgb.data, { raw: { width: rgb.width, height: rgb.height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(`${base}.png`);
    if (svg !== null) writeFileSync(`${base}.svg`, svg);
    console.log(`wrote ${base}.png${svg !== null ? ' + .svg' : ''} (${rgb.width}x${rgb.height})`);
  }
}
