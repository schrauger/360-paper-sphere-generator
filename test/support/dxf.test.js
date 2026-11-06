import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManifest, SKIP_LOCAL } from './fixtures.js';
import { readDxfLines, dxfToPolylines } from './dxf.js';

test('readDxfLines parses LINE entities with layer', () => {
  const dxf = '  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n  8\nMyLines1\n 10\n1.0\n 20\n2.0\n 30\n0.0\n 11\n3.0\n 21\n4.0\n 31\n0.0\n  0\nENDSEC\n  0\nEOF\n';
  assert.deepEqual(readDxfLines(dxf), [{ layer: 'MyLines1', x1: 1, y1: 2, x2: 3, y2: 4 }]);
});

test('dxfToPolylines chains a unit square given out of order and flips y', () => {
  const seg = (x1, y1, x2, y2) => ({ layer: 'L', x1, y1, x2, y2 });
  const lines = [seg(0, 0, 1, 0), seg(1, 1, 0, 1), seg(1, 0, 1, 1), seg(0, 1, 0, 0), seg(5, 5, 5, 5)];
  const polys = dxfToPolylines(lines, { sheetHeight: 10 });
  assert.equal(polys.get('L').length, 1);
  const p = polys.get('L')[0];
  assert.equal(p.length, 4);
  assert.equal(new Set(p.map((q) => q.join())).size, 4);
  assert.ok(p.every(([, y]) => y === 10 || y === 9));
});

test('360craft outline.dxf (local)', { skip: !loadManifest() && SKIP_LOCAL }, () => {
  const lines = readDxfLines(readFileSync(loadManifest().dxfPath, 'utf8'));
  assert.equal(lines.length, 2910);
  for (const layer of ['MyLines1', 'MyLines2']) {
    assert.equal(lines.filter((l) => l.layer === layer).length, 1455);
  }
  const polys = dxfToPolylines(lines, { sheetHeight: 4160 });
  for (const layer of ['MyLines1', 'MyLines2']) {
    assert.equal(polys.get(layer).length, 1, layer);
    for (const [x, y] of polys.get(layer)[0]) {
      assert.ok(x >= 0 && x <= 2850 && y >= 0 && y <= 4160, `${layer} ${x},${y}`);
    }
  }
});
