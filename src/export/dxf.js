// ASCII DXF R12 cut file: mm units, y up. Closed outlines are written as LINE entities (cut paths with near-duplicate points dropped and collinear runs merged).
import { markOutlines } from '../render/marks.js';
import { layoutInMm } from './pieces.js';
import { simplifyClosed } from './smooth.js';

const f4 = (v) => v.toFixed(4);

export function cutPathDxf(layout, outline, { includeMarks = false } = {}) {
  const { heightMm, cuts, marks } = layoutInMm(layout, outline, includeMarks, markOutlines);
  // R12 LAYER table: every layer used by a LINE is declared (colour 7 = cut, 1 = registration).
  const layerEntry = (name, colour) => ['0', 'LAYER', '2', name, '70', '0', '62', String(colour), '6', 'CONTINUOUS'];
  const rows = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '2', ...layerEntry('CUT', 7), ...layerEntry('REGISTRATION', 1),
    '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  const closed = (layer, pts) => pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    rows.push('0', 'LINE', '8', layer, '10', f4(p[0]), '20', f4(heightMm - p[1]), '30', '0',
      '11', f4(q[0]), '21', f4(heightMm - q[1]), '31', '0');
  });
  cuts.forEach((p) => closed('CUT', simplifyClosed(p)));
  marks.forEach((p) => closed('REGISTRATION', p));
  rows.push('0', 'ENDSEC', '0', 'EOF');
  return `${rows.join('\n')}\n`;
}
