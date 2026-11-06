// Measure 360craft's glue tabs from the recovered outline.dxf and the fitted model (T7).
//
// A DXF vertex more than 3 px from the model seam is a tab vertex (ruling R21: the model's
// tip-curl bulge reaches 2.2 px, so a 2 px cut would turn bulge vertices into tabs). Contiguous
// runs of tab vertices are one tab each; the seam vertex before and after the run are its base.
// For each tab the tool measures the base position σ on the sphere seam (= the centre line's arc
// length s) and in the flat (arc length along the flat seam), the base length, and the outer
// vertices in the tab's own frame: x along the base chord from its start, y along the outward
// normal. It then fits pitch/start for both `along` choices and prints the residuals.
//
// Usage: node tools/research/measure-tabs.mjs
import { existsSync, readFileSync } from 'node:fs';
import { MODEL_360CRAFT, pieceAffine } from '../../src/model/360craft.js';
import { makeSpiral } from '../../src/sphere/spiral.js';
import { makeCentreLine } from '../../src/sphere/band.js';
import { makeUnrolling } from '../../src/sphere/develop.js';
import { loadManifest } from '../../test/support/fixtures.js';
import { dxfToPolylines, readDxfLines } from '../../test/support/dxf.js';
import { makePolylineIndex } from './lib/polyline-distance.mjs';

const TAB_PX = 3; // ruling R21
const STEP = 0.002; // seam sampling (R)
const TIP_SKIP = 1.5; // R: tabs whose base is this close to a tip are left out of the shape average
const LAYERS = ['MyLines1', 'MyLines2']; // pieces[0], pieces[1]

const manifest = loadManifest();
if (!manifest || !existsSync(manifest.dxfPath)) throw new Error('photo examples/ not present (local-only reference data, see ADR-0002)');
const { layoutLow, spiral: spiralCfg } = MODEL_360CRAFT;
const { pxPerR } = layoutLow;
const spiral = makeSpiral(spiralCfg);
const unrolling = makeUnrolling(spiral, makeCentreLine(spiral));
const L = unrolling.length;
const seams = unrolling.seams(STEP);
const dxf = dxfToPolylines(readDxfLines(readFileSync(manifest.dxfPath, 'utf8')), { sheetHeight: layoutLow.heightPx });

// Per seam side: polyline, arc length on the sphere (s) and in the flat, and a distance index.
const sides = [
  { name: 'pos', sign: 1, pts: seams.pos },
  { name: 'neg', sign: -1, pts: seams.neg },
].map((side) => {
  const sphere = side.pts.map((_, i) => Math.min(i * STEP, L));
  const flat = [0];
  for (let i = 1; i < side.pts.length; i++) flat.push(flat[i - 1] + Math.hypot(side.pts[i][0] - side.pts[i - 1][0], side.pts[i][1] - side.pts[i - 1][1]));
  return { ...side, sphere, flat, index: makePolylineIndex(side.pts, { closed: false, cell: 0.05 }) };
});
console.log(`seam length: sphere ${L.toFixed(4)} R, flat ${sides[0].flat.at(-1).toFixed(4)} R (pos), ${sides[1].flat.at(-1).toFixed(4)} R (neg)`);

function invertAffine([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return ([x, y]) => [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
}
const lerp = (arr, seg, t) => arr[seg] + (arr[seg + 1] - arr[seg]) * t;
const seamPoint = (side, seg, t) => [lerp(side.pts.map((p) => p[0]), seg, t), lerp(side.pts.map((p) => p[1]), seg, t)];

// Closest seam foot of a flat point.
function foot(p) {
  let best = null;
  for (const side of sides) {
    const r = side.index.nearest(p[0], p[1], 0.5);
    if (!best || r.dist < best.dist) best = { ...r, side };
  }
  const { side, seg, t } = best;
  const a = side.pts[seg];
  const b = side.pts[seg + 1];
  return {
    side,
    dist: best.dist,
    sphere: lerp(side.sphere, seg, t),
    flat: lerp(side.flat, seg, t),
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  };
}

const tabs = [];
LAYERS.forEach((layer, piece) => {
  const toFlat = invertAffine(pieceAffine(layoutLow.pieces[piece], pxPerR));
  const verts = dxf.get(layer)[0].map(toFlat);
  const info = verts.map((p) => ({ p, ...foot(p) }));
  for (let i = 1; i < info.length - 1; i++) {
    if (info[i].dist * pxPerR <= TAB_PX || info[i - 1].dist * pxPerR > TAB_PX) continue;
    let j = i;
    while (j + 1 < info.length && info[j + 1].dist * pxPerR > TAB_PX) j++;
    const A = info[i - 1];
    const B = info[j + 1];
    if (A.side !== B.side || j + 1 >= info.length - 1) continue; // runs at the polyline ends: not tabs
    const chord = Math.hypot(B.point[0] - A.point[0], B.point[1] - A.point[1]);
    const t = [(B.point[0] - A.point[0]) / chord, (B.point[1] - A.point[1]) / chord];
    // The outline runs pos forward then neg backward, so outward is on the left of A→B for both
    // (checked below: all heights positive).
    const outer = [];
    for (let k = i; k <= j; k++) {
      const q = [info[k].p[0] - A.point[0], info[k].p[1] - A.point[1]];
      outer.push({ x: q[0] * t[0] + q[1] * t[1], y: -q[0] * t[1] + q[1] * t[0] });
    }
    const lo = (key) => Math.min(A[key], B[key]);
    const hi = (key) => Math.max(A[key], B[key]);
    tabs.push({
      piece,
      side: A.side.name,
      chord,
      outer,
      sphere: { lo: lo('sphere'), len: hi('sphere') - lo('sphere') },
      flat: { lo: lo('flat'), len: hi('flat') - lo('flat') },
    });
  }
});

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const sd = (v) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const px = (r) => (r * pxPerR).toFixed(2);

console.log(`\n${tabs.length} tabs: ${['pos', 'neg'].map((s) => `${s} ${tabs.filter((t) => t.side === s).length}`).join(', ')}`);
console.log(`outer vertices per tab: ${[...new Set(tabs.map((t) => t.outer.length))].join(', ')}`);
if (tabs.some((t) => t.outer.some((v) => v.y <= 0))) console.log('WARNING: a tab vertex is on the inside of A→B');

// ---- σ fit for both `along` choices ----------------------------------------------------------
function fitAlong(key) {
  const rows = tabs.map((t) => ({ side: t.side, piece: t.piece, sigma: t[key].lo, len: t[key].len }));
  // Initial pitch: median spacing of one group.
  const grp = rows.filter((r) => r.side === 'pos' && r.piece === 0).map((r) => r.sigma).sort((a, b) => a - b);
  const gaps = grp.slice(1).map((v, i) => v - grp[i]).sort((a, b) => a - b);
  let pitch = gaps[Math.floor(gaps.length / 2)];
  const start = { pos: grp[0], neg: Math.min(...rows.filter((r) => r.side === 'neg').map((r) => r.sigma)) };
  for (const r of rows) r.k = Math.round((r.sigma - start[r.side]) / pitch);
  // Least squares: sigma = start[side] + k·pitch, over unknowns (startPos, startNeg, pitch).
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [0, 0, 0];
  for (const r of rows) {
    const a = [r.side === 'pos' ? 1 : 0, r.side === 'neg' ? 1 : 0, r.k];
    for (let i = 0; i < 3; i++) {
      atb[i] += a[i] * r.sigma;
      for (let j = 0; j < 3; j++) ata[i][j] += a[i] * a[j];
    }
  }
  const x = solve3(ata, atb);
  pitch = x[2];
  const fit = { startPos: x[0], startNeg: x[1], pitch };
  const res = rows.map((r) => r.sigma - (r.side === 'pos' ? fit.startPos : fit.startNeg) - r.k * pitch);
  return { fit, rows, res, rms: Math.sqrt(mean(res.map((v) => v * v))), max: Math.max(...res.map(Math.abs)), length: { mean: mean(rows.map((r) => r.len)), sd: sd(rows.map((r) => r.len)) } };
}
function solve3(m, b) {
  const a = m.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row, i) => row[3] / row[i]);
}

const results = {};
for (const key of ['sphere', 'flat']) {
  const r = fitAlong(key);
  results[key] = r;
  console.log(`\nalong = ${key}: startPos ${r.fit.startPos.toFixed(5)}, startNeg ${r.fit.startNeg.toFixed(5)}, pitch ${r.fit.pitch.toFixed(5)}`);
  console.log(`  σ residual: rms ${r.rms.toFixed(5)} R (${px(r.rms)} px), max ${r.max.toFixed(5)} R (${px(r.max)} px)`);
  console.log(`  length: mean ${r.length.mean.toFixed(5)} R, sd ${r.length.sd.toFixed(5)} R`);
  const kmax = { pos: Math.max(...r.rows.filter((q) => q.side === 'pos').map((q) => q.k)), neg: Math.max(...r.rows.filter((q) => q.side === 'neg').map((q) => q.k)) };
  const expect = (s) => Math.floor((L - r.length.mean - (s === 'pos' ? r.fit.startPos : r.fit.startNeg)) / r.fit.pitch + 1e-9);
  console.log(`  last k measured pos ${kmax.pos} neg ${kmax.neg}; rule "σ + length ≤ seam length" gives pos ${expect('pos')} neg ${expect('neg')}`);
}
const best = results.sphere.rms <= results.flat.rms ? 'sphere' : 'flat';
console.log(`\nchosen: along = ${best}`);

// ---- Shape ------------------------------------------------------------------------------------
// Outer vertices in the tab's frame (x along the chord from the base start, y out). Two models:
//  - constant: x and y are the same in R for every tab (averaged over tabs away from the tips);
//  - chord:    x and y are fractions of the base chord length (averaged over all tabs).
// A vertex is anchored to the base start (x) or end (x − chord), whichever is nearer. The tool
// prints each model's vertex error over all tabs and writes out the one with the smaller error.
const mid = tabs.filter((t) => t[best].lo > TIP_SKIP && t[best].lo + t[best].len < L - TIP_SKIP);
console.log(`\nshape: constant model from ${mid.length} tabs away from the tips (${TIP_SKIP} R), chord model from all ${tabs.length}`);
const models = { constant: { pos: [], neg: [] }, chord: { pos: [], neg: [] } };
const errors = { constant: [], chord: [] };
for (const side of ['pos', 'neg']) {
  const all = tabs.filter((t) => t.side === side);
  const group = mid.filter((t) => t.side === side);
  for (let v = 0; v < all[0].outer.length; v++) {
    const stat = (list, scale) => {
      const xs = list.map((t) => t.outer[v].x / scale(t));
      const xe = list.map((t) => (t.outer[v].x - t.chord) / scale(t));
      const anchor = Math.abs(mean(xs)) <= Math.abs(mean(xe)) ? 0 : 1;
      return { anchor, dx: mean(anchor === 0 ? xs : xe), h: mean(list.map((t) => t.outer[v].y / scale(t))) };
    };
    const c = stat(group, () => 1);
    const f = stat(all, (t) => t.chord);
    models.constant[side].push([c.anchor, +c.dx.toFixed(4), +c.h.toFixed(4)]);
    models.chord[side].push([f.anchor, +f.dx.toFixed(4), +f.h.toFixed(4)]);
    for (const t of all) {
      for (const [name, m, scale] of [['constant', c, 1], ['chord', f, t.chord]]) {
        const o = t.outer[v];
        const ex = o.x - (m.anchor * t.chord + m.dx * scale);
        const ey = o.y - m.h * scale;
        errors[name].push(Math.hypot(ex, ey));
      }
    }
    console.log(`  ${side} vertex ${v}: constant anchor ${c.anchor ? 'end' : 'start'} dx ${c.dx.toFixed(4)} h ${c.h.toFixed(4)} R; chord anchor ${f.anchor ? 'end' : 'start'} dx ${f.dx.toFixed(4)} h ${f.h.toFixed(4)} × chord`);
  }
}
for (const name of ['constant', 'chord']) {
  const e = errors[name];
  console.log(`  ${name} model vertex error over all tabs: rms ${px(Math.sqrt(mean(e.map((v) => v * v))))} px, max ${px(Math.max(...e))} px`);
}
const shapeModel = Math.sqrt(mean(errors.chord.map((v) => v * v))) <= Math.sqrt(mean(errors.constant.map((v) => v * v))) ? 'chord' : 'constant';
console.log(`\nsuggested MODEL_360CRAFT.tabs (shape: ${shapeModel}):`);
console.log(JSON.stringify({ along: best, pitch: +results[best].fit.pitch.toFixed(5), length: +results[best].length.mean.toFixed(5), startPos: +results[best].fit.startPos.toFixed(5), startNeg: +results[best].fit.startNeg.toFixed(5), outer: models[shapeModel] }));
if (shapeModel !== 'chord') console.log('NOTE: src/layout/tabs.js builds the chord model only');
