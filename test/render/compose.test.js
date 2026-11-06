import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { composeSheet } from '../../src/render/compose.js';
import { transformPts } from '../../src/render/raster.js';
import { totalRotation } from '../../src/render/warp.js';
import { solidImage } from '../support/synthetic.js';

const model = MODEL_360CRAFT;
const geometry = makeModelGeometry(model);
const layout = layoutSheet(model, geometry.outline, { preset: 'original-low' });
const rotation = totalRotation(model, { yaw: 0, pitch: 0, roll: 0 });
const PANO = [60, 120, 200];
const pano = solidImage(256, 128, PANO);
const { affine } = layout.pieces[0];
const px = (img, [x, y]) => Array.from(img.data.subarray((Math.floor(y) * img.width + Math.floor(x)) * 4, (Math.floor(y) * img.width + Math.floor(x)) * 4 + 3));

const withOutline = composeSheet(pano, layout, geometry, model, { outline: true, bleedR: 0, rotation });
const without = composeSheet(pano, layout, geometry, model, { outline: false, bleedR: 0, rotation });
const tab = transformPts(geometry.outline.tabs[10], affine);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

test('background, tab colour and piece content are drawn, the pieces over the tabs', () => {
  assert.deepEqual(px(without, [5, 5]), model.style.background);
  // inside the tab: halfway from the middle of its base to the mean of its three outer vertices
  const outer = tab.slice(-3).reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3], [0, 0]);
  const centre = mid(mid(tab[0], tab.at(-4)), outer);
  assert.deepEqual(px(without, centre), model.style.tabColor);
  assert.deepEqual(px(withOutline, centre), model.style.tabColor);
  // inside the band, between the two seams halfway along: the (solid) panorama colour
  const seams = geometry.unrolling.seams(0.002);
  const k = seams.pos.length >> 1;
  const [middle] = transformPts([mid(seams.pos[k], seams.neg[k])], affine);
  assert.deepEqual(px(without, middle), PANO);
  assert.deepEqual(px(withOutline, middle), PANO);
});

test('the cut outline is stroked in outlineColor on the cut path, and only when asked for', () => {
  const on = mid(tab.at(-3), tab.at(-2)); // the middle of a tab's outer edge, on the cut path
  const dark = px(withOutline, on);
  assert.ok(dark.every((v, i) => Math.abs(v - model.style.outlineColor[i]) < 30), `outline pixel ${dark}`);
  assert.ok(px(without, on).every((v) => v > 150), 'no outline without the option: only the anti-aliased tab edge');
});
