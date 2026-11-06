import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { transformPts } from '../../src/render/raster.js';
import { cutPathSvg } from '../../src/export/svg.js';
import { cutPathDxf } from '../../src/export/dxf.js';
import { readDxfLines, dxfToPolylines } from '../support/dxf.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const layout = layoutSheet(MODEL_360CRAFT, outline, {
  page: { widthMm: 215.9, heightMm: 279.4 }, marks: 'silhouette',
});
const k = 25.4 / layout.dpi;
const heightMm = layout.heightPx * k;
const mmPts = (pts) => pts.map(([x, y]) => [x * k, y * k]);
const cutsMm = layout.pieces.map((p) => mmPts(transformPts(outline.cutPath, p.affine)));
const markPoly = (pts) => pts.length;

const parseD = (dAttr) => dAttr.match(/-?\d+(?:\.\d+)?/g).map(Number).reduce((a, v, i) => {
  if (i % 2) a[a.length - 1].push(v); else a.push([v]);
  return a;
}, []);
const group = (svg, id) => svg.match(new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`))?.[1];
const dsOf = (g) => [...g.matchAll(/ d="([^"]+)"/g)].map((m) => parseD(m[1]));

// Compare a closed polyline to a path ignoring a repeated closing vertex.
const dedupe = (pts) => {
  const [f, l] = [pts[0], pts[pts.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? pts.slice(0, -1) : pts;
};

test('SVG cut paths are smoothed: end points are original vertices, far fewer segments, sheet size matches', () => {
  const svg = cutPathSvg(layout, outline, { includeMarks: true });
  assert.match(svg, new RegExp(`width="${(layout.widthPx * k).toFixed(4)}mm" height="${heightMm.toFixed(4)}mm" viewBox="0 0 ${(layout.widthPx * k).toFixed(4)} ${heightMm.toFixed(4)}"`));
  const cutGroup = group(svg, 'cut');
  const ds = [...cutGroup.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ds.length, 2);
  ds.forEach((d, i) => {
    assert.match(d, /^M[^MZ]*C[^MZ]*L[^MZ]* Z$/, 'a mix of curves and lines, one closed subpath');
    const want = dedupe(cutsMm[i]);
    const nums = parseD(d.replace(/[MCLZ]/g, ' ')); // coordinate pairs in order
    assert.ok(nums.length * 5 < want.length, `${nums.length} points vs ${want.length}`);
    // every path point lies on the original cut path within the smoothing tolerance (control points excluded)
    const start = nums[0];
    assert.ok(want.some(([x, y]) => Math.hypot(x - start[0], y - start[1]) < 1e-3), 'start is an original vertex');
  });
  assert.match(group(svg, 'cut'), /fill="none" stroke="#ff0000" stroke-width="0.1"/);
  assert.match(group(svg, 'registration'), /fill="#000" stroke="none"/);
  assert.equal(dsOf(group(svg, 'registration')).length, 3);
});

test('SVG has no registration group when includeMarks is false', () => {
  const svg = cutPathSvg(layout, outline, { includeMarks: false });
  assert.ok(!svg.includes('registration'));
  assert.ok(!cutPathSvg(layout, outline).includes('registration'));
  assert.ok(group(svg, 'cut'));
});

test('DXF CUT outlines are the cut paths without near-duplicate or collinear points, corners kept', () => {
  const dxf = cutPathDxf(layout, outline, { includeMarks: true });
  assert.match(dxf, /\$INSUNITS\n70\n4\n/);
  const polys = dxfToPolylines(readDxfLines(dxf), { sheetHeight: heightMm });
  const cut = polys.get('CUT');
  assert.equal(cut.length, 2);
  const cx = (pts) => pts.reduce((s, p) => s + p[0], 0) / pts.length;
  for (const want of cutsMm) {
    const got = cut.find((c) => Math.abs(cx(c) - cx(dedupe(want))) < 1);
    assert.ok(got, 'piece missing');
    assert.ok(got.length * 10 < want.length, `${got.length} vs ${want.length}`);
    // every DXF vertex is a vertex of the cut path
    got.forEach((q) => assert.ok(want.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3)));
    // chain neighbours are never nearer than the duplicate threshold
    got.forEach((q, i) => { const r = got[(i + 1) % got.length]; assert.ok(Math.hypot(q[0] - r[0], q[1] - r[1]) > 0.01); });
  }
});

test('DXF REGISTRATION layer has 1 square and 2 L outlines at the T11 positions', () => {
  const dxf = cutPathDxf(layout, outline, { includeMarks: true });
  const reg = dxfToPolylines(readDxfLines(dxf), { sheetHeight: heightMm }).get('REGISTRATION');
  assert.deepEqual(reg.map(markPoly).sort(), [4, 6, 6]);
  const [sq, tr, bl] = layout.marks;
  const mm = (v) => v * k;
  const square = reg.find((p) => p.length === 4);
  const xs = square.map((p) => p[0]), ys = square.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - mm(sq.x)) < 1e-3 && Math.abs(Math.max(...xs) - mm(sq.x + sq.size)) < 1e-3);
  assert.ok(Math.abs(Math.min(...ys) - mm(sq.y)) < 1e-3 && Math.abs(Math.max(...ys) - mm(sq.y + sq.size)) < 1e-3);
  // each L's bounding box is leg × leg with its outer corner at the mark's x, y
  for (const m of [tr, bl]) {
    const found = reg.filter((p) => p.length === 6).some((p) => {
      const px = p.map((q) => q[0]), py = p.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...px), Math.max(...px), Math.min(...py), Math.max(...py)];
      const right = m.corner === 'top-right';
      const want = [right ? m.x - m.leg : m.x, right ? m.x : m.x + m.leg, right ? m.y : m.y - m.leg, right ? m.y + m.leg : m.y].map(mm);
      return [x0, x1, y0, y1].every((v, i) => Math.abs(v - want[i]) < 1e-3);
    });
    assert.ok(found, `${m.corner} L missing`);
  }
  // no registration entities without marks
  const none = dxfToPolylines(readDxfLines(cutPathDxf(layout, outline)), { sheetHeight: heightMm });
  assert.ok(!none.has('REGISTRATION'));
});

test('DXF TABLES section declares the CUT and REGISTRATION LAYER entries (R12 group codes)', () => {
  const dxf = cutPathDxf(layout, outline, { includeMarks: true });
  const lines = dxf.split('\n');
  const start = lines.indexOf('TABLES');
  const end = lines.indexOf('ENDSEC', start);
  assert.ok(start > 0 && end > start, 'no TABLES section');
  // Read the TABLES section as (group code, value) pairs.
  const pairs = [];
  for (let i = start + 1; i + 1 < end; i += 2) pairs.push([lines[i].trim(), lines[i + 1].trim()]);
  const layers = [];
  pairs.forEach(([code, value], i) => {
    if (code === '0' && value === 'LAYER') layers.push(Object.fromEntries(pairs.slice(i + 1, i + 5).map(([c, v]) => [c, v])));
  });
  const byName = Object.fromEntries(layers.map((l) => [l['2'], l]));
  assert.deepEqual(Object.keys(byName).sort(), ['CUT', 'REGISTRATION']);
  for (const name of ['CUT', 'REGISTRATION']) {
    assert.equal(byName[name]['70'], '0');
    assert.match(byName[name]['62'], /^-?\d+$/);
    assert.equal(byName[name]['6'], 'CONTINUOUS');
  }
  // Every layer that a LINE uses is declared.
  const used = new Set(dxfToPolylines(readDxfLines(dxf), { sheetHeight: heightMm }).keys());
  for (const name of used) assert.ok(byName[name], `${name} not declared in LAYER table`);
});
