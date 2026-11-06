import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { composeSheet } from '../../src/render/compose.js';
import { makeSheetPreview, renderGlobe, renderPanoramaSeams } from '../../src/render/preview.js';
import { transformPts } from '../../src/render/raster.js';
import { totalRotation } from '../../src/render/warp.js';
import { sampleEquirect } from '../../src/render/sample.js';
import { apply, directionToEquirect, equirectToDirection, rotationFromYPR } from '../../src/sphere/orient.js';
import { bandPhase } from '../../src/sphere/band.js';
import { gradientPanorama } from '../support/synthetic.js';

const model = MODEL_360CRAFT;
const geometry = makeModelGeometry(model);
const pano = gradientPanorama(1024, 512);
const pixel = (img, i, j) => Array.from(img.data.subarray((j * img.width + i) * 4, (j * img.width + i) * 4 + 4));
const IDENTITY = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Area centroid of a closed polygon (shoelace). */
function areaCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

const sheetOptions = { maxWidth: 300, maxHeight: 450, outline: true, bleedR: model.style.bleed, layoutOptions: { preset: 'original-low' } };

test('sheet preview equals composeSheet at the same size within ±1 per channel', () => {
  const preview = makeSheetPreview(model, geometry, sheetOptions);
  const rotation = totalRotation(model, { yaw: 20, pitch: -10, roll: 5 });
  const img = preview.render(pano, rotation);
  const ref = composeSheet(pano, preview.layout, geometry, model, { outline: true, bleedR: model.style.bleed, rotation });
  assert.equal(img.width, preview.width);
  assert.equal(img.height, preview.height);
  assert.ok(preview.width <= 300 && preview.height <= 450);
  let worst = 0;
  for (let i = 0; i < img.data.length; i++) worst = Math.max(worst, Math.abs(img.data[i] - ref.data[i]));
  assert.ok(worst <= 1, `largest channel difference ${worst}`);
});

test('second render with a new rotation changes piece pixels but not tab/background pixels', () => {
  const preview = makeSheetPreview(model, geometry, sheetOptions);
  const a = preview.render(pano, totalRotation(model, { yaw: 0, pitch: 0, roll: 0 }));
  const b = preview.render(pano, totalRotation(model, { yaw: 60, pitch: 15, roll: -20 }));
  const { affine } = preview.layout.pieces[0];
  // The area centroid of a tab (a thin sliver at this scale) lies inside it, clear of the pieces.
  const tab = transformPts(geometry.outline.tabs[10], affine);
  const [tx, ty] = areaCentroid(tab).map(Math.floor);
  assert.deepEqual(pixel(a, tx, ty), [...model.style.tabColor, 255], 'probe is on the tab');
  assert.deepEqual(pixel(a, 2, 2), pixel(b, 2, 2), 'background');
  assert.deepEqual(pixel(a, tx, ty), pixel(b, tx, ty), 'tab');
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) changed++;
  assert.ok(changed > 1000, `piece pixels changed: ${changed}`);
});

test('panorama view at rotation I: an untinted pixel equals the panorama pixel; band-1 pixels are tinted', () => {
  const { spiral } = geometry;
  const W = pano.width;
  const H = pano.height;
  const view = renderPanoramaSeams(pano, IDENTITY, model, { width: W });
  assert.equal(view.width, W);
  assert.equal(view.height, H);
  const tint = [59, 130, 246];
  let plain = 0;
  let tinted = 0;
  for (let j = 0; j < H; j += 3) {
    for (let i = 0; i < W; i += 3) {
      const p = equirectToDirection(i + 0.5, j + 0.5, W, H);
      // Keep clear of the seams, where the seam lines are drawn (edgeDistance: distance to a seam).
      // Near the poles the preview's first-order seam test is approximate (ruling R38): skip there.
      if (p[2] > Math.cos(0.5) || p[2] < -Math.cos(0.5)) continue;
      if (Math.abs(geometry.unrolling.edgeDistance(p)) < 0.03) continue;
      const phase = bandPhase(p, spiral);
      const got = pixel(view, i, j).slice(0, 3);
      if (Math.abs(phase) < Math.PI / 2) {
        assert.deepEqual(got, pixel(pano, i, j).slice(0, 3), `plain pixel (${i}, ${j})`);
        plain++;
      } else {
        const src = pixel(pano, i, j).slice(0, 3);
        got.forEach((c, k) => assert.ok(Math.abs(c - (0.75 * src[k] + 0.25 * tint[k])) <= 1, `tinted pixel (${i}, ${j}) channel ${k}`));
        tinted++;
      }
    }
  }
  assert.ok(plain > 100 && tinted > 100, `plain ${plain}, tinted ${tinted}`);
});

test('globe centre pixel equals the panorama sampled at apply(rotation, apply(viewRotation, [0,0,1]))', () => {
  const size = 401; // odd, so the centre is a pixel centre at (0, 0)
  // View point at polar angle θ on the centre line of band 0 (phase 0), so the centre is not tinted.
  const theta = 0.35;
  const lambda = model.spiral.rate * theta;
  const viewRotation = rotationFromYPR({ yaw: (lambda * 180) / Math.PI, pitch: (theta * 180) / Math.PI, roll: 0 });
  const rotation = totalRotation(model, { yaw: 10, pitch: 0, roll: 0 });
  const globe = renderGlobe(pano, rotation, viewRotation, model, { size });
  const q = apply(rotation, apply(viewRotation, [0, 0, 1]));
  const [u, v] = directionToEquirect(q, pano.width, pano.height);
  const expected = [0, 0, 0];
  sampleEquirect(pano, u, v, expected, 0);
  const c = (size - 1) / 2;
  const got = pixel(globe, c, c);
  assert.equal(got[3], 255);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(got[k] - expected[k]) <= 1, `channel ${k}: ${got[k]} vs ${expected[k]}`);
});

test('globe corners are transparent', () => {
  const size = 400;
  const globe = renderGlobe(pano, totalRotation(model, { yaw: 0, pitch: 0, roll: 0 }), IDENTITY, model, { size });
  assert.equal(globe.width, size);
  assert.equal(globe.height, size);
  for (const [i, j] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) assert.equal(pixel(globe, i, j)[3], 0);
  assert.equal(pixel(globe, size >> 1, size >> 1)[3], 255);
});

test('sheet preview bandDirections: unit band vectors that agree with the rendered colour', () => {
  const preview = makeSheetPreview(model, geometry, { ...sheetOptions, outline: false });
  const { alpha, vec } = preview.bandDirections;
  assert.equal(alpha.length, preview.width * preview.height);
  assert.equal(vec.length, 3 * alpha.length);
  const rotation = totalRotation(model, { yaw: 20, pitch: -10, roll: 5 });
  const img = preview.render(pano, rotation);
  let inside = 0;
  for (let k = 0; k < alpha.length; k += 7) {
    if (alpha[k] !== 255) continue;
    inside++;
    const p = [vec[3 * k], vec[3 * k + 1], vec[3 * k + 2]];
    assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-5);
    const [u, v] = directionToEquirect(apply(rotation, p), pano.width, pano.height);
    const rgb = [0, 0, 0];
    sampleEquirect(pano, u, v, rgb, 0);
    assert.ok(rgb.every((c, i) => Math.abs(c - img.data[4 * k + i]) <= 3), `pixel ${k}`);
  }
  assert.ok(inside > 100, 'enough opaque pixels probed');
});
