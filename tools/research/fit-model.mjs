// Fit the 360craft warp model (Clelia spiral, ruling R9) to the local reference data:
// SIFT correspondences (test-output/research/<id>.matches.json, correspond.py) and the
// recovered cut outline (photo examples/…/outline.dxf). Writes test-output/research/fit-report.json.
//
// Parameters: spiral rate, baseOrientation (yaw, pitch, roll), pxPerR, and (x, y, angleDeg)
// of each piece. Cost = mean Huber(correspondence residual) + mean Huber(DXF seam distance of
// the closest 70% of DXF vertices), both in low-res px, Huber δ = 2 px.
//
// Usage: node tools/research/fit-model.mjs [--quick]
//   --quick   fewer matches and iterations (smoke run)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nelderMead } from './lib/nelder-mead.mjs';
import { makeSpiral } from '../../src/sphere/spiral.js';
import { bandPhase, makeCentreLine } from '../../src/sphere/band.js';
import { makeUnrolling } from '../../src/sphere/develop.js';
import { apply, mul, rotZ, rotationFromYPR, yprFromRotation } from '../../src/sphere/orient.js';
import { pieceAffine } from '../../src/model/360craft.js';
import { loadManifest } from '../../test/support/fixtures.js';
import { dxfToPolylines, readDxfLines } from '../../test/support/dxf.js';

const OUT_DIR = 'test-output/research';
const FIXTURES = ['alaska', '2018-09-a', '2018-09-b'];
const SHEET = { widthPx: 2850, heightPx: 4160 };
const LAYERS = ['MyLines1', 'MyLines2']; // MyLines1 = the left piece = pieces[0]
const PROBE = { rate: 6.0, pxPerR: 497 };
const HUBER = 2; // px
const TRIM = 0.7; // DXF term: closest 70% of vertices
const SEAM_NEAR = 2; // px: a DXF vertex this close to a seam is a seam vertex
const TIP_ARC = 1; // R: seam vertices within this arc length of a tip are "tip region"
const FIT_STEP = 0.01; // seam polyline step inside the optimiser (R)
const REPORT_STEP = 0.002; // and for the final report (develop.js default)
const FIT_MATCHES = 4000; // correspondences sampled for the optimiser (all are used for the report)
// Plan targets, and the fallback the maintainer set if one bow-chasing round misses them
// (ruling R16): seam p95 instead of max, over the same seam vertices.
const ACCEPT = { median: 1.0, seamMean: 0.5, seamMax: 1.5 };
const ACCEPT_R16 = { median: 1.0, seamMean: 0.75, seamP95: 1.5 };
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

const quick = process.argv.includes('--quick');
const REPORT_FILE = 'fit-report.json';

// ---- Self-test ------------------------------------------------------------------------------
{
  const rosen = ([x, y]) => 100 * (y - x * x) ** 2 + (1 - x) ** 2;
  const { fx } = nelderMead(rosen, [-1.2, 1], { step: 0.5 });
  if (!(fx < 1e-8)) throw new Error(`nelder-mead self-test failed on Rosenbrock: fx = ${fx}`);
  console.log(`nelder-mead self-test: Rosenbrock fx = ${fx.toExponential(2)}`);
}

// ---- Data -----------------------------------------------------------------------------------
const manifest = loadManifest();
if (!manifest || !existsSync(manifest.dxfPath)) throw new Error('photo examples/ not present (local-only reference data, see ADR-0002)');
const dxf = dxfToPolylines(readDxfLines(readFileSync(manifest.dxfPath, 'utf8')), { sheetHeight: SHEET.heightPx });
const dxfLayers = LAYERS.map((name) => {
  const polys = dxf.get(name);
  if (!polys) throw new Error(`DXF layer ${name} missing`);
  return polys.flat();
});
const dxfVerts = dxfLayers.flatMap((pts, layer) => pts.map(([x, y]) => ({ x, y, layer })));
// The DXF's vertex density is very uneven (~100 vertices piled within 1 px at each tip, a few per
// tab), so the report also gives seam residuals over the outline resampled every 1 px.
const RESAMPLE_PX = 1;
const dxfResampled = dxfLayers.flatMap((pts, layer) => {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / RESAMPLE_PX));
    for (let k = 0; k < n; k++) out.push({ x: a[0] + ((b[0] - a[0]) * k) / n, y: a[1] + ((b[1] - a[1]) * k) / n, layer });
  }
  return out;
});

function loadMatches(id) {
  const file = path.join(OUT_DIR, `${id}.matches.json`);
  if (!existsSync(file)) throw new Error(`${file} missing: run tools/research/correspond.py --fixture ${id}`);
  const { sheet, points } = JSON.parse(readFileSync(file, 'utf8'));
  if (sheet !== 'low') throw new Error(`${file}: expected low-res sheet coordinates`);
  const seen = new Set();
  const out = [];
  for (const row of points) {
    const key = row.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const [x, y, lon, lat] = row;
    const c = Math.cos(lat);
    out.push({ fixture: id, x, y, q: [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)] });
  }
  return { raw: points.length, matches: out };
}
const loaded = FIXTURES.map(loadMatches);
const matches = loaded.flatMap((l) => l.matches);
FIXTURES.forEach((id, i) => console.log(`${id}: ${loaded[i].raw} matches, ${loaded[i].matches.length} after removing exact duplicates`));

function sample(list, n, seed = 1) {
  if (list.length <= n) return list.slice();
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const a = list.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
const fitMatches = sample(matches, quick ? 1500 : FIT_MATCHES);

// ---- Geometry per rate ----------------------------------------------------------------------
// Unrolling, flat outline (pos seam forward, neg seam back; each vertex keeps its seam arc
// length s, which equals the centre line's) and a segment grid for distances to it.
const GRID = 0.02;
const geoCache = new Map();
function geometry(rate, step) {
  const key = `${rate}|${step}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const spiral = makeSpiral({ family: 'clelia', rate });
  const centreLine = makeCentreLine(spiral);
  const un = makeUnrolling(spiral, centreLine);
  const { pos, neg } = un.seams(step);
  const L = un.length;
  const sAt = (i) => Math.min(i * step, L);
  const verts = [...pos.map((p, i) => ({ p, s: sAt(i) })), ...neg.slice(1, -1).map((p, i) => ({ p, s: sAt(i + 1) })).reverse()];
  const outline = verts.map((v) => v.p);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = 0.5;
  const gx0 = minX - pad;
  const gy0 = minY - pad;
  const gw = Math.ceil((maxX - minX + 2 * pad) / GRID);
  const gh = Math.ceil((maxY - minY + 2 * pad) / GRID);
  const cells = Array.from({ length: gw * gh }, () => []);
  const nV = verts.length;
  for (let i = 0; i < nV; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % nV];
    const i0 = Math.floor((Math.min(a[0], b[0]) - gx0) / GRID);
    const i1 = Math.floor((Math.max(a[0], b[0]) - gx0) / GRID);
    const j0 = Math.floor((Math.min(a[1], b[1]) - gy0) / GRID);
    const j1 = Math.floor((Math.max(a[1], b[1]) - gy0) / GRID);
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) cells[j * gw + k].push(i);
  }
  // Distance (R) from (x, y) to the outline, up to maxR, and the seam arc length there.
  function nearest(x, y, maxR) {
    const ci = Math.floor((x - gx0) / GRID);
    const cj = Math.floor((y - gy0) / GRID);
    let best = maxR;
    let bestS = NaN;
    const kMax = Math.ceil(maxR / GRID) + 1;
    for (let k = 0; k <= kMax && (k - 1) * GRID < best; k++) {
      for (let j = cj - k; j <= cj + k; j++) {
        for (let i = ci - k; i <= ci + k; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== k) continue;
          if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
          for (const v of cells[j * gw + i]) {
            const a = outline[v];
            const b = outline[(v + 1) % nV];
            const ex = b[0] - a[0];
            const ey = b[1] - a[1];
            const l2 = ex * ex + ey * ey;
            const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (y - a[1]) * ey) / l2)) : 0;
            const d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey);
            if (d < best) {
              best = d;
              const sb = verts[(v + 1) % nV].s;
              bestS = verts[v].s + t * (sb - verts[v].s);
            }
          }
        }
      }
    }
    return { dist: best, s: bestS };
  }
  const geo = { spiral, un, L, outline, bbox: { minX, minY, maxX, maxY }, nearest };
  geoCache.set(key, geo);
  if (geoCache.size > 8) geoCache.delete(geoCache.keys().next().value);
  return geo;
}

// ---- Model ----------------------------------------------------------------------------------
// params = [rate, yaw, pitch, roll, pxPerR, x0, y0, angle0, x1, y1, angle1]
const unpack = (v, bands) => ({
  rate: v[0],
  baseOrientation: { yaw: v[1], pitch: v[2], roll: v[3] },
  pxPerR: v[4],
  pieces: [0, 1].map((j) => ({ band: bands[j], x: v[5 + 3 * j], y: v[6 + 3 * j], angleDeg: v[7 + 3 * j] })),
});

function invertAffine([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return (x, y) => [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
}
const angleBetween = (u, v) => {
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  return Math.atan2(Math.hypot(cx, cy, cz), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
};

// Sheet px → band-frame sphere point of the piece that contains it. hints caches the last s
// per (match, piece) to warm-start flatToStrip.
function locate(geo, model, inverses, m, hints) {
  let notOk = false;
  for (let j = 0; j < 2; j++) {
    const [X, Y] = inverses[j](m.x, m.y);
    const { bbox } = geo;
    if (X < bbox.minX - 0.05 || X > bbox.maxX + 0.05 || Y < bbox.minY - 0.05 || Y > bbox.maxY + 0.05) continue;
    const rec = geo.un.flatToStrip(X, Y, hints?.[j]);
    if (!rec.ok) {
      notOk = true;
      continue;
    }
    if (hints && rec.cell === 'strip') hints[j] = rec.s;
    const p = geo.un.stripToSphere(rec);
    if (Math.abs(bandPhase(p, geo.spiral)) >= HALF_PI) continue;
    return { piece: j, cell: rec.cell, s: rec.s, p: model.pieces[j].band ? apply(rotZ(Math.PI), p) : p };
  }
  return { piece: -1, notOk };
}

const hintStore = new Map();
function correspondence(geo, model, list) {
  const inverses = model.pieces.map((pc) => invertAffine(pieceAffine(pc, model.pxPerR)));
  const M = rotationFromYPR(model.baseOrientation);
  const residuals = [];
  let notOk = 0;
  let outside = 0;
  for (const m of list) {
    let hints = hintStore.get(m);
    if (!hints) hintStore.set(m, (hints = [undefined, undefined]));
    const loc = locate(geo, model, inverses, m, hints);
    if (loc.piece < 0) {
      if (loc.notOk) notOk++;
      else outside++;
      continue;
    }
    residuals.push({ m, r: angleBetween(apply(M, loc.p), m.q) * model.pxPerR, loc });
  }
  return { residuals, notOk, outside };
}

function seamDistances(geo, model, points = dxfVerts) {
  const inverses = model.pieces.map((pc) => invertAffine(pieceAffine(pc, model.pxPerR)));
  const maxR = 60 / model.pxPerR;
  return points.map((v) => {
    const [X, Y] = inverses[v.layer](v.x, v.y);
    const { dist, s } = geo.nearest(X, Y, maxR);
    return { v, d: dist * model.pxPerR, s };
  });
}

const huber = (r) => (r <= HUBER ? 0.5 * r * r : HUBER * (r - 0.5 * HUBER));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function quantile(values, q) {
  const a = Float64Array.from(values).sort();
  if (a.length === 0) return NaN;
  const i = q * (a.length - 1);
  const lo = Math.floor(i);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo);
}

function dxfTerm(dists) {
  const d = Float64Array.from(dists, (x) => x.d).sort();
  const n = Math.floor(TRIM * d.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += huber(d[i]);
  return sum / n;
}

function cost(v, bands, { list = fitMatches, step = FIT_STEP, withCorr = true } = {}) {
  const model = unpack(v, bands);
  if (!(model.rate > 1 && model.pxPerR > 100)) return 1e9;
  const geo = geometry(model.rate, step);
  const dxfCost = dxfTerm(seamDistances(geo, model));
  if (!withCorr) return dxfCost;
  const { residuals } = correspondence(geo, model, list);
  if (residuals.length < 0.5 * list.length) return 1e6 + dxfCost; // pieces slid off the data
  return mean(residuals.map((x) => huber(x.r))) + dxfCost;
}

// ---- Initialisation -------------------------------------------------------------------------
function bboxOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
const applyAffine = ([a, b, c, d, e, f], [X, Y]) => [a * X + c * Y + e, b * X + d * Y + f];

// Grid-search angleDeg in 5° steps matching the transformed seam bbox to the DXF layer's bbox,
// then translate so the bbox centres coincide.
function initPiece(geo, layer, pxPerR) {
  const target = bboxOf(dxfLayers[layer]);
  let best = null;
  for (let angleDeg = 0; angleDeg < 360; angleDeg += 5) {
    const A = pieceAffine({ x: 0, y: 0, angleDeg }, pxPerR);
    const bb = bboxOf(geo.outline.map((p) => applyAffine(A, p)));
    const score = Math.abs(bb.w - target.w) + Math.abs(bb.h - target.h);
    if (!best || score < best.score - 1e-9) best = { score, angleDeg, x: target.cx - bb.cx, y: target.cy - bb.cy };
  }
  return best;
}

// The flat piece is symmetric under a half turn about the midpoint of its tips (the band is
// symmetric under the half turn of the sphere swapping its tips), so the bbox and DXF fit
// cannot tell angleDeg from angleDeg + 180°: return that twin.
function halfTurn(geo, piece, pxPerR) {
  const mid = [0.5 * geo.un.flatFrame(geo.L).c[0], 0.5 * geo.un.flatFrame(geo.L).c[1]];
  const at = applyAffine(pieceAffine(piece, pxPerR), mid);
  const turned = { ...piece, angleDeg: piece.angleDeg + 180, x: 0, y: 0 };
  const at2 = applyAffine(pieceAffine(turned, pxPerR), mid);
  return { ...turned, x: at[0] - at2[0], y: at[1] - at2[1] };
}

// Least-squares rotation q ≈ M·p (Wahba) by the polar decomposition of B = Σ q pᵀ, with two
// rounds of rejecting matches over 3× the median residual. Returns det(B) as a handedness check.
function solveRotation(pairs) {
  let use = pairs;
  let M = null;
  let detB = 0;
  for (let round = 0; round < 3; round++) {
    const B = new Float64Array(9);
    for (const { q, p } of use) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) B[3 * i + k] += q[i] * p[k];
    detB = det3(B);
    M = polar(B);
    const res = pairs.map(({ q, p }) => angleBetween(apply(M, p), q));
    const med = quantile(res, 0.5);
    use = pairs.filter((_, i) => res[i] <= 3 * med);
  }
  return { M, detB };
}
function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}
function polar(B) {
  // Newton iteration X ← (X + X⁻ᵀ)/2 converges to the orthogonal polar factor.
  let X = Float64Array.from(B);
  const s = Math.cbrt(Math.abs(det3(X))) || 1;
  X = X.map((x) => x / s);
  for (let it = 0; it < 60; it++) {
    const d = det3(X);
    const invT = Float64Array.from([
      (X[4] * X[8] - X[5] * X[7]) / d,
      -(X[3] * X[8] - X[5] * X[6]) / d,
      (X[3] * X[7] - X[4] * X[6]) / d,
      -(X[1] * X[8] - X[2] * X[7]) / d,
      (X[0] * X[8] - X[2] * X[6]) / d,
      -(X[0] * X[7] - X[1] * X[6]) / d,
      (X[1] * X[5] - X[2] * X[4]) / d,
      -(X[0] * X[5] - X[2] * X[3]) / d,
      (X[0] * X[4] - X[1] * X[3]) / d,
    ]);
    const next = X.map((x, i) => 0.5 * (x + invT[i]));
    const change = Math.max(...next.map((x, i) => Math.abs(x - X[i])));
    X = next;
    if (change < 1e-15) break;
  }
  return X;
}

function initialise(rate) {
  const geo = geometry(rate, FIT_STEP);
  const pxPerR = PROBE.pxPerR;
  const start = [0, 1].map((layer) => initPiece(geo, layer, pxPerR));
  console.log(`init: bbox angle search → ${start.map((p) => `${p.angleDeg}°`).join(', ')}`);
  // DXF-only refinement of the layout (rate fixed) before choosing tips and bands.
  const layout0 = [pxPerR, ...start.flatMap((p) => [p.x, p.y, p.angleDeg])];
  const dxfOnly = (u) => cost([rate, 0, 0, 0, ...u], [0, 1], { withCorr: false });
  const steps = [2, 5, 5, 1, 5, 5, 1];
  let fitL = nelderMead(dxfOnly, layout0, { step: steps, maxIter: 1500 });
  fitL = nelderMead(dxfOnly, fitL.x, { step: steps.map((s) => s / 5), maxIter: 1500 });
  console.log(`init: DXF-only layout cost ${fitL.fx.toFixed(3)} (pxPerR ${fitL.x[1 - 1].toFixed(2)})`);
  const pxR = fitL.x[0];
  const placed = [0, 1].map((j) => ({ x: fitL.x[1 + 3 * j], y: fitL.x[2 + 3 * j], angleDeg: fitL.x[3 + 3 * j] }));

  const candidates = [];
  for (const turn0 of [false, true]) {
    for (const turn1 of [false, true]) {
      for (const bands of [[0, 1], [1, 0]]) {
        const pieces = placed.map((p, j) => ({ ...((j ? turn1 : turn0) ? halfTurn(geo, p, pxR) : p), band: bands[j] }));
        const model = { rate, baseOrientation: { yaw: 0, pitch: 0, roll: 0 }, pxPerR: pxR, pieces };
        const { residuals } = correspondence(geo, model, fitMatches);
        const { M, detB } = solveRotation(residuals.map(({ m, loc }) => ({ q: m.q, p: loc.p })));
        const ypr = yprFromRotation(M);
        const v = [rate, ypr.yaw, ypr.pitch, ypr.roll, pxR, ...pieces.flatMap((p) => [p.x, p.y, p.angleDeg])];
        const c = cost(v, bands);
        const angle = Math.acos(Math.min(1, Math.max(-1, (M[0] + M[4] + M[8] - 1) / 2))) / DEG;
        candidates.push({ turn: [turn0, turn1], bands, v, cost: c, detB, rotationDeg: angle });
        console.log(`init: half-turn ${+turn0}${+turn1} bands ${bands.join('')}: cost ${c.toFixed(3)}, det(B) ${detB.toExponential(2)}, |base| ${angle.toFixed(1)}°`);
      }
    }
  }
  // Swapping the bands of both pieces is the same model as baseOrientation·Rz(π), and turning
  // both pieces is a symmetry of the sphere too, so costs come in equal groups: among the best
  // (within 1%), prefer the smallest base rotation.
  const minCost = Math.min(...candidates.map((c) => c.cost));
  const pick = candidates.filter((c) => c.cost <= minCost * 1.01).sort((a, b) => a.rotationDeg - b.rotationDeg)[0];
  return { pick, candidates };
}

// ---- Fit ------------------------------------------------------------------------------------
function fit() {
  const t0 = Date.now();
  const { pick, candidates } = initialise(PROBE.rate);
  const bands = pick.bands;
  const steps = [0.02, 0.3, 0.3, 0.3, 1, 3, 3, 0.3, 3, 3, 0.3];
  let best = { x: pick.v, fx: pick.cost };
  const rounds = quick ? 1 : 3;
  for (let round = 0; round < rounds; round++) {
    const res = nelderMead((v) => cost(v, bands), best.x, { step: steps.map((s) => s / (1 + round)), maxIter: quick ? 400 : 1500, tol: 1e-9 });
    console.log(`fit round ${round + 1}: cost ${res.fx.toFixed(4)} after ${res.iterations} iterations (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    const done = res.fx > best.fx - 1e-4;
    best = res.fx < best.fx ? res : best;
    if (done) break;
  }
  return { v: best.x, bands, init: { candidates: candidates.map(({ turn, bands: b, cost: c, detB, rotationDeg }) => ({ halfTurn: turn, bands: b, cost: c, detB, rotationDeg })) } };
}

// ---- Report ---------------------------------------------------------------------------------
const round = (x, n = 4) => Number(x.toFixed(n));
function stats(values) {
  return { n: values.length, mean: round(mean(values)), median: round(quantile(values, 0.5)), p90: round(quantile(values, 0.9)), max: round(Math.max(...values)) };
}

function evaluate(v, bands) {
  const model = unpack(v, bands);
  const geo = geometry(model.rate, REPORT_STEP);
  const corr = correspondence(geo, model, matches);
  const r = corr.residuals.map((x) => x.r);
  const perFixture = Object.fromEntries(
    FIXTURES.map((id) => {
      const rs = corr.residuals.filter((x) => x.m.fixture === id);
      return [id, { ...stats(rs.map((x) => x.r)), tipCells: rs.filter((x) => x.loc.cell !== 'strip').length }];
    }),
  );
  const tipCorr = corr.residuals.filter((x) => x.loc.cell !== 'strip' || x.loc.s < TIP_ARC || x.loc.s > geo.L - TIP_ARC).map((x) => x.r);
  const bodyCorr = corr.residuals.filter((x) => !(x.loc.cell !== 'strip' || x.loc.s < TIP_ARC || x.loc.s > geo.L - TIP_ARC)).map((x) => x.r);

  const dists = seamDistances(geo, model);
  const seamVerts = dists.filter((x) => x.d <= SEAM_NEAR);
  const isTip = (x) => x.s < TIP_ARC || x.s > geo.L - TIP_ARC;
  const seam = (list) => {
    const d = list.map((x) => x.d);
    return { n: d.length, mean: round(mean(d)), p95: round(quantile(d, 0.95)), max: round(Math.max(...d)) };
  };
  const resampled = seamDistances(geo, model, dxfResampled).filter((x) => x.d <= SEAM_NEAR);
  const cTotal = mean(r.map(huber)) + dxfTerm(dists);
  const summary = {
    family: 'clelia',
    params: {
      spiral: { family: 'clelia', rate: round(model.rate, 5) },
      baseOrientation: { yaw: round(model.baseOrientation.yaw, 3), pitch: round(model.baseOrientation.pitch, 3), roll: round(model.baseOrientation.roll, 3) },
      pxPerR: round(model.pxPerR, 3),
      pieces: model.pieces.map((p) => ({ band: p.band, x: round(p.x, 2), y: round(p.y, 2), angleDeg: round(((p.angleDeg % 360) + 360) % 360, 3) })),
    },
    cost: round(cTotal),
    correspondence: {
      ...stats(r),
      skippedFlatToStripNotOk: corr.notOk,
      skippedOutsidePieces: corr.outside,
      tipRegion: stats(tipCorr),
      body: stats(bodyCorr),
      perFixture,
    },
    seam: {
      ...seam(seamVerts),
      dxfVertices: dists.length,
      tipRegion: seam(seamVerts.filter(isTip)),
      body: seam(seamVerts.filter((x) => !isTip(x))),
      resampled1px: { ...seam(resampled), tipRegion: seam(resampled.filter(isTip)), body: seam(resampled.filter((x) => !isTip(x))) },
      fractionWithin: Object.fromEntries([0.5, 1, 1.5, 2].map((t) => [t, round(dists.filter((x) => x.d <= t).length / dists.length, 3)])),
    },
  };
  const { median } = summary.correspondence;
  const { mean: seamMean, p95: seamP95, max: seamMax } = summary.seam;
  summary.meetsTargets = median <= ACCEPT.median && seamMean <= ACCEPT.seamMean && seamMax <= ACCEPT.seamMax;
  summary.meetsR16 = median <= ACCEPT_R16.median && seamMean <= ACCEPT_R16.seamMean && seamP95 <= ACCEPT_R16.seamP95;
  summary.accepted = summary.meetsTargets || summary.meetsR16;
  return summary;
}

const result = fit();
const report = {
  generated: new Date().toISOString(),
  unrolling: 'develop.js (closest-point strip + tip cells, flat offsets tan d / tan ρ)',
  data: { fixtures: FIXTURES, matches: matches.length, fitMatches: fitMatches.length, dxf: path.basename(manifest.dxfPath), fitStep: FIT_STEP, reportStep: REPORT_STEP },
  acceptance: { targets: ACCEPT, r16: ACCEPT_R16 },
  init: result.init,
  clelia: evaluate(result.v, result.bands),
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, REPORT_FILE), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.clelia, null, 2));
console.log(`wrote ${path.join(OUT_DIR, REPORT_FILE)}`);
