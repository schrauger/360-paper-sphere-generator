import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { createImage, transformPts } from '../../src/render/raster.js';
import { apply, directionToEquirect, rotZ } from '../../src/sphere/orient.js';
import { sampleEquirect } from '../../src/render/sample.js';
import { makePixelMapper, MAX_BLEED_R, renderPieces, totalRotation } from '../../src/render/warp.js';
import { gradientPanorama } from '../support/synthetic.js';

const model = MODEL_360CRAFT;
const geometry = makeModelGeometry(model);
const { unrolling } = geometry;
const layout = layoutSheet(model, geometry.outline, { preset: 'original-low' });
const { pxPerR, widthPx: SW, heightPx: SH } = layout;
const pano = gradientPanorama(1024, 512);
const R0 = totalRotation(model, { yaw: 0, pitch: 0, roll: 0 });
const WHITE = [255, 255, 255, 255]; // the gradient panorama never reaches 255 in R or G

// Deterministic pseudo-random numbers in [0, 1).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const renders = new Map();
function render(bleedR) {
  if (!renders.has(bleedR)) {
    const img = createImage(SW, SH, WHITE);
    renderPieces(img, layout, geometry, pano, R0, { bleedR });
    renders.set(bleedR, img);
  }
  return renders.get(bleedR);
}
const pixel = (img, i, j) => Array.from(img.data.subarray((j * img.width + i) * 4, (j * img.width + i) * 4 + 4));
const untouched = (img, i, j) => pixel(img, i, j).every((c) => c === 255);

// Independent reference: sheet point of piece k → flat (inverse affine) → flatToStrip with no
// guess → band-0-frame sphere point and the band's own point (rotZ(band·π)).
function reference(k, x, y) {
  const [a, b, c, d, e, f] = layout.pieces[k].affine;
  const det = a * d - b * c;
  const X = (d * (x - e) - c * (y - f)) / det;
  const Y = (-b * (x - e) + a * (y - f)) / det;
  const rec = unrolling.flatToStrip(X, Y);
  if (!rec.ok) return null;
  const p = unrolling.stripToSphere(rec);
  return { rec, p, q: apply(rotZ(layout.pieces[k].band * Math.PI), p) };
}
function referenceColour(q, rotation = R0, P = pano) {
  const [u, v] = directionToEquirect(apply(rotation, q), P.width, P.height);
  const out = [0, 0, 0];
  sampleEquirect(P, u, v, out);
  return out;
}

// Random pixel centres at least 3 px inside piece k's edge (by the sphere edge distance).
function interiorPixels(count, seed) {
  const rand = rng(seed);
  const found = [];
  while (found.length < count) {
    const i = Math.floor(rand() * SW);
    const j = Math.floor(rand() * SH);
    for (let k = 0; k < layout.pieces.length; k++) {
      const r = reference(k, i + 0.5, j + 0.5);
      if (r && unrolling.edgeDistance(r.p) > 3 / pxPerR) found.push({ i, j, k, ...r });
    }
  }
  return found;
}

// Signed distance (sheet px, positive outside) from a point to piece k's band edge polygon.
const edgePolys = layout.pieces.map((p) => transformPts(geometry.outline.edge, p.affine));
function edgeSignedDistance(k, x, y) {
  const poly = edgePolys[k];
  let best = Infinity;
  let inside = false;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - x0 - t * dx, y - y0 - t * dy));
    if (y0 > y !== y1 > y && x < x0 + ((y - y0) / (y1 - y0)) * dx) inside = !inside;
  }
  return inside ? -best : best;
}

// Pixels whose centre lies between `lo` and `hi` sheet px from piece k's edge (positive =
// outside), found by stepping out along the edge's normal from every `stride`-th vertex.
function pixelsAtEdgeDistance(lo, hi, stride = 40) {
  const found = [];
  edgePolys.forEach((poly, k) => {
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
    // y-down sheet: positive area runs clockwise on screen, with the inside on the right of
    // the direction of travel, so (ty, −tx) points out.
    const outward = area > 0 ? 1 : -1;
    for (let v = 0; v < n; v += stride) {
      const a = poly[(v + n - 1) % n];
      const b = poly[(v + 1) % n];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const l = Math.hypot(tx, ty);
      const nx = (outward * ty) / l;
      const ny = (-outward * tx) / l;
      const mid = (lo + hi) / 2;
      const i = Math.floor(poly[v][0] + nx * mid);
      const j = Math.floor(poly[v][1] + ny * mid);
      if (i < 0 || j < 0 || i >= SW || j >= SH) continue;
      const dist = edgeSignedDistance(k, i + 0.5, j + 0.5);
      if (dist >= lo && dist <= hi) found.push({ i, j, k, dist });
    }
  });
  return found;
}

test('500 random interior pixels equal the panorama sampled at apply(R, toSphere(flatToStrip(pixel))) within ±1', () => {
  const img = render(0);
  for (const { i, j, q } of interiorPixels(500, 1)) {
    const want = referenceColour(q);
    const got = pixel(img, i, j);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(got[c] - want[c]) <= 1, `pixel (${i}, ${j}) channel ${c}: ${got[c]} vs ${want[c].toFixed(2)}`);
    assert.equal(got[3], 255);
  }
});

test('previous-pixel guesses: mapper directions along 8 full rows equal guess-free flatToStrip within 1e-9', () => {
  const mapper = makePixelMapper(layout, geometry, { bleedR: 0 });
  const out = new Float64Array(3);
  let checked = 0;
  for (const j of [300, 520, 600, 1500, 2600, 3500, 3640, 3900]) {
    for (let i = 0; i < SW; i++) {
      const alpha = mapper.map(i + 0.5, j + 0.5, out);
      if (alpha === 0) continue;
      const k = mapper.guide.piece[mapper.guide.cellIndex(i + 0.5, j + 0.5)];
      const r = reference(k, i + 0.5, j + 0.5);
      assert.ok(r, `pixel (${i}, ${j}) has alpha ${alpha} but no guess-free preimage`);
      const err = Math.hypot(out[0] - r.q[0], out[1] - r.q[1], out[2] - r.q[2]);
      assert.ok(err < 1e-9, `pixel (${i}, ${j}): direction differs by ${err}`);
      checked++;
    }
  }
  assert.ok(checked > 2000, `only ${checked} pixels checked`);
});

test('not mirrored: det ∂(u,v)/∂(x,y) > 0 at 200 random interior pixels', () => {
  const mapper = makePixelMapper(layout, geometry, { bleedR: 0 });
  const W = pano.width;
  const uvAt = (x, y) => {
    const out = new Float64Array(3);
    assert.equal(mapper.map(x, y, out), 1);
    return directionToEquirect(apply(R0, out), W, pano.height);
  };
  const h = 0.5;
  const wrapDu = (du) => ((((du + W / 2) % W) + W) % W) - W / 2;
  for (const { i, j } of interiorPixels(200, 2)) {
    const x = i + 0.5;
    const y = j + 0.5;
    const [ux0, vx0] = uvAt(x - h, y);
    const [ux1, vx1] = uvAt(x + h, y);
    const [uy0, vy0] = uvAt(x, y - h);
    const [uy1, vy1] = uvAt(x, y + h);
    const det = wrapDu(ux1 - ux0) * (vy1 - vy0) - wrapDu(uy1 - uy0) * (vx1 - vx0);
    assert.ok(det > 0, `pixel (${i}, ${j}): det ${det}`);
  }
});

test('longitude wrap: sampleEquirect at u = W − 0.25 is the 25/75 blend of the last and first columns', () => {
  const { width: W, data } = pano;
  const out = [0, 0, 0];
  for (const row of [0, 100, 511]) {
    sampleEquirect(pano, W - 0.25, row + 0.5, out);
    for (let c = 0; c < 3; c++) {
      const last = data[(row * W + W - 1) * 4 + c];
      const first = data[row * W * 4 + c];
      // u = W − 0.25 is 0.25 px past the last column's centre (W − 0.5), towards the first's (W + 0.5).
      assert.ok(Math.abs(out[c] - (0.75 * last + 0.25 * first)) < 1e-9, `row ${row} channel ${c}`);
    }
    const again = [0, 0, 0];
    sampleEquirect(pano, -0.25, row + 0.5, again); // the same point one turn earlier
    assert.deepEqual(again.map((x) => x.toFixed(9)), out.map((x) => x.toFixed(9)));
  }
  // v is clamped to the outermost pixel centres: above the top row samples the top row.
  const top = [0, 0, 0];
  sampleEquirect(pano, 10.5, 0, top);
  assert.deepEqual(top, Array.from(data.subarray(40, 43)));
});

test('pole tips: every pixel within 20 px of each piece tip has a finite colour and is never (0,0,0)', () => {
  const img = render(0);
  const mapper = makePixelMapper(layout, geometry, { bleedR: 0 });
  const out = new Float64Array(3);
  const tips = [unrolling.flatFrame(0).c, unrolling.flatFrame(unrolling.length).c];
  let painted = 0;
  for (const piece of layout.pieces) {
    for (const [tx, ty] of transformPts(tips, piece.affine)) {
      for (let j = Math.floor(ty - 20); j <= Math.ceil(ty + 20); j++) {
        for (let i = Math.floor(tx - 20); i <= Math.ceil(tx + 20); i++) {
          if (Math.hypot(i + 0.5 - tx, j + 0.5 - ty) > 20) continue;
          const px = pixel(img, i, j);
          assert.ok(px[0] || px[1] || px[2], `black pixel (${i}, ${j}) near a tip`);
          const alpha = mapper.map(i + 0.5, j + 0.5, out);
          assert.ok(Number.isFinite(alpha));
          if (alpha > 0) {
            assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-9, `pixel (${i}, ${j}) direction ${out}`);
            painted++;
          }
        }
      }
    }
  }
  assert.ok(painted > 1000, `only ${painted} tip pixels painted`);
});

test('no bleed: pixels 1 px outside the edge untouched; pixels 1 px inside fully opaque', () => {
  const img = render(0);
  const outside = pixelsAtEdgeDistance(1, 1.6);
  const inside = pixelsAtEdgeDistance(-1.6, -1);
  assert.ok(outside.length > 400 && inside.length > 400, `${outside.length} outside, ${inside.length} inside`);
  for (const { i, j, dist } of outside) assert.ok(untouched(img, i, j), `pixel (${i}, ${j}) ${dist.toFixed(2)} px outside: ${pixel(img, i, j)}`);
  for (const { i, j, k, dist } of inside) {
    const got = pixel(img, i, j);
    const want = referenceColour(reference(k, i + 0.5, j + 0.5).q);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(got[c] - want[c]) <= 1, `pixel (${i}, ${j}) ${dist.toFixed(2)} px inside: ${got} vs ${want}`);
  }
});

test('bleedR 0.03: pixels 0.02 R outside the edge painted; pixels 0.04 R outside untouched', () => {
  const img = render(0.03);
  const near = pixelsAtEdgeDistance(0.02 * pxPerR - 0.5, 0.02 * pxPerR + 0.5);
  const far = pixelsAtEdgeDistance(0.04 * pxPerR - 0.5, 0.04 * pxPerR + 0.5);
  assert.ok(near.length > 400 && far.length > 400, `${near.length} near, ${far.length} far`);
  for (const { i, j } of near) assert.equal(pixel(img, i, j)[3], 255, `pixel (${i}, ${j}) 0.02 R outside not painted`);
  for (const { i, j } of near) assert.ok(!untouched(img, i, j), `pixel (${i}, ${j}) 0.02 R outside not painted`);
  for (const { i, j } of far) assert.ok(untouched(img, i, j), `pixel (${i}, ${j}) 0.04 R outside painted: ${pixel(img, i, j)}`);
});

test(`bleedR is clamped to MAX_BLEED_R (${MAX_BLEED_R} R) with a warning`, () => {
  const mapper = makePixelMapper(layout, geometry, { bleedR: 0.05 });
  assert.equal(mapper.bleedR, MAX_BLEED_R);
  assert.equal(mapper.warnings.length, 1);
  assert.equal(makePixelMapper(layout, geometry, { bleedR: 0.02 }).warnings.length, 0);
});

for (const bleedR of [0, 0.03]) {
  test(`guide (bleedR ${bleedR}): every pixel of the empty cells next to the pieces has alpha 0`, () => {
    const mapper = makePixelMapper(layout, geometry, { bleedR });
    const { guide } = mapper;
    const { cols, rows, cellPx } = guide;
    const out = new Float64Array(3);
    let checked = 0;
    for (let b = 0; b < rows; b++) {
      for (let a = 0; a < cols; a++) {
        if (guide.piece[b * cols + a] !== -1) continue;
        let ring = false;
        for (let bb = Math.max(0, b - 1); bb <= Math.min(rows - 1, b + 1); bb++) {
          for (let aa = Math.max(0, a - 1); aa <= Math.min(cols - 1, a + 1); aa++) ring ||= guide.piece[bb * cols + aa] !== -1;
        }
        if (!ring) continue;
        for (let j = b * cellPx; j < Math.min(SH, (b + 1) * cellPx); j++) {
          for (let i = a * cellPx; i < Math.min(SW, (a + 1) * cellPx); i++) {
            for (let k = 0; k < layout.pieces.length; k++) {
              assert.equal(mapper.mapPiece(k, i + 0.5, j + 0.5, out), 0, `pixel (${i}, ${j}) in an empty cell`);
            }
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 100000, `only ${checked} pixels checked`);
  });
}

test('a cell two pieces reach (−2) maps each pixel through the piece that covers it most', () => {
  // A band-1 copy stacked on the band-0 piece: every non-empty cell is shared. Both cover
  // interior pixels fully, and on a tie the first piece (band 0, rotZ(0)) wins.
  const stacked = { ...layout, pieces: [layout.pieces[1], { band: 1, affine: layout.pieces[1].affine }] };
  const mapper = makePixelMapper(stacked, geometry, { bleedR: 0 });
  assert.ok(mapper.guide.piece.every((p) => p === -1 || p === -2));
  const out = new Float64Array(3);
  const band0 = interiorPixels(40, 4).filter((p) => p.k === 1); // layout.pieces[1] is band 0
  assert.ok(band0.length > 5);
  for (const { i, j, k, q } of band0) {
    assert.equal(mapper.map(i + 0.5, j + 0.5, out), 1);
    assert.ok(Math.hypot(out[0] - q[0], out[1] - q[1], out[2] - q[2]) < 1e-9, `pixel (${i}, ${j}) piece ${k}`);
  }
});

test('orientation: render with yaw 37 equals a yaw-0 render of P′, where P′(lon) = P(lon + 37°) (column shift), on 200 pixels within ±2', () => {
  // W = 1440 makes 37° exactly 148 columns.
  const P = gradientPanorama(1440, 720);
  const shift = 148;
  const Pshift = createImage(P.width, P.height);
  for (let j = 0; j < P.height; j++) {
    for (let i = 0; i < P.width; i++) {
      const from = (j * P.width + ((i + shift) % P.width)) * 4;
      Pshift.data.set(P.data.subarray(from, from + 4), (j * P.width + i) * 4);
    }
  }
  const rows = [1800, 2300];
  const a = createImage(SW, SH, WHITE);
  const b = createImage(SW, SH, WHITE);
  renderPieces(a, layout, geometry, P, totalRotation(model, { yaw: 37, pitch: 0, roll: 0 }), { rows });
  renderPieces(b, layout, geometry, Pshift, R0, { rows });
  const rand = rng(3);
  let compared = 0;
  while (compared < 200) {
    const i = Math.floor(rand() * SW);
    const j = rows[0] + Math.floor(rand() * (rows[1] - rows[0]));
    const pa = pixel(a, i, j);
    if (pa[3] !== 255 || untouched(a, i, j)) continue;
    const pb = pixel(b, i, j);
    for (let c = 0; c < 4; c++) assert.ok(Math.abs(pa[c] - pb[c]) <= 2, `pixel (${i}, ${j}): ${pa} vs ${pb}`);
    compared++;
  }
});

test('rows option: rendering in 4 row bands equals one full render byte-for-byte', () => {
  const full = render(0);
  const banded = createImage(SW, SH, WHITE);
  for (const rows of [[0, 900], [900, 2080], [2080, 3001], [3001, SH]]) renderPieces(banded, layout, geometry, pano, R0, { rows });
  assert.ok(Buffer.from(banded.data.buffer).equals(Buffer.from(full.data.buffer)));
});
