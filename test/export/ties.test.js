import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { layoutInMm } from '../../src/export/pieces.js';
import { markOutlines } from '../../src/render/marks.js';
import { transformPts } from '../../src/render/raster.js';
import { smoothOpenPath, sampleSmoothPath, simplifyOpen, SMOOTH_TOLERANCE_MM } from '../../src/export/smooth.js';
import { TIE_WIDTH_MM, tabTips, tieRuns, tieWarnings } from '../../src/export/ties.js';
import { cutPathSvg } from '../../src/export/svg.js';
import { cutPathDxf } from '../../src/export/dxf.js';
import { readDxfLines } from '../support/dxf.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const layout = layoutSheet(MODEL_360CRAFT, outline, { page: { widthMm: 215.9, heightMm: 279.4 }, marks: 'silhouette' });
const { cuts } = layoutInMm(layout, outline, true, markOutlines);
const k = 25.4 / layout.dpi;
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const length = (pts) => pts.slice(1).reduce((s, p, i) => s + d(p, pts[i]), 0);
const perimeter = (pts) => length([...pts, pts[0]]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
// The tip of each tab per the tab polygons themselves: the last two polygon vertices (outer vertices, reversed).
const tabTipsOfOutline = (affine) => outline.tabs.map((poly) => {
  const [a, b] = transformPts(poly.slice(-2), affine).map(([x, y]) => [x * k, y * k]);
  return [a, b];
});

test('every tab has a tip edge, and the tips are the tab polygons\' outermost edges', () => {
  layout.pieces.forEach((piece, pi) => {
    const tips = tabTips(cuts[pi]);
    assert.equal(tips.length, outline.tabs.length);
    const want = tabTipsOfOutline(piece.affine).map(([a, b]) => mid(a, b));
    for (const [a, b] of tips) {
      const m = mid(a, b);
      assert.ok(want.some((w) => d(w, m) < 1e-6), 'tip is a tab polygon tip');
    }
  });
});

test('one tie per tab on every piece: chord, centre, and total length', () => {
  for (const [pi, cut] of cuts.entries()) {
    const runs = tieRuns(cut, TIE_WIDTH_MM);
    const tips = tabTips(cut);
    assert.equal(runs.length, tips.length, `piece ${pi}`);
    const full = perimeter(cut);
    let cutLength = 0;
    runs.forEach((run, i) => {
      const next = runs[(i + 1) % runs.length];
      const gapA = run[run.length - 1]; const gapB = next[0];
      assert.ok(Math.abs(d(gapA, gapB) - TIE_WIDTH_MM) < 0.01, 'gap chord');
      assert.ok(d(mid(gapA, gapB), mid(...tips[(i + 1) % tips.length])) < 0.05, 'gap centred on tip');
      cutLength += length(run);
    });
    assert.ok(Math.abs(cutLength - (full - runs.length * TIE_WIDTH_MM)) < 0.05, 'cut length = perimeter - gaps');
  }
});

// A square with extra points along each side (so its corners are not adjacent to the tab's) and `tab` on the bottom edge.
const withTab = (tab) => [[0, 0], [1, 0], [2, 0], ...tab, [8, 0], [9, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]];

test('a wider tie is clamped to the tip edge', () => {
  // A synthetic square with one five-corner tab whose tip edge is 2 mm long.
  const shape = [[3, 0], [3, -1], [5, -1], [5, -0.5], [5.5, 0]]; // A, O1, O2, O3, B: tip O1-O2 = 2 mm
  const path = withTab(shape);
  const runs = tieRuns(path, 3);
  const gap = d(runs[0][runs[0].length - 1], runs[0][0]);
  assert.ok(Math.abs(gap - 1.6) < 1e-9, `gap ${gap}`);
  assert.ok(tieWarnings(path, 3).includes('Ties narrowed to 1.60 mm to fit the tab tips'));
  assert.ok(!tieWarnings(path, 1).some((w) => /narrowed/.test(w)));
  assert.deepEqual(tieWarnings(cuts[0], TIE_WIDTH_MM), []);
});

test('a corner run that is not a five-corner tab is reported', () => {
  const four = withTab([[3, 0], [3, -1], [5, -1], [5, 0]]); // 4-corner flap
  assert.equal(tieRuns(four, 0.5), null);
  assert.deepEqual(tieWarnings(four, 0.5), ['5 tab(s) got no tie (unexpected corner shape)']);
});

test('a path without tabs has no ties', () => {
  assert.equal(tieRuns([[0, 0], [10, 0], [10, 10], [0, 10]], 0.5), null);
});

test('smoothOpenPath keeps the ends exact and stays within tolerance', () => {
  const run = tieRuns(cuts[0], TIE_WIDTH_MM)[3];
  const path = smoothOpenPath(run);
  assert.deepEqual(path.start, run[0]);
  assert.deepEqual(path.segs.at(-1).to, run.at(-1));
  const pts = sampleSmoothPath(path, 0.02);
  for (const p of run) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]; const b = pts[i];
      const dd = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dd[0] + (p[1] - a[1]) * dd[1]) / (dd[0] ** 2 + dd[1] ** 2 || 1)));
      best = Math.min(best, d(p, [a[0] + dd[0] * t, a[1] + dd[1] * t]));
    }
    assert.ok(best <= SMOOTH_TOLERANCE_MM + 1e-3, `vertex off by ${best}`);
  }
  const simple = simplifyOpen(run);
  assert.deepEqual(simple[0], run[0]);
  assert.deepEqual(simple.at(-1), run.at(-1));
  assert.ok(simple.length <= run.length);
});

test('SVG with ties: open subpaths, one per tab, no Z; without ties unchanged', () => {
  const plain = cutPathSvg(layout, outline, { includeMarks: true });
  assert.equal(cutPathSvg(layout, outline, { includeMarks: true, tieMm: null }), plain);
  const svg = cutPathSvg(layout, outline, { includeMarks: true, tieMm: TIE_WIDTH_MM });
  const cutG = /<g id="cut">([\s\S]*?)<\/g>/.exec(svg)[1];
  const ds = [...cutG.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ds.length, layout.pieces.length);
  for (const dd of ds) {
    assert.ok(!dd.includes('Z'));
    assert.equal(dd.split('M').length - 1, 50);
  }
  assert.equal(/<g id="registration">[\s\S]*<\/g>/.exec(svg)[0], /<g id="registration">[\s\S]*<\/g>/.exec(plain)[0]);
});

test('DXF with ties: the cut lines leave a gap per tab; marks and no-tie output unchanged', () => {
  const plain = cutPathDxf(layout, outline, { includeMarks: true });
  assert.equal(cutPathDxf(layout, outline, { includeMarks: true, tieMm: null }), plain);
  const dxf = cutPathDxf(layout, outline, { includeMarks: true, tieMm: TIE_WIDTH_MM });
  const cut = readDxfLines(dxf).filter((l) => l.layer === 'CUT');
  const before = readDxfLines(plain).filter((l) => l.layer === 'CUT');
  const lenOf = (ls) => ls.reduce((s, l) => s + Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0);
  const gaps = 50 * layout.pieces.length * TIE_WIDTH_MM;
  assert.ok(Math.abs(lenOf(before) - lenOf(cut) - gaps) < 0.02 * layout.pieces.length * 50 + 1, 'length drops by the gaps');
  assert.equal(readDxfLines(dxf).filter((l) => l.layer === 'REGISTRATION').length, readDxfLines(plain).filter((l) => l.layer === 'REGISTRATION').length);
});
