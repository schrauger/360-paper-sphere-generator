import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { transformPts } from '../../src/render/raster.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const LETTER = { widthMm: 215.9, heightMm: 279.4 };
const A3 = { widthMm: 297, heightMm: 420 };
const lay = (opts) => layoutSheet(MODEL_360CRAFT, outline, { page: LETTER, ...opts });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const cutPoints = (l) => l.pieces.flatMap((p) => transformPts(outline.cutPath, p.affine));

test('letter at 300 dpi → 2550×3300 px; 72 dpi → 612×792', () => {
  const a = lay({});
  assert.deepEqual([a.widthPx, a.heightPx, a.dpi], [2550, 3300, 300]);
  const b = lay({ dpi: 72 });
  assert.deepEqual([b.widthPx, b.heightPx], [612, 792]);
  assert.deepEqual(a.marks, []);
  assert.deepEqual(a.pieces.map((p) => p.band), [1, 0]);
});

test('silhouette marks at exact px', () => {
  const dpi = 300;
  const mm = (v) => (v / 25.4) * dpi;
  const l = lay({ marks: 'silhouette', dpi });
  const [sq, tr, bl] = l.marks;
  assert.deepEqual(sq, { type: 'square', x: mm(9.74), y: mm(9.74), size: mm(5.5) });
  assert.deepEqual(tr, { type: 'corner', corner: 'top-right', x: mm(215.9 - 22.44), y: mm(9.74), leg: mm(10), stroke: mm(0.5) });
  assert.deepEqual(bl, { type: 'corner', corner: 'bottom-left', x: mm(9.74), y: mm(279.4 - 35.14), leg: mm(10), stroke: mm(0.5) });
  assert.equal(l.marks.length, 3);
});

const boxesOf = (l) => {
  const [sq, tr, bl] = l.marks;
  return [
    [sq.x, sq.y, sq.x + sq.size, sq.y + sq.size],
    [tr.x - tr.leg, tr.y, tr.x, tr.y + tr.leg],
    [bl.x, bl.y - bl.leg, bl.x + bl.leg, bl.y],
  ];
};
const violates = (l, rect) => {
  const gap = (3 / 25.4) * l.dpi - 1e-6;
  const boxes = boxesOf(l);
  return cutPoints(l).some(([x, y]) => x < rect[0] - 1e-6 || x > rect[2] + 1e-6 || y < rect[1] - 1e-6 || y > rect[3] + 1e-6
    || boxes.some(([x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) < gap));
};

test('page fit: every cut-path point inside the content rect and ≥ 3 mm from each mark box', () => {
  for (const page of [LETTER, A3, { widthMm: 210, heightMm: 297 }]) {
    const l = layoutSheet(MODEL_360CRAFT, outline, { page, marks: 'silhouette' });
    const mm = (v) => (v / 25.4) * 300;
    const rect = [mm(9.74), mm(9.74), mm(page.widthMm - 22.44), mm(page.heightMm - 35.14)];
    assert.equal(violates(l, rect), false);
  }
  // without marks: inside the margin
  const n = lay({});
  const m = (6.35 / 25.4) * 300;
  assert.ok(cutPoints(n).every(([x, y]) => x >= m - 1e-6 && y >= m - 1e-6 && x <= n.widthPx - m + 1e-6 && y <= n.heightPx - m + 1e-6));
});

test('page fit is maximal: pxPerR × 1.01 violates a constraint', () => {
  for (const marks of ['silhouette', 'none']) {
    const l = lay({ marks });
    const mm = (v) => (v / 25.4) * 300;
    const rect = marks === 'none'
      ? [mm(6.35), mm(6.35), l.widthPx - mm(6.35), l.heightPx - mm(6.35)]
      : [mm(9.74), mm(9.74), mm(215.9 - 22.44), mm(279.4 - 35.14)];
    const f = 1.01;
    const grown = {
      ...l,
      pieces: l.pieces.map((p) => ({ ...p, affine: p.affine.map((v, i) => (i < 4 ? v * f : v)) })),
    };
    // re-centre the grown arrangement on the old centre
    const pts = cutPoints(grown);
    const old = cutPoints(l);
    const c = (ps) => [(Math.min(...ps.map((q) => q[0])) + Math.max(...ps.map((q) => q[0]))) / 2, (Math.min(...ps.map((q) => q[1])) + Math.max(...ps.map((q) => q[1]))) / 2];
    const [cx, cy] = c(pts);
    const [ox, oy] = c(old);
    grown.pieces = grown.pieces.map((p) => ({ ...p, affine: [...p.affine.slice(0, 4), p.affine[4] + ox - cx, p.affine[5] + oy - cy] }));
    const gap = (3 / 25.4) * 300;
    const boxes = marks === 'silhouette' ? boxesOf(l) : [];
    const bad = cutPoints(grown).some(([x, y]) => x < rect[0] || x > rect[2] || y < rect[1] || y > rect[3]
      || boxes.some(([x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) < gap));
    assert.ok(bad, marks);
  }
});

test('diameterMm 100 at 300 dpi → pxPerR = 590.55…; reported diameterMm = 100', () => {
  // the two-piece arrangement is ≈ 3.4 sphere diameters tall: 100 mm needs more than letter or A3 give,
  // so the sheet is enlarged (warning); 90 mm fits A3 as is
  const l = layoutSheet(MODEL_360CRAFT, outline, { page: { widthMm: 400, heightMm: 500 }, diameterMm: 100 });
  near(l.pxPerR, (50 / 25.4) * 300, 1e-9);
  near(l.diameterMm, 100, 1e-9);
  assert.deepEqual(l.warnings, []);
  assert.deepEqual([l.widthPx, l.heightPx], [4724, 5906]);
  const a3 = layoutSheet(MODEL_360CRAFT, outline, { page: A3, diameterMm: 90 });
  near(a3.diameterMm, 90, 1e-9);
  assert.deepEqual(a3.warnings, []);
  assert.deepEqual([a3.widthPx, a3.heightPx], [3508, 4961]);
});

test('diameterMm 400 on letter → warning "does not fit" and an enlarged sheet', () => {
  const l = lay({ diameterMm: 400, dpi: 150 });
  assert.equal(l.warnings.length, 1);
  assert.match(l.warnings[0], /^Sphere of 400 mm does not fit on 215\.9×279\.4 mm; sheet enlarged to \d+(\.\d)?×\d+(\.\d)? mm$/);
  assert.ok(l.widthPx > 1275 && l.heightPx > 1650);
  const pts = cutPoints(l);
  assert.ok(pts.every(([x, y]) => x >= 0 && y >= 0 && x <= l.widthPx && y <= l.heightPx));
  const m = layoutSheet(MODEL_360CRAFT, outline, { page: LETTER, diameterMm: 400, marks: 'silhouette', dpi: 150 });
  assert.ok(m.warnings[0].includes('enlarged'));
  const mm = (v) => (v / 25.4) * 150;
  assert.equal(violates(m, [mm(9.74), mm(9.74), m.widthPx - mm(22.44), m.heightPx - mm(35.14)]), false);
});

test('a diameter under 30 mm warns', () => {
  assert.deepEqual(lay({ diameterMm: 20 }).warnings, ['Sphere diameter 20 mm is very small to assemble']);
  assert.deepEqual(lay({ diameterMm: 30 }).warnings, []);
});

test('page 30×30 mm with marks → RangeError "Page too small for registration marks"', () => {
  assert.throws(() => layoutSheet(MODEL_360CRAFT, outline, { page: { widthMm: 30, heightMm: 30 }, marks: 'silhouette' }), (e) => e instanceof RangeError && e.message === 'Page too small for registration marks');
  assert.throws(() => layoutSheet(MODEL_360CRAFT, outline, { page: { widthMm: 10, heightMm: 10 } }), RangeError);
});

test('dpi 50 and 1500 → RangeError; large sheets pass or throw at 2.5e8 px', () => {
  for (const dpi of [50, 1500]) {
    assert.throws(() => lay({ dpi }), (e) => e instanceof RangeError && e.message === 'DPI must be between 72 and 1200');
  }
  // a3 at 1200 dpi is 14031×19843 = 278 megapixels, over the limit; 1100 dpi (233 MP) passes
  assert.throws(() => layoutSheet(MODEL_360CRAFT, outline, { page: A3, dpi: 1200 }), (e) => e instanceof RangeError && /^Sheet too large \(278 megapixels\); lower the DPI$/.test(e.message));
  const ok = layoutSheet(MODEL_360CRAFT, outline, { page: A3, dpi: 1100 });
  assert.equal(ok.widthPx, 12862);
  // an enlarged sheet is checked too
  assert.throws(() => layoutSheet(MODEL_360CRAFT, outline, { page: A3, dpi: 1100, diameterMm: 5000 }), /Sheet too large/);
});
