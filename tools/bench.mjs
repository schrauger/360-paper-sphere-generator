// Timing of the full-sheet render. Run with `npm run bench`.
import { normalizeOptions } from '../src/options.js';
import { renderSheet } from '../src/pipeline.js';

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
// The T14 previews (sheet ≤ 50 ms, globe ≤ 30 ms) are added with the web app.
