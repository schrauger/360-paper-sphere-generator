import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { transformPts } from '../../src/render/raster.js';
import { COPY_GAP_MM } from '../../src/layout/pack.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const LETTER = { widthMm: 215.9, heightMm: 279.4 };
const DPI = 100;
const mmPerPx = 25.4 / DPI;
const lay = (opts) => layoutSheet(MODEL_360CRAFT, outline, { page: LETTER, dpi: DPI, ...opts });
// Cut path of each piece in mm.
const cutsMm = (l) => l.pieces.map((p) => transformPts(outline.cutPath, p.affine).map(([x, y]) => [x * mmPerPx, y * mmPerPx]));

const segDist = (p, a, b) => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
};
const minGap = (A, B) => {
  let m = Infinity;
  for (let i = 0; i < A.length; i += 4) {
    for (let j = 0; j < B.length; j++) m = Math.min(m, segDist(A[i], B[j], B[(j + 1) % B.length]));
  }
  return m;
};

const EXPECTED = { 40: 2, 45: 2, 50: 1, 55: 1, 60: 1, 62: 1 };

for (const [d, n] of Object.entries(EXPECTED)) {
  test(`letter + silhouette ${d} mm holds ${n} pair(s), all inside the rect, clear of marks and each other`, () => {
    const l = lay({ marks: 'silhouette', diameterMm: Number(d) });
    assert.equal(l.copies, n);
    assert.equal(l.pieces.length, 2 * n);
    assert.deepEqual(l.warnings, []);
    const cuts = cutsMm(l);
    const [sq, tr, bl] = l.marks;
    const boxes = [
      [sq.x, sq.y, sq.x + sq.size, sq.y + sq.size],
      [tr.x - tr.leg, tr.y, tr.x, tr.y + tr.leg],
      [bl.x, bl.y - bl.leg, bl.x + bl.leg, bl.y],
    ].map((b) => b.map((v) => v * mmPerPx));
    for (const [x, y] of cuts.flat()) {
      assert.ok(x >= 10 - 1e-6 && x <= LETTER.widthMm - 10 + 1e-6 && y >= 10 - 1e-6 && y <= LETTER.heightMm - 10 + 1e-6, `(${x}, ${y}) outside`);
      for (const [x0, y0, x1, y1] of boxes) {
        assert.ok(Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) >= 3 - 1e-6, `(${x}, ${y}) too near a mark`);
      }
    }
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (const i of [0, 1]) for (const j of [0, 1]) {
          assert.ok(minGap(cuts[2 * a + i], cuts[2 * b + j]) >= COPY_GAP_MM - 1e-6, `copies ${a} and ${b} too close`);
        }
      }
    }
    // One more would not fit: asking for it enlarges the sheet.
    const more = lay({ marks: 'silhouette', diameterMm: Number(d), copies: n + 1 });
    assert.match(more.warnings[0], /do not fit|does not fit/);
  });
}

test('letter without marks: 40 mm holds 2, 50 mm holds 1', () => {
  assert.equal(lay({ diameterMm: 40 }).copies, 2);
  assert.equal(lay({ diameterMm: 50 }).copies, 1);
});

test('the pair of each copy has the same bands; the turned pair is packed when it holds more', () => {
  const l = lay({ marks: 'silhouette', diameterMm: 40 });
  assert.deepEqual(l.pieces.map((p) => p.band), [1, 0, 1, 0]);
  // 40 mm on letter packs the pair turned 90°: each copy is wider than tall.
  const xs = cutsMm(l).slice(0, 2).flat();
  const ext = (k) => Math.max(...xs.map((p) => p[k])) - Math.min(...xs.map((p) => p[k]));
  assert.ok(ext(0) > ext(1));
});

test('copies: 1 is the classic single pair, centred; without a diameter copies is 1', () => {
  const one = lay({ marks: 'silhouette', diameterMm: 40, copies: 1 });
  assert.equal(one.copies, 1);
  assert.equal(one.pieces.length, 2);
  assert.equal(lay({ marks: 'silhouette' }).copies, 1);
  assert.equal(lay({ marks: 'silhouette', copies: 'max' }).copies, 1);
});

test('an exact count below the maximum uses that many', () => {
  const l = lay({ diameterMm: 30, copies: 3 });
  assert.equal(l.copies, 3);
  assert.deepEqual(l.warnings.filter((w) => /enlarged/.test(w)), []);
});

test('the layout is the same in mm at any dpi', () => {
  const ref = lay({ marks: 'silhouette', diameterMm: 40 });
  const hi = layoutSheet(MODEL_360CRAFT, outline, { page: LETTER, dpi: 300, diameterMm: 40, marks: 'silhouette' });
  const mm = (l) => l.pieces.map((p) => p.affine.map((v) => (v * 25.4) / l.dpi));
  mm(ref).forEach((aff, i) => aff.forEach((v, k) => assert.ok(Math.abs(v - mm(hi)[i][k]) < 1e-6)));
});

test('bad copies value is rejected', () => {
  assert.throws(() => lay({ diameterMm: 40, copies: 0 }), RangeError);
  assert.throws(() => lay({ diameterMm: 40, copies: 1.5 }), RangeError);
});
