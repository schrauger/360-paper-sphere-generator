// The fitted 360craft model against the local reference data (ADR-0003). Needs photo examples/
// (outline.dxf) and the correspondences from tools/research/correspond.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MODEL_360CRAFT, pieceAffine } from '../../src/model/360craft.js';
import { makeSpiral } from '../../src/sphere/spiral.js';
import { bandPhase, makeCentreLine } from '../../src/sphere/band.js';
import { makeUnrolling } from '../../src/sphere/develop.js';
import { apply, rotZ, rotationFromYPR } from '../../src/sphere/orient.js';
import { loadManifest, SKIP_LOCAL } from '../support/fixtures.js';
import { dxfToPolylines, readDxfLines } from '../support/dxf.js';

const MATCHES = 'test-output/research/alaska.matches.json';
const manifest = loadManifest();
const skipMatches = !manifest ? SKIP_LOCAL : !existsSync(MATCHES) && 'run tools/research/correspond.py --fixture alaska';
const skipDxf = (!manifest || !existsSync(manifest.dxfPath)) && SKIP_LOCAL;

const { spiral: spiralCfg, baseOrientation, layoutLow } = MODEL_360CRAFT;
const spiral = makeSpiral(spiralCfg);
const unrolling = makeUnrolling(spiral, makeCentreLine(spiral));
const { pxPerR, pieces } = layoutLow;

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return ([x, y]) => [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
}
function quantile(values, q) {
  const a = Float64Array.from(values).sort();
  const i = q * (a.length - 1);
  const lo = Math.floor(i);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo);
}

test('alaska correspondences reproject with median ≤ 1.0 px and 90th percentile ≤ 2.5 px', { skip: skipMatches }, () => {
  const M = rotationFromYPR(baseOrientation);
  const toFlat = pieces.map((p) => invert(pieceAffine(p, pxPerR)));
  const seen = new Set();
  const residuals = [];
  for (const row of JSON.parse(readFileSync(MATCHES, 'utf8')).points) {
    const key = row.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const [x, y, lon, lat] = row;
    const q = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    for (let j = 0; j < pieces.length; j++) {
      const rec = unrolling.flatToStrip(...toFlat[j]([x, y]));
      if (!rec.ok) continue;
      const p = unrolling.stripToSphere(rec);
      if (Math.abs(bandPhase(p, spiral)) >= Math.PI / 2) continue; // not on this piece
      const v = apply(M, pieces[j].band ? apply(rotZ(Math.PI), p) : p);
      const dot = Math.min(1, v[0] * q[0] + v[1] * q[1] + v[2] * q[2]);
      residuals.push(Math.acos(dot) * pxPerR);
      break;
    }
  }
  assert.ok(residuals.length > 0.9 * seen.size, `only ${residuals.length} of ${seen.size} matches land on a piece`);
  const median = quantile(residuals, 0.5);
  const p90 = quantile(residuals, 0.9);
  assert.ok(median <= 1.0, `median ${median.toFixed(3)} px`);
  assert.ok(p90 <= 2.5, `p90 ${p90.toFixed(3)} px`);
});

// Acceptance as in ADR-0003 (ruling R16): over DXF vertices within 2 px of a seam.
test('outline.dxf seam vertices lie on the model seams: mean ≤ 0.75 px, 95th percentile ≤ 1.5 px', { skip: skipDxf }, () => {
  const dxf = dxfToPolylines(readDxfLines(readFileSync(manifest.dxfPath, 'utf8')), { sheetHeight: layoutLow.heightPx });
  const { pos, neg } = unrolling.seams(0.002);
  const outline = [...pos, ...neg.slice(1, -1).reverse()];
  const near = [];
  let total = 0;
  ['MyLines1', 'MyLines2'].forEach((layer, j) => {
    const A = pieceAffine(pieces[j], pxPerR);
    const sheet = outline.map(([X, Y]) => [A[0] * X + A[2] * Y + A[4], A[1] * X + A[3] * Y + A[5]]);
    for (const [x, y] of dxf.get(layer).flat()) {
      total++;
      let best = Infinity;
      for (let i = 0; i < sheet.length; i++) {
        const a = sheet[i];
        const b = sheet[(i + 1) % sheet.length];
        if (Math.abs(a[0] - x) > 20 || Math.abs(a[1] - y) > 20) continue; // segments are ~1 px long
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
        best = Math.min(best, Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey));
      }
      if (best <= 2) near.push(best);
    }
  });
  // Only vertices within 2 px count, so a worse fit would drop vertices out of the statistic
  // instead of raising it: require the share seen at acceptance (2535 of 2904 = 0.873).
  assert.ok(near.length >= 0.85 * total, `only ${near.length} of ${total} DXF vertices are seam vertices`);
  const mean = near.reduce((s, d) => s + d, 0) / near.length;
  const p95 = quantile(near, 0.95);
  assert.ok(mean <= 0.75, `mean ${mean.toFixed(3)} px`);
  assert.ok(p95 <= 1.5, `p95 ${p95.toFixed(3)} px`);
});
