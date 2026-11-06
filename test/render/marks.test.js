import test from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../../src/render/raster.js';
import { drawMarks } from '../../src/render/marks.js';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { buildGuide } from '../../src/render/guide.js';
import { makePixelMapper } from '../../src/render/warp.js';

const DPI = 300;
const mm = (v) => (v / 25.4) * DPI;
const geometry = makeModelGeometry(MODEL_360CRAFT);
const layout = layoutSheet(MODEL_360CRAFT, geometry.outline, { page: { widthMm: 215.9, heightMm: 279.4 }, marks: 'silhouette', dpi: DPI });
const img = createImage(layout.widthPx, layout.heightPx);
drawMarks(img, layout.marks);
const black = (x, y) => img.data[(y * img.width + x) * 4] === 0;
const count = (x0, y0, x1, y1) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (black(x, y)) n++;
  return n;
};

test('drawMarks: square pixels black', () => {
  const [sq] = layout.marks;
  const x = Math.ceil(sq.x) + 1;
  const y = Math.ceil(sq.y) + 1;
  assert.ok(black(x, y) && black(x + Math.floor(sq.size) - 4, y + Math.floor(sq.size) - 4));
  assert.ok(!black(Math.floor(sq.x) - 2, y) && !black(x, Math.floor(sq.y + sq.size) + 2));
});

test('drawMarks: L legs 0.5 mm thick and 10 mm long', () => {
  const [, tr, bl] = layout.marks;
  const stroke = mm(0.5);
  const leg = mm(10);
  // TR ┐: horizontal leg along y = tr.y going left, vertical leg along x = tr.x going down
  const mx = Math.round(tr.x - leg / 2);
  const my = Math.round(tr.y + leg / 2);
  const horizontalThick = count(mx, Math.floor(tr.y) - 3, mx + 1, Math.floor(tr.y) + 12);
  const verticalThick = count(Math.floor(tr.x) - 12, my, Math.floor(tr.x) + 3, my + 1);
  assert.ok(Math.abs(horizontalThick - stroke) <= 1.5, `${horizontalThick} vs ${stroke}`);
  assert.ok(Math.abs(verticalThick - stroke) <= 1.5, `${verticalThick} vs ${stroke}`);
  // length: horizontal row through the leg's middle
  const rowY = Math.round(tr.y + stroke / 2);
  const len = count(Math.floor(tr.x - leg) - 5, rowY, Math.ceil(tr.x) + 5, rowY + 1);
  assert.ok(Math.abs(len - leg) <= 2, `${len} vs ${leg}`);
  // BL └: vertical leg up along x = bl.x, horizontal leg right along y = bl.y
  const colX = Math.round(bl.x + stroke / 2);
  const lenV = count(colX, Math.floor(bl.y - leg) - 5, colX + 1, Math.ceil(bl.y) + 5);
  assert.ok(Math.abs(lenV - leg) <= 2, `${lenV} vs ${leg}`);
  assert.ok(black(Math.round(bl.x + leg - 3), Math.round(bl.y - stroke / 2)));
  assert.ok(!black(Math.round(bl.x + leg + 3), Math.round(bl.y - stroke / 2)));
  // total black area of the L: two legs overlapping in one stroke² corner
  const area = count(Math.floor(bl.x) - 3, Math.floor(bl.y - leg) - 3, Math.ceil(bl.x + leg) + 3, Math.ceil(bl.y) + 3);
  assert.ok(Math.abs(area - (2 * leg * stroke - stroke * stroke)) < 40, `${area}`);
});

test('R28: guide throws RangeError for more than 8 pieces', () => {
  const nine = { ...layout, pieces: Array.from({ length: 9 }, () => layout.pieces[0]) };
  assert.throws(() => buildGuide(nine, geometry), RangeError);
  assert.doesNotThrow(() => buildGuide({ ...layout, pieces: Array.from({ length: 8 }, () => layout.pieces[0]) }, geometry));
});

test('R28: makePixelMapper rejects NaN, infinite and negative bleedR', () => {
  for (const bleedR of [NaN, Infinity, -0.01]) assert.throws(() => makePixelMapper(layout, geometry, { bleedR }), RangeError);
  assert.doesNotThrow(() => makePixelMapper(layout, geometry, { bleedR: 0 }));
});
