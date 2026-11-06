// ASCII DXF R12 cut file: mm units, y up. Closed outlines are written as LINE entities.
import { markOutlines } from '../render/marks.js';
import { layoutInMm } from './pieces.js';

const f4 = (v) => v.toFixed(4);

export function cutPathDxf(layout, outline, { includeMarks = false } = {}) {
  const { heightMm, cuts, marks } = layoutInMm(layout, outline, includeMarks, markOutlines);
  const rows = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES'];
  const closed = (layer, pts) => pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    rows.push('0', 'LINE', '8', layer, '10', f4(p[0]), '20', f4(heightMm - p[1]), '30', '0',
      '11', f4(q[0]), '21', f4(heightMm - q[1]), '31', '0');
  });
  cuts.forEach((p) => closed('CUT', p));
  marks.forEach((p) => closed('REGISTRATION', p));
  rows.push('0', 'ENDSEC', '0', 'EOF');
  return `${rows.join('\n')}\n`;
}
