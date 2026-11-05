import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SKIP_LOCAL = 'photo examples/ not present (local-only reference data, see ADR-0002)';

/** Locate the local-only reference data via its manifest; null if absent. */
export function loadManifest(dir = 'photo examples') {
  const root = path.resolve(dir);
  const file = path.join(root, 'manifest.json');
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const abs = (p) => path.resolve(root, p);
  const fixture = (f) => {
    const out = { ...f, reference: abs(f.reference) };
    if (f.panorama) out.panorama = abs(f.panorama);
    if (f.mask) out.mask = abs(f.mask);
    return out;
  };
  return {
    dir: root,
    dxfPath: abs(raw.dxf),
    fixtures: (raw.fixtures ?? []).map(fixture),
    styleOnly: (raw.styleOnly ?? []).map(fixture),
  };
}
