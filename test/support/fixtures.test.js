import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadManifest, SKIP_LOCAL } from './fixtures.js';

test('loadManifest returns null when the dir is absent', () => assert.equal(loadManifest('/nonexistent'), null));

test('loadManifest resolves absolute existing paths (local)', { skip: !loadManifest() && SKIP_LOCAL }, () => {
  const m = loadManifest();
  assert.ok(path.isAbsolute(m.dxfPath) && existsSync(m.dxfPath));
  assert.ok(m.fixtures.length > 0);
  for (const f of [...m.fixtures, ...m.styleOnly]) {
    assert.ok(path.isAbsolute(f.reference) && existsSync(f.reference), f.id);
    if (f.panorama) assert.ok(existsSync(f.panorama), f.id);
    if (f.mask) assert.ok(path.isAbsolute(f.mask) && existsSync(f.mask), f.id);
  }
  assert.ok(m.fixtures.filter((f) => f.cropped).every((f) => f.mask));
});
