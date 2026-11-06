import test from 'node:test';
import assert from 'node:assert/strict';
import { SILHOUETTE_PRESETS, studio3Path } from '../../src/layout/silhouette-presets.js';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { resolveBleed } from '../../src/pipeline.js';
import { cutPathSvg } from '../../src/export/svg.js';
import { PAGE_SIZES } from '../../src/options.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const [w, h] = PAGE_SIZES.letter;
const page = { widthMm: w, heightMm: h };
const svgFor = (diameterMm, dpi) => {
  const layout = layoutSheet(MODEL_360CRAFT, outline, { page, dpi, diameterMm, marks: 'silhouette' });
  return { layout, svg: cutPathSvg(layout, outline, { includeMarks: true }) };
};
const numbers = (svg) => svg.match(/-?\d+(?:\.\d+)?/g).map(Number);

test('letter presets are whole mm, ascending, 40..62', () => {
  assert.deepEqual(SILHOUETTE_PRESETS.letter, [40, 45, 50, 55, 60, 62]);
});

test('studio3Path names the file by page and diameter', () => {
  assert.equal(studio3Path('letter', 50), 'studio3/letter-50mm.studio3');
});

for (const d of SILHOUETTE_PRESETS.letter) {
  test(`preset ${d} mm fits letter with marks, no warning`, () => {
    const { layout } = svgFor(d, 300);
    assert.deepEqual(layout.warnings, []);
    assert.equal(layout.diameterMm, d);
  });

  test(`preset ${d} mm cut file is identical in mm at any dpi and bleed`, () => {
    const ref = numbers(svgFor(d, 300).svg);
    for (const dpi of [150, 600]) {
      const got = numbers(svgFor(d, dpi).svg);
      assert.equal(got.length, ref.length);
      got.forEach((v, i) => assert.ok(Math.abs(v - ref[i]) <= 0.001, `dpi ${dpi} #${i}: ${v} vs ${ref[i]}`));
    }
    // Bleed only changes the image (resolveBleed), never the layout.
    for (const bleedMm of [0, 'auto']) {
      const { layout } = svgFor(d, 300);
      resolveBleed({ bleedMm, dpi: 300 }, layout);
      assert.equal(cutPathSvg(layout, outline, { includeMarks: true }), svgFor(d, 300).svg);
    }
  });
}
