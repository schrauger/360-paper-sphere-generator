// Writes <out-dir>/<page>-<D>mm.svg for every Silhouette preset size (red cut lines + black marks), to
// import into Silhouette Studio and save as studio3/<page>-<D>mm.studio3. Usage: node tools/silhouette-presets.mjs <out-dir>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODEL_360CRAFT } from '../src/model/360craft.js';
import { makeModelGeometry } from '../src/model/geometry.js';
import { layoutSheet } from '../src/layout/sheet.js';
import { PAGE_SIZES } from '../src/options.js';
import { cutPathSvg } from '../src/export/svg.js';
import { SILHOUETTE_PRESETS, studio3Path } from '../src/layout/silhouette-presets.js';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node tools/silhouette-presets.mjs <out-dir>');
  process.exit(2);
}
await mkdir(outDir, { recursive: true });
const { outline } = makeModelGeometry(MODEL_360CRAFT);
for (const [pageName, diameters] of Object.entries(SILHOUETTE_PRESETS)) {
  const [widthMm, heightMm] = PAGE_SIZES[pageName];
  for (const diameterMm of diameters) {
    const layout = layoutSheet(MODEL_360CRAFT, outline, { page: { widthMm, heightMm }, diameterMm, marks: 'silhouette' });
    const name = studio3Path(pageName, diameterMm).replace(/^studio3\//, '').replace(/\.studio3$/, '.svg');
    await writeFile(join(outDir, name), cutPathSvg(layout, outline, { includeMarks: true }));
    console.log(join(outDir, name));
  }
}
