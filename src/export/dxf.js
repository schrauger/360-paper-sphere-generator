// ASCII DXF R12 cut file: mm units, y up. Closed outlines are written as LINE entities (cut paths with near-duplicate points dropped and collinear runs merged).
import { markOutlines } from '../render/marks.js';
import { layoutInMm } from './pieces.js';
import { simplifyClosed, simplifyOpen } from './smooth.js';
import { tieRuns } from './ties.js';

const f4 = (v) => v.toFixed(4);

export function cutPathDxf(layout, outline, { includeMarks = false, tieMm = null } = {}) {
  const { heightMm, cuts, marks } = layoutInMm(layout, outline, includeMarks, markOutlines);
  // R12 LAYER table: every layer used by a LINE is declared (colour 7 = cut, 1 = registration).
  const layerEntry = (name, colour) => ['0', 'LAYER', '2', name, '70', '0', '62', String(colour), '6', 'CONTINUOUS'];
  const rows = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '2', ...layerEntry('CUT', 7), ...layerEntry('REGISTRATION', 1),
    '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  const line = (layer, p, q) => {
    rows.push('0', 'LINE', '8', layer, '10', f4(p[0]), '20', f4(heightMm - p[1]), '30', '0',
      '11', f4(q[0]), '21', f4(heightMm - q[1]), '31', '0');
  };
  const closed = (layer, pts) => pts.forEach((p, i) => line(layer, p, pts[(i + 1) % pts.length]));
  // With ties the cut is open runs between the tab-tip gaps; a path without tabs stays closed.
  const cut = (pts) => {
    const runs = tieMm ? tieRuns(pts, tieMm) : null;
    if (!runs) return closed('CUT', simplifyClosed(pts));
    return runs.forEach((r) => { const s = simplifyOpen(r); s.slice(1).forEach((q, i) => line('CUT', s[i], q)); });
  };
  cuts.forEach(cut);
  marks.forEach((p) => closed('REGISTRATION', p));
  rows.push('0', 'ENDSEC', '0', 'EOF');
  return `${rows.join('\n')}\n`;
}
