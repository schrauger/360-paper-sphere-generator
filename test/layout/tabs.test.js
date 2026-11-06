import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { placeTabs } from '../../src/layout/tabs.js';
import { polygonArea } from '../../src/layout/polygon.js';
import { insidePolygon, isSimplePolygon } from '../support/polygon.js';

const { unrolling, outline } = makeModelGeometry(MODEL_360CRAFT);
const spec = MODEL_360CRAFT.tabs;

// The two seams of a band: the strip chart is valid on them, so a base point maps to the sphere.
function polarAngle([x, y]) {
  const p = unrolling.stripToSphere(unrolling.flatToStrip(x, y));
  return Math.acos(p[2]);
}
// Base of a tab polygon (outline order): the vertices on the seam, i.e. all but the outer ones.
const outerCount = spec.outer.pos.length;
const basePoints = (tab) => tab.slice(0, tab.length - outerCount);

test('tabs on the + seam and the − seam never overlap in θ (they mate with bare edge)', () => {
  // Ruling R22: θ from each tab's base (on the seam, inside the chart), via flatToStrip → stripToSphere.
  const interval = (tab) => {
    const thetas = basePoints(tab).map(polarAngle);
    return [Math.min(...thetas), Math.max(...thetas)];
  };
  const pos = placeTabs(unrolling, +1, spec).map(interval);
  const neg = placeTabs(unrolling, -1, spec).map(interval);
  assert.equal(pos.length, 25);
  assert.equal(neg.length, 25);
  const all = [...pos.map((iv) => ({ iv, side: '+' })), ...neg.map((iv) => ({ iv, side: '−' }))].sort((a, b) => a.iv[0] - b.iv[0]);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].iv[0] > all[i - 1].iv[1], `tab ${i} (${all[i].side}) starts at θ=${all[i].iv[0]} inside the previous (${all[i - 1].side}, to ${all[i - 1].iv[1]})`);
  }
  // They interleave: the sides alternate, starting with the − seam (its start is half a pitch earlier).
  all.forEach((tab, i) => assert.equal(tab.side, i % 2 === 0 ? '−' : '+', `tab ${i}`));
});

test('every tab lies outside the band: its outer-edge midpoint is outside the band outline and its base on it', () => {
  // Ruling R22: tested in the flat; tab tips have no sphere preimage (the chart tears ≈ 0.036 R past the edge).
  for (const side of [+1, -1]) {
    for (const tab of placeTabs(unrolling, side, spec)) {
      const outer = tab.slice(tab.length - outerCount);
      // Midpoint of the outer edge: the middle outer vertex's neighbours are the two full-height ones.
      const mid = [(outer[0][0] + outer[1][0]) / 2, (outer[0][1] + outer[1][1]) / 2];
      assert.ok(!insidePolygon(outline.edge, mid), `outer midpoint of a ${side > 0 ? '+' : '−'} tab is inside the band`);
      const base = basePoints(tab);
      const baseMid = base[Math.floor(base.length / 2)];
      const sphere = unrolling.stripToSphere(unrolling.flatToStrip(baseMid[0], baseMid[1]));
      assert.ok(Math.abs(unrolling.edgeDistance(sphere)) < 2e-3, `base is ${unrolling.edgeDistance(sphere)} R from the band edge`);
    }
  }
});

test('cutPath is a simple closed polygon whose area = edge area + Σ tab areas within 0.1%', () => {
  assert.ok(isSimplePolygon(outline.edge), 'edge self-intersects');
  assert.ok(isSimplePolygon(outline.cutPath), 'cutPath self-intersects');
  const edgeArea = Math.abs(polygonArea(outline.edge));
  const tabArea = outline.tabs.reduce((s, t) => s + Math.abs(polygonArea(t)), 0);
  assert.equal(outline.tabs.length, 50);
  const cutArea = Math.abs(polygonArea(outline.cutPath));
  assert.ok(Math.abs(cutArea - (edgeArea + tabArea)) <= 0.001 * (edgeArea + tabArea), `cut ${cutArea} vs edge ${edgeArea} + tabs ${tabArea}`);
  // Tabs add area (they stick out), and every tab polygon has positive area.
  assert.ok(cutArea > edgeArea);
  for (const t of outline.tabs) assert.ok(Math.abs(polygonArea(t)) > 0.005);
});
