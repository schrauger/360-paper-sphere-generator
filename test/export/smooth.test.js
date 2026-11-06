import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';
import { layoutSheet } from '../../src/layout/sheet.js';
import { layoutInMm } from '../../src/export/pieces.js';
import { markOutlines } from '../../src/render/marks.js';
import {
  SMOOTH_TOLERANCE_MM, CORNER_ANGLE, smoothClosedPath, sampleSmoothPath, simplifyClosed,
} from '../../src/export/smooth.js';

const { outline } = makeModelGeometry(MODEL_360CRAFT);
const letter = { widthMm: 215.9, heightMm: 279.4 };
// letter at the largest diameter that fits (auto), letter at 62 mm, and a 40 mm preset
const CASES = [
  { name: 'letter auto', opts: { page: letter, marks: 'silhouette' } },
  { name: 'letter 62 mm', opts: { page: letter, marks: 'silhouette', diameterMm: 62 } },
  { name: 'letter 40 mm', opts: { page: letter, marks: 'silhouette', diameterMm: 40 } },
];

const dedupeClose = (pts) => {
  const [f, l] = [pts[0], pts[pts.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? pts.slice(0, -1) : pts;
};
const distToSeg = (p, a, b) => {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
// Distance from a point to a closed polyline, via a 1 mm grid of its segments (valid below 1 mm).
const ringIndex = (ring) => {
  const grid = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    for (let cx = Math.floor(Math.min(a[0], b[0])); cx <= Math.floor(Math.max(a[0], b[0])); cx++) {
      for (let cy = Math.floor(Math.min(a[1], b[1])); cy <= Math.floor(Math.max(a[1], b[1])); cy++) {
        const k = key(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([a, b]);
      }
    }
  });
  return (p) => {
    let best = Infinity;
    const [cx, cy] = [Math.floor(p[0]), Math.floor(p[1])];
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) for (const [a, b] of grid.get(key(x, y)) ?? []) best = Math.min(best, distToSeg(p, a, b));
    }
    return best;
  };
};
// Sample a polyline ring densely (about every 0.01 mm), vertices included.
const densify = (ring, step = 0.01) => {
  const out = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  });
  return out;
};
const turn = (a, b, c) => {
  const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
};
const cornersOf = (ring) => ring.filter((p, i) => turn(ring[(i - 1 + ring.length) % ring.length], p, ring[(i + 1) % ring.length]) > CORNER_ANGLE);
const has = (pts, p) => pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6);

for (const { name, opts } of CASES) {
  const layout = layoutSheet(MODEL_360CRAFT, outline, opts);
  const { cuts } = layoutInMm(layout, outline, false, markOutlines);
  cuts.forEach((ring, pi) => {
    test(`${name}, piece ${pi}: smoothed path stays within tolerance both ways`, () => {
      const path = smoothClosedPath(ring);
      const dense = sampleSmoothPath(path, 0.01);
      const toRing = ringIndex(ring);
      const toCurve = ringIndex(dense);
      let a = 0;
      for (const p of dense) a = Math.max(a, toRing(p));
      let b = 0;
      for (const p of densify(ring)) b = Math.max(b, toCurve(p));
      assert.ok(a <= SMOOTH_TOLERANCE_MM, `curve to polyline ${a}`);
      assert.ok(b <= SMOOTH_TOLERANCE_MM + 0.01, `polyline to curve ${b}`); // +0.01: sampling step
    });

    test(`${name}, piece ${pi}: at least 10x fewer segments, corners kept, no tiny segments`, () => {
      const path = smoothClosedPath(ring);
      assert.ok(path.segs.length * 10 <= ring.length, `${path.segs.length} vs ${ring.length}`);
      const ends = [path.start, ...path.segs.map((s) => s.to)];
      const corners = cornersOf(dedupeClose(ring));
      assert.equal(corners.length, 250);
      corners.forEach((c) => assert.ok(has(ends, c), `corner ${c} lost`));
      // The original's shortest sides (tab chamfers) are well above 0.05 mm, so none is expected.
      let from = path.start;
      for (const s of path.segs) {
        assert.ok(Math.hypot(s.to[0] - from[0], s.to[1] - from[1]) >= 0.05, 'tiny segment');
        from = s.to;
      }
      assert.deepEqual(path.segs[path.segs.length - 1].to, path.start);
    });

    test(`${name}, piece ${pi}: simplifyClosed keeps corners and tolerance`, () => {
      const simple = simplifyClosed(ring);
      assert.ok(simple.length * 10 <= ring.length);
      cornersOf(dedupeClose(ring)).forEach((c) => assert.ok(has(simple, c)));
      const toRing = ringIndex(ring);
      for (const p of densify(simple)) assert.ok(toRing(p) <= SMOOTH_TOLERANCE_MM + 1e-9);
      for (const p of simple) assert.ok(toRing(p) < 1e-9); // vertices are original vertices
    });
  });
}

test('smoothing is deterministic and translation-consistent', () => {
  const layout = layoutSheet(MODEL_360CRAFT, outline, CASES[0].opts);
  const ring = layoutInMm(layout, outline, false, markOutlines).cuts[0];
  const a = smoothClosedPath(ring);
  assert.deepEqual(smoothClosedPath(ring), a);
  const moved = smoothClosedPath(ring.map(([x, y]) => [x + 10, y + 20]));
  assert.equal(moved.segs.length, a.segs.length);
  moved.segs.forEach((s, i) => assert.ok(Math.hypot(s.to[0] - 10 - a.segs[i].to[0], s.to[1] - 20 - a.segs[i].to[1]) < 1e-6));
});

test('a square stays four straight lines; a circle becomes a few curves', () => {
  const sq = smoothClosedPath([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.deepEqual(sq.segs.map((s) => s.type), ['L', 'L', 'L', 'L']);
  const circle = Array.from({ length: 720 }, (_, i) => [20 * Math.cos((i * Math.PI) / 360), 20 * Math.sin((i * Math.PI) / 360)]);
  const c = smoothClosedPath(circle);
  assert.ok(c.segs.length <= 12 && c.segs.every((s) => s.type === 'C'));
});
