// Timing of the full-sheet render and the web previews. Run with `npm run bench`.
import { normalizeOptions } from '../src/options.js';
import { renderSheet } from '../src/pipeline.js';
import { MODEL_360CRAFT } from '../src/model/360craft.js';
import { makeModelGeometry } from '../src/model/geometry.js';
import { makeSheetPreview, renderGlobe, renderPanoramaSeams } from '../src/render/preview.js';
import { totalRotation } from '../src/render/warp.js';
import { rotationFromYPR } from '../src/sphere/orient.js';

// A smooth synthetic equirectangular panorama (the content does not change the cost).
function panorama(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = (x / width) * 255;
      data[o + 1] = (y / height) * 255;
      data[o + 2] = 128 + 127 * Math.sin((x + y) / 97);
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

const pano = panorama(6912, 3456);
// One warm-up run, then the median of 3 timed runs.
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = (label, fn) => {
  fn();
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  console.log(`${label}: ${Math.round(median(runs))} ms (median of 3)`);
};
time('original-high', () => renderSheet(pano, normalizeOptions({ preset: 'original-high' })));

// Previews (budgets: sheet 600×900 ≤ 50 ms, globe 400×400 ≤ 30 ms, panorama view 1200×600 ≤ 50 ms).
const model = MODEL_360CRAFT;
const geometry = makeModelGeometry(model);
const rotation = totalRotation(model, { yaw: 30, pitch: 10, roll: -5 });
const sheet = makeSheetPreview(model, geometry, {
  maxWidth: 600,
  maxHeight: 900,
  outline: true,
  bleedR: model.style.bleed,
  layoutOptions: { preset: 'original-low' },
});
time('sheet preview 600×900', () => sheet.render(pano, rotation));
const viewRotation = rotationFromYPR({ yaw: 20, pitch: 15, roll: 0 });
time('globe 400×400 (6912 px source)', () => renderGlobe(pano, rotation, viewRotation, model, { size: 400 }));
time('panorama view 1200×600 (6912 px source)', () => renderPanoramaSeams(pano, rotation, model, { width: 1200 }));
// T16 previews from a ≤ 2048 px copy of the panorama (ruling R39): the budgets apply here.
const previewPano = panorama(2048, 1024);
time('globe 400×400 (2048 px source)', () => renderGlobe(previewPano, rotation, viewRotation, model, { size: 400 }));
time('panorama view 1200×600 (2048 px source)', () => renderPanoramaSeams(previewPano, rotation, model, { width: 1200 }));
