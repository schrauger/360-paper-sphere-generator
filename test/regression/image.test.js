// End-to-end image regression against the real 360craft sheets (needs photo examples/, ADR-0002).
// Each fixture's panorama is rendered at its preset and compared in canonical sheet coordinates
// with the 360craft output. Cropped references are sampled through the inverse of <id>.align.json.
// Writes test-output/regression/<id>-diff.png (|diff| × 4 heatmap) and prints MAE and mask agreement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { composeSheet } from '../../src/render/compose.js';
import { fillPolygons, createImage, transformPts } from '../../src/render/raster.js';
import { renderPieces, totalRotation } from '../../src/render/warp.js';
import { loadManifest, SKIP_LOCAL } from '../support/fixtures.js';
import { boxFilter, loadRGBA, savePNG } from '../support/image.js';
import { bleedWidth, outlineWidth, tabGrey, tabMasks } from '../support/style-measure.js';
import { solidImage } from '../support/synthetic.js';

const model = MODEL_360CRAFT;
const geometry = makeModelGeometry(model);
const rotation = totalRotation(model, { yaw: 0, pitch: 0, roll: 0 });
const tolerances = JSON.parse(readFileSync(new URL('./tolerances.json', import.meta.url), 'utf8'));
const manifest = loadManifest();
const ERODE_PX = 6;
const NEAR_WHITE = 12;
const FAR_INK_PX = 20;
// Ruling R29: the accepted T6 fit error (correspondence median 0.315 low-res px) is about one
// original-high pixel of registration, so the colour MAE may be twice the half-pixel tolerance
// (which is itself the MAE of a half-pixel shift) and the mask agreement 0.994 instead of 0.995.
const MAE_FACTOR = 2;
const AGREEMENT = 0.994;

const alignPath = (id) => path.resolve('test-output/research', `${id}.align.json`);
const skipFor = (f) => {
  if (!manifest) return SKIP_LOCAL;
  if (f.cropped && !existsSync(alignPath(f.id))) return `${f.id}.align.json missing (run tools/research/align.py)`;
  return false;
};

/** The sheet's pieces in sheet px: tabs, cut path, edge and seams. */
function sheetPieces(layout) {
  const seams = geometry.unrolling.seams(0.002);
  const { outline } = geometry;
  return layout.pieces.map(({ affine }) => ({
    tabs: outline.tabs.map((t) => transformPts(t, affine)),
    cutPath: transformPts(outline.cutPath, affine),
    edge: transformPts(outline.edge, affine),
    pos: transformPts(seams.pos, affine),
    neg: transformPts(seams.neg, affine),
  }));
}

/** Reference as canonical sheet-sized RGBA; cropped ones resampled bilinearly through align.json. */
function canonicalReference(ref, f, w, h) {
  if (!f.cropped) {
    assert.equal(`${ref.width}x${ref.height}`, `${w}x${h}`, `${f.id}: reference size`);
    return ref;
  }
  const { scale, tx, ty } = JSON.parse(readFileSync(alignPath(f.id), 'utf8'));
  const out = new Uint8ClampedArray(w * h * 4).fill(255); // outside the crop: paper
  const { width: rw, height: rh, data: rd } = ref;
  for (let y = 0; y < h; y++) {
    const sy = (y - ty) / scale;
    if (sy < 0 || sy > rh - 1) continue;
    const y0 = Math.min(Math.floor(sy), rh - 2);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = (x - tx) / scale;
      if (sx < 0 || sx > rw - 1) continue;
      const x0 = Math.min(Math.floor(sx), rw - 2);
      const fx = sx - x0;
      const o = (y * w + x) * 4;
      const a = (y0 * rw + x0) * 4;
      const b = a + rw * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (rd[a + c] * (1 - fx) + rd[a + 4 + c] * fx) * (1 - fy) + (rd[b + c] * (1 - fx) + rd[b + 4 + c] * fx) * fy;
      }
    }
  }
  return { width: w, height: h, data: out };
}

for (const f of manifest?.fixtures ?? []) {
  test(`${f.id} matches 360craft`, { skip: skipFor(f) }, async () => {
    const layout = layoutSheet(model, geometry.outline, { preset: f.preset });
    const { widthPx: w, heightPx: h } = layout;
    const pano = await loadRGBA(f.panorama);
    const bleedR = f.bleed ? model.style.bleed : 0;
    const ours = composeSheet(pano, layout, geometry, model, { outline: f.outline, bleedR, rotation });
    const ref = canonicalReference(await loadRGBA(f.reference), f, w, h);

    // Ink: both pieces with their tabs, plus the bleed.
    const inkImg = createImage(w, h, [0, 0, 0, 0]);
    for (const { affine } of layout.pieces) fillPolygons(inkImg, [transformPts(geometry.outline.cutPath, affine)], [0, 0, 0]);
    const ink = new Uint8Array(w * h);
    // Interior: where the rendered pieces (with bleed) have alpha 1, eroded 6 px.
    const pieceImg = createImage(w, h, [0, 0, 0, 0]);
    renderPieces(pieceImg, layout, geometry, pano, rotation, { bleedR });
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < solid.length; i++) {
      solid[i] = pieceImg.data[i * 4 + 3] === 255 ? 1 : 0;
      ink[i] = inkImg.data[i * 4 + 3] > 127 || pieceImg.data[i * 4 + 3] > 127 ? 1 : 0;
    }
    pieceImg.data = null;
    inkImg.data = null;
    const interior = boxFilter(solid, w, h, ERODE_PX, 'erode');
    // Flat tab colour (away from the outline, not under the bleed) is the style test's business:
    // some references (2018-09-b) print the tabs white.
    const tabs = tabMasks(w, h, sheetPieces(layout), 6).inside;
    const flatTab = new Uint8Array(w * h);
    for (let i = 0; i < flatTab.length; i++) flatTab[i] = tabs[i] && !solid[i] ? 1 : 0;

    // Reference ink = not near white; far-from-ink hand marks are ignored.
    const o = ours.data;
    const r = ref.data;
    const refInk = new Uint8Array(w * h);
    for (let i = 0; i < refInk.length; i++) {
      refInk[i] = r[i * 4] < 255 - NEAR_WHITE || r[i * 4 + 1] < 255 - NEAR_WHITE || r[i * 4 + 2] < 255 - NEAR_WHITE ? 1 : 0;
    }
    const nearInk = boxFilter(ink, w, h, FAR_INK_PX, 'dilate');

    let sum = 0;
    let n = 0;
    let agree = 0;
    let considered = 0;
    const heat = new Uint8Array(w * h * 3);
    for (let i = 0; i < ink.length; i++) {
      const p = i * 4;
      const dr = Math.abs(o[p] - r[p]);
      const dg = Math.abs(o[p + 1] - r[p + 1]);
      const db = Math.abs(o[p + 2] - r[p + 2]);
      heat[i * 3] = Math.min(255, dr * 4);
      heat[i * 3 + 1] = Math.min(255, dg * 4);
      heat[i * 3 + 2] = Math.min(255, db * 4);
      if (interior[i]) {
        sum += dr + dg + db;
        n++;
      }
      const ourWhite = o[p] > 255 - NEAR_WHITE && o[p + 1] > 255 - NEAR_WHITE && o[p + 2] > 255 - NEAR_WHITE;
      if (flatTab[i] || (ink[i] && ourWhite) || (refInk[i] && !nearInk[i])) continue;
      considered++;
      if (ink[i] === refInk[i]) agree++;
    }
    const mae = sum / (3 * n);
    const agreement = agree / considered;
    await savePNG({ width: w, height: h, data: heat }, path.resolve('test-output/regression', `${f.id}-diff.png`), 3);
    const msg = `${f.id}: MAE ${mae.toFixed(3)} (limit ${MAE_FACTOR * tolerances[f.id].maeHalfPixel}), mask agreement ${(agreement * 100).toFixed(3)}% over ${n} interior px`;
    console.log(msg);
    assert.ok(mae <= MAE_FACTOR * tolerances[f.id].maeHalfPixel, msg);
    assert.ok(agreement >= AGREEMENT, msg);
  });
}

// Style-only references have no panorama: render a solid colour that is not tab grey and compare the style.
const SOLID = [60, 120, 200];
for (const f of manifest?.styleOnly ?? []) {
  test(`${f.id} style`, { skip: manifest ? false : SKIP_LOCAL }, async () => {
    const layout = layoutSheet(model, geometry.outline, { preset: f.preset });
    const scale = layout.pxPerR / model.layoutLow.pxPerR;
    const bleedR = f.bleed ? model.style.bleed : 0;
    const ours = composeSheet(solidImage(1024, 512, SOLID), layout, geometry, model, { outline: f.outline, bleedR, rotation });
    const ref = await loadRGBA(f.reference);
    assert.equal(`${ref.width}x${ref.height}`, `${layout.widthPx}x${layout.heightPx}`, `${f.id}: reference size`);
    const pieces = sheetPieces(layout);
    const grey = [tabGrey(ours, pieces), tabGrey(ref, pieces)];
    const note = [`${f.id}: tab grey ours ${grey[0]} / ref ${grey[1]}`];
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(grey[0][c] - grey[1][c]) <= 6, note[0]);
    if (f.outline) {
      const a = outlineWidth(ours, pieces);
      const b = outlineWidth(ref, pieces);
      note.push(`outline width ours ${a.width.toFixed(2)} / ref ${b.width.toFixed(2)} px (×${scale} of low res)`);
      assert.ok(Math.abs(a.width - b.width) <= 1, note.join('; '));
    }
    if (f.bleed) {
      const opts = { length: geometry.unrolling.length };
      const a = bleedWidth(ours, pieces, grey[1], opts);
      const b = bleedWidth(ref, pieces, grey[1], opts);
      note.push(`bleed ours ${a.width.toFixed(2)} / ref ${b.width.toFixed(2)} px`);
      assert.ok(Math.abs(a.width - b.width) <= 1, note.join('; '));
    }
    console.log(note.join('; '));
  });
}
