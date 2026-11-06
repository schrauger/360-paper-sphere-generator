import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, fillPolygons, strokePolyline, transformPts } from '../../src/render/raster.js';

const px = (img, x, y) => img.data[(y * img.width + x) * 4];
const sumCoverage = (img) => {
  let s = 0;
  for (let i = 0; i < img.data.length; i += 4) s += (255 - img.data[i]) / 255;
  return s;
};

test('square [10,20]^2 filled black: pixel (15,15) = 0, (25,25) untouched, sum coverage = 100', () => {
  const img = createImage(40, 40);
  fillPolygons(img, [[[10, 10], [20, 10], [20, 20], [10, 20]]], [0, 0, 0]);
  assert.equal(px(img, 15, 15), 0);
  assert.equal(px(img, 25, 25), 255);
  assert.ok(Math.abs(sumCoverage(img) - 100) < 0.01);
});

test('edge at x = 10.5 gives pixel column 10 coverage 0.5', () => {
  const img = createImage(40, 40);
  fillPolygons(img, [[[10.5, 10], [20, 10], [20, 20], [10.5, 20]]], [0, 0, 0]);
  assert.ok([127, 128].includes(px(img, 10, 15)));
  assert.equal(px(img, 9, 15), 255);
  assert.equal(px(img, 11, 15), 0);
});

test('triangle (0,0),(40,0),(0,30): sum coverage within 0.5% of 600', () => {
  const img = createImage(50, 50);
  fillPolygons(img, [[[0, 0], [40, 0], [0, 30]]], [0, 0, 0]);
  assert.ok(Math.abs(sumCoverage(img) - 600) / 600 < 0.005);
});

test('overlapping polygons with non-zero winding: no double-darkening at 50% opacity', () => {
  const img = createImage(40, 40);
  const a = [[5, 5], [25, 5], [25, 25], [5, 25]];
  const b = [[15, 15], [35, 15], [35, 35], [15, 35]];
  fillPolygons(img, [a, b], [0, 0, 0], { opacity: 0.5 });
  assert.equal(px(img, 20, 20), px(img, 8, 8));
  assert.ok([127, 128].includes(px(img, 8, 8)));
});

test('opposite-wound overlap cancels to winding 0 (a hole), rest stays filled', () => {
  const img = createImage(40, 40);
  const a = [[5, 5], [25, 5], [25, 25], [5, 25]];
  const b = [[15, 15], [15, 35], [35, 35], [35, 15]];
  fillPolygons(img, [a, b], [0, 0, 0]);
  assert.equal(px(img, 20, 20), 255);
  assert.equal(px(img, 8, 8), 0);
  assert.equal(px(img, 30, 30), 0);
});

test('polygons partly outside the image are clipped without error', () => {
  const img = createImage(20, 20);
  fillPolygons(img, [[[-10, -10], [30, -10], [30, 30], [-10, 30]]], [0, 0, 0]);
  assert.equal(px(img, 0, 0), 0);
  assert.equal(px(img, 19, 19), 0);
});

test('horizontal stroke width 2 at y = 10 from x 5..30: rows 9,10 full, rows 8,11 untouched', () => {
  const img = createImage(40, 20);
  strokePolyline(img, [[5, 10], [30, 10]], 2, [0, 0, 0]);
  assert.equal(px(img, 15, 9), 0);
  assert.equal(px(img, 15, 10), 0);
  assert.equal(px(img, 15, 8), 255);
  assert.equal(px(img, 15, 11), 255);
});

test('closed stroke joins the last point to the first', () => {
  const img = createImage(40, 40);
  strokePolyline(img, [[10, 10], [30, 10], [30, 30], [10, 30]], 2, [0, 0, 0], { closed: true });
  assert.equal(px(img, 10, 20), 0);
  assert.equal(px(img, 20, 20), 255);
});

test('transformPts applies the canvas affine', () => {
  const out = transformPts([[1, 2]], [2, 3, 5, 7, 11, 13]);
  assert.deepEqual(out, [[2 * 1 + 5 * 2 + 11, 3 * 1 + 7 * 2 + 13]]);
});
