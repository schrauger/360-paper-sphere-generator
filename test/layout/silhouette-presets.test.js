import test from 'node:test';
import assert from 'node:assert/strict';
import { SILHOUETTE_PRESETS, studio3Path } from '../../src/layout/silhouette-presets.js';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { layoutOptionsFor } from '../../src/pipeline.js';
import { cutPathSvg } from '../../src/export/svg.js';
import { PAGE_SIZES, normalizeOptions } from '../../src/options.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const [w, h] = PAGE_SIZES.letter;
const page = { widthMm: w, heightMm: h };
const svgFor = (diameterMm, dpi) => {
  const layout = layoutSheet(MODEL_360CRAFT, outline, { page, dpi, diameterMm, marks: 'silhouette' });
  return { layout, svg: cutPathSvg(layout, outline, { includeMarks: true }) };
};
const svgForOptions = (diameterMm, dpi, bleed) => {
  const options = normalizeOptions({ page: 'letter', marks: 'silhouette', diameterMm, dpi, bleed });
  const layout = layoutSheet(MODEL_360CRAFT, outline, layoutOptionsFor(options));
  return cutPathSvg(layout, outline, { includeMarks: true });
};
const numbers = (svg) => svg.match(/-?\d+(?:\.\d+)?/g).map(Number);

test('letter presets are whole mm, ascending, 40..62', () => {
  assert.deepEqual(SILHOUETTE_PRESETS.letter, [40, 45, 50, 55, 60, 62]);
});

test('studio3Path names the file by page and diameter', () => {
  assert.equal(studio3Path('letter', 50), 'studio3/letter-50mm.studio3');
});

// Spheres per sheet at each preset: as many as fit (the .studio3 files are made with these).
const COPIES = { 40: 2, 45: 2, 50: 1, 55: 1, 60: 1, 62: 1 };

for (const d of SILHOUETTE_PRESETS.letter) {
  test(`preset ${d} mm fits letter with marks, no warning`, () => {
    const { layout } = svgFor(d, 300);
    assert.deepEqual(layout.warnings, []);
    assert.equal(layout.copies, COPIES[d]);
    assert.equal(layout.diameterMm, d);
  });

  test(`preset ${d} mm cut file is identical in mm at any dpi and bleed`, () => {
    const ref = numbers(svgForOptions(d, 300, 'off'));
    for (const dpi of [150, 300, 600]) {
      for (const bleed of ['off', 'auto', 2]) {
        const got = numbers(svgForOptions(d, dpi, bleed));
        assert.equal(got.length, ref.length);
        got.forEach((v, k) => assert.ok(Math.abs(v - ref[k]) <= 0.001, `dpi ${dpi} bleed ${bleed} #${k}: ${v} vs ${ref[k]}`));
      }
    }
  });
}
