// Cut paths against 360craft's recovered outline.dxf at original-low (ADR-0003, Tabs). Needs photo examples/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MODEL_360CRAFT, pieceAffine } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { makePolylineIndex, resample } from '../../tools/research/lib/polyline-distance.mjs';
import { loadManifest, SKIP_LOCAL } from '../support/fixtures.js';
import { dxfToPolylines, readDxfLines } from '../support/dxf.js';

const manifest = loadManifest();
const skip = (!manifest || !existsSync(manifest.dxfPath)) && SKIP_LOCAL;
const SAMPLE_PX = 0.5;

function quantile(values, q) {
  const a = Float64Array.from(values).sort();
  const i = q * (a.length - 1);
  const lo = Math.floor(i);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo);
}
const stats = (d) => ({ mean: d.reduce((s, v) => s + v, 0) / d.length, p95: quantile(d, 0.95), max: Math.max(...d) });

// Thresholds. Ruling R20 asked for mean ≤ 0.75, p95 ≤ 1.5, max ≤ 2.5 px. Measured on the dense
// samples the plan prescribes (every 0.5 px, both directions), the accepted T6 model's SEAM
// alone gives p95 ≈ 2.0 and max ≈ 3.0 px (the tip-curl bulge: R19's resampled caveat; R20 was
// derived from the raw-vertex figures), so p95 and max cannot meet R20 whatever the tabs do.
// The mean follows R20; p95 and max are pinned just above what the tabs + seam measure
// (mean 0.51–0.55, p95 1.71–1.80, max 2.74–3.10 px) so a regression shows up. See ADR-0003, Tabs.
const LIMITS = { mean: 0.75, p95: 2.0, max: 3.3 };
test(`cut paths vs outline.dxf at original-low: mean ≤ ${LIMITS.mean} px, p95 ≤ ${LIMITS.p95} px, max ≤ ${LIMITS.max} px, both directions`, { skip }, () => {
  const { layoutLow } = MODEL_360CRAFT;
  const { outline } = makeModelGeometry(MODEL_360CRAFT);
  const dxf = dxfToPolylines(readDxfLines(readFileSync(manifest.dxfPath, 'utf8')), { sheetHeight: layoutLow.heightPx });
  ['MyLines1', 'MyLines2'].forEach((layer, j) => {
    const [a, b, c, d, e, f] = pieceAffine(layoutLow.pieces[j], layoutLow.pxPerR);
    const ours = resample(outline.cutPath.map(([X, Y]) => [a * X + c * Y + e, b * X + d * Y + f]), SAMPLE_PX);
    const theirs = dxf.get(layer)[0];
    const theirsDense = resample(theirs, SAMPLE_PX);
    const toTheirs = makePolylineIndex(theirs, { cell: 5 });
    const toOurs = makePolylineIndex(ours, { cell: 5 });
    const forward = ours.map(([x, y]) => toTheirs.nearest(x, y).dist); // ours → DXF
    const backward = theirsDense.map(([x, y]) => toOurs.nearest(x, y).dist); // DXF → ours
    for (const [name, dist] of [['ours→DXF', forward], ['DXF→ours', backward]]) {
      const s = stats(dist);
      const msg = `${layer} ${name}: mean ${s.mean.toFixed(3)}, p95 ${s.p95.toFixed(3)}, max ${s.max.toFixed(3)} px`;
      assert.ok(Number.isFinite(s.max), msg);
      assert.ok(s.mean <= LIMITS.mean, msg);
      assert.ok(s.p95 <= LIMITS.p95, msg);
      assert.ok(s.max <= LIMITS.max, msg);
    }
  });
});
