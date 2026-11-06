// Dump the model's seam, tab and cut-path polylines in canonical low-res sheet px for
// measure-style.py. Writes test-output/research/style-geometry.json (gitignored).
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODEL_360CRAFT, pieceAffine } from '../../src/model/360craft.js';
import { makeModelGeometry } from '../../src/model/geometry.js';

const { layoutLow } = MODEL_360CRAFT;
const { unrolling, outline } = makeModelGeometry(MODEL_360CRAFT);
const seams = unrolling.seams(0.002);
const out = layoutLow.pieces.map((piece) => {
  const [a, b, c, d, e, f] = pieceAffine(piece, layoutLow.pxPerR);
  const to = (pts) => pts.map(([X, Y]) => [a * X + c * Y + e, b * X + d * Y + f]);
  return { band: piece.band, pos: to(seams.pos), neg: to(seams.neg), edge: to(outline.edge), tabs: outline.tabs.map(to), cutPath: to(outline.cutPath) };
});
// sec²d of the strip record on the seams away from the tips: the flat/sphere stretch across the
// edge, so a sphere bleed of b R prints as b·kEdge·pxPerR sheet px (ruling R25).
const ks = [];
const L = unrolling.length;
for (const side of [seams.pos, seams.neg]) {
  for (let i = 0; i < side.length; i++) {
    if (i * 0.002 < 0.5 || i * 0.002 > L - 0.5 || i % 25) continue;
    const rec = unrolling.flatToStrip(side[i][0], side[i][1], i * 0.002);
    if (rec.ok && rec.cell === 'strip') ks.push(1 / Math.cos(rec.d) ** 2);
  }
}
ks.sort((p, q) => p - q);
const kEdge = ks[ks.length >> 1];
mkdirSync('test-output/research', { recursive: true });
writeFileSync('test-output/research/style-geometry.json', JSON.stringify({ pxPerR: layoutLow.pxPerR, kEdge, seamLength: L, pieces: out }));
console.log(`kEdge ${kEdge} from ${ks.length} samples`);
console.log('wrote test-output/research/style-geometry.json');
