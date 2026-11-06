// Generates the README's diagrams (docs/img/*.svg) from the real geometry modules, so they cannot
// drift from the model. Usage: node tools/diagrams.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODEL_360CRAFT } from '../src/model/360craft.js';
import { makeModelGeometry } from '../src/model/geometry.js';
import { bandOf, seamPoint } from '../src/sphere/band.js';
import { tabPlacements } from '../src/layout/tabs.js';

const OUT = new URL('../docs/img/', import.meta.url);
const { spiral, centreLine, unrolling } = makeModelGeometry(MODEL_360CRAFT);
const L = centreLine.length;

const BAND0 = '#8fb8f5';
const BAND1 = '#f5c98f';
const INK = '#1f2933';
const CENTRE = '#c62828';
const GRID_S = '#1b5e20'; // s = const (across the band)
const GRID_D = '#6a1b9a'; // d = const (along the band)
const f = (v) => v.toFixed(2);
const FONT = 'font-family="Helvetica, Arial, sans-serif"';

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${FONT}>\n` +
  `<rect width="${w}" height="${h}" fill="#fff"/>\n${body}\n</svg>\n`;
const text = (x, y, s, { size = 13, anchor = 'start', fill = INK, weight = 'normal' } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${size}" text-anchor="${anchor}" fill="${fill}" font-weight="${weight}">${s}</text>`;
const poly = (pts, attrs) => `<polyline points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="none" ${attrs}/>`;

// ---- Orthographic view ------------------------------------------------------------------------
function makeView(azimuthDeg, elevationDeg, cx, cy, r) {
  const a = (azimuthDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  const v = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  const rn = Math.hypot(v[1], v[0]);
  const right = [-v[1] / rn, v[0] / rn, 0]; // z × v, normalised
  const up = [v[1] * right[2] - v[2] * right[1], v[2] * right[0] - v[0] * right[2], v[0] * right[1] - v[1] * right[0]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  return {
    cx, cy, r,
    visible: (p) => dot(p, v) > 0.02,
    screen: (p) => [cx + r * dot(p, right), cy - r * dot(p, up)],
    toSphere: (x, y) => {
      const sx = (x - cx) / r;
      const sy = -(y - cy) / r;
      const sz = Math.sqrt(1 - sx * sx - sy * sy);
      return [0, 1, 2].map((k) => sx * right[k] + sy * up[k] + sz * v[k]);
    },
  };
}

// Visible runs of a sphere-point curve as screen polylines; `keep` drops points (e.g. other band).
function curve(view, points, keep = () => true) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (view.visible(p) && keep(p)) run.push(view.screen(p));
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

// The disc shaded by band: one path of horizontal runs per band (compact, no raster image).
function bandDisc(view, cell = 2) {
  const paths = [[], []];
  for (let y = view.cy - view.r; y < view.cy + view.r; y += cell) {
    let runStart = null;
    let runBand = -1;
    const flush = (xEnd) => {
      if (runStart !== null) paths[runBand].push(`M${f(runStart)} ${f(y)}H${f(xEnd)}v${cell}H${f(runStart)}z`);
    };
    for (let x = view.cx - view.r; x < view.cx + view.r; x += cell) {
      const sx = (x + cell / 2 - view.cx) / view.r;
      const sy = (y + cell / 2 - view.cy) / view.r;
      const inside = sx * sx + sy * sy < 1;
      const band = inside ? bandOf(view.toSphere(x + cell / 2, y + cell / 2), spiral) : -1;
      if (band !== runBand) {
        flush(x);
        runStart = inside ? x : null;
        runBand = band;
      }
    }
    flush(view.cx + view.r);
  }
  return [
    `<clipPath id="disc"><circle cx="${view.cx}" cy="${view.cy}" r="${view.r}"/></clipPath>`,
    `<g clip-path="url(#disc)" shape-rendering="crispEdges">`,
    `<path d="${paths[0].join('')}" fill="${BAND0}"/><path d="${paths[1].join('')}" fill="${BAND1}"/></g>`,
    `<circle cx="${view.cx}" cy="${view.cy}" r="${view.r}" fill="none" stroke="${INK}" stroke-width="1.5"/>`,
  ].join('\n');
}

const sweep = (n, fn) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
const legendSwatch = (x, y, fill, label) =>
  `<rect x="${x}" y="${y - 11}" width="14" height="14" fill="${fill}" stroke="${INK}" stroke-width="0.8"/>${text(x + 20, y, label)}`;
const legendLine = (x, y, stroke, label, dash = '') =>
  `<line x1="${x}" y1="${y - 4}" x2="${x + 14}" y2="${y - 4}" stroke="${stroke}" stroke-width="2" ${dash}/>${text(x + 20, y, label)}`;

// ---- 1. Sphere with both bands and seams ----------------------------------------------------------
function sphereDiagram() {
  const view = makeView(20, 28, 230, 230, 200);
  const parts = [bandDisc(view)];
  for (const side of [1, -1]) {
    const seam = sweep(1500, (u) => seamPoint(spiral, Math.PI * u, side));
    for (const run of curve(view, seam)) parts.push(poly(run, `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"`));
  }
  // Centre lines: band 0's is the Clelia curve; band 1's is the same curve turned by π about z.
  const c0 = sweep(1500, (u) => { const t = Math.PI * u; return [Math.sin(t) * Math.cos(spiral.lambda(t)), Math.sin(t) * Math.sin(spiral.lambda(t)), Math.cos(t)]; });
  const c1 = c0.map(([x, y, z]) => [-x, -y, z]);
  for (const run of curve(view, c0)) parts.push(poly(run, `stroke="${CENTRE}" stroke-width="2" stroke-dasharray="6 4"`));
  for (const run of curve(view, c1)) parts.push(poly(run, `stroke="${CENTRE}" stroke-width="2" stroke-dasharray="6 4"`));
  parts.push(legendSwatch(450, 40, BAND0, 'band 0'), legendSwatch(450, 66, BAND1, 'band 1 (band 0 turned by π about z)'));
  parts.push(legendLine(450, 92, INK, 'seams: phase = ±π/2'), legendLine(450, 118, CENTRE, 'centre lines', 'stroke-dasharray="6 4"'));
  parts.push(text(450, 150, `Clelia spiral λ = ${spiral.rate.toFixed(3)}·θ`, { size: 12 }));
  parts.push(text(230, 456, 'Orthographic view, +z (north) up. Only the near side is drawn.', { size: 12, anchor: 'middle' }));
  return svg(800, 470, parts.join('\n'));
}

// ---- (s, d) grid, shared by the band and the flat piece ----------------------------------------------
const D_LINES = [-0.5, -0.4, -0.3, -0.2, -0.1, 0.1, 0.2, 0.3, 0.4, 0.5];
const S_LINES = Array.from({ length: 29 }, (_, i) => (i + 0.5) * (L / 29));
const D_MAX = 0.55;

// Does the strip chart map (s, d) to the sphere point's own nearest foot, inside band 0?
const inStrip = (s, d) => {
  const p = unrolling.stripToSphere({ cell: 'strip', s, d });
  if (bandOf(p, spiral) !== 0) return false;
  const rec = unrolling.sphereToStrip(p, s);
  return rec.ok && rec.cell === 'strip' && Math.abs(rec.s - s) < 1e-6;
};

function gridLines() {
  const lines = [];
  for (const d of D_LINES) lines.push({ kind: 'd', pts: sweep(900, (u) => [u * L, d]) });
  for (const s of S_LINES) lines.push({ kind: 's', pts: sweep(40, (u) => [s, -D_MAX + 2 * D_MAX * u]) });
  return lines.map((l) => ({ ...l, pts: l.pts.map(([s, d]) => ({ s, d, ok: inStrip(s, d) })) }));
}
const runsOf = (pts, map) => {
  const runs = [];
  let run = [];
  for (const p of pts) {
    const q = p.ok ? map(p) : null;
    if (q) run.push(q);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
};

const gridStyle = { s: `stroke="${GRID_S}" stroke-width="1"`, d: `stroke="${GRID_D}" stroke-width="1"` };
const gridLegend = (x, y) => [
  legendLine(x, y, CENTRE, 'centre line C (d = 0)'),
  legendLine(x, y + 26, GRID_D, 'd = const: along the band'),
  legendLine(x, y + 52, GRID_S, 's = const: across the band'),
].join('\n');

// ---- 2. One band with its centre line and (s, d) lines ---------------------------------------------------
function bandDiagram() {
  const view = makeView(20, 28, 230, 230, 200);
  const parts = [bandDisc(view)];
  // Wash out band 1 so band 0 reads as the subject.
  parts.push(`<circle cx="${view.cx}" cy="${view.cy}" r="${view.r}" fill="#fff" fill-opacity="0.55"/>`);
  parts.push(`<clipPath id="disc2"><circle cx="${view.cx}" cy="${view.cy}" r="${view.r}"/></clipPath>`);
  const grid = gridLines();
  for (const l of grid) for (const run of runsOf(l.pts, ({ s, d }) => {
    const p = unrolling.stripToSphere({ cell: 'strip', s, d });
    return view.visible(p) ? view.screen(p) : null;
  })) parts.push(poly(run, gridStyle[l.kind]));
  const c = sweep(900, (u) => centreLine.frame(u * L).C);
  for (const run of curve(view, c)) parts.push(poly(run, `stroke="${CENTRE}" stroke-width="2.4"`));
  parts.push(gridLegend(450, 60));
  parts.push(text(450, 160, 'p = cos d · C(s) + sin d · N(s)', { size: 12 }));
  parts.push(text(450, 178, 's: arc length along C, d: geodesic distance from C.', { size: 12 }));
  parts.push(text(24, 456, 'Band 0 on the sphere (band 1 washed out), same view as the previous figure.', { size: 12 }));
  return svg(800, 470, parts.join('\n'));
}

// ---- 3. The unrolled piece with the same grid ---------------------------------------------------------------
function flatDiagram() {
  const { edge } = makeModelGeometry(MODEL_360CRAFT).outline;
  const xs = edge.map((p) => p[0]);
  const ys = edge.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 30;
  const k = Math.min((780 - 2 * pad) / (x1 - x0), (560 - 2 * pad) / (y1 - y0));
  const W = Math.round((x1 - x0) * k + 2 * pad);
  const H = Math.round((y1 - y0) * k + 2 * pad);
  const toPx = ([x, y]) => [pad + (x - x0) * k, pad + (y1 - y) * k]; // flat is y-up
  const parts = [`<polygon points="${edge.map((p) => toPx(p).map(f).join(',')).join(' ')}" fill="${BAND0}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`];
  for (const l of gridLines()) for (const run of runsOf(l.pts, ({ s, d }) => toPx(unrolling.toFlat(s, d)))) parts.push(poly(run, gridStyle[l.kind]));
  parts.push(poly(sweep(900, (u) => toPx(unrolling.flatFrame(u * L).c)), `stroke="${CENTRE}" stroke-width="2.4"`));
  const north = toPx([0, 0]);
  parts.push(`<circle cx="${f(north[0])}" cy="${f(north[1])}" r="4" fill="${INK}"/>`, text(north[0] + 8, north[1] + 16, 'N', { size: 12, weight: 'bold' }));
  const lx = W - 300;
  const ly = H - 170;
  parts.push(gridLegend(lx, ly));
  parts.push(text(lx, ly + 84, 'N: north tip, the piece origin.', { size: 12 }));
  parts.push(text(lx, ly + 102, 'A strip point lies at c(s) + tan d · n(s).', { size: 12 }));
  parts.push(text(W / 2, H - 8, 'One piece unrolled: band 0 laid flat (tabs omitted), with the same (s, d) lines.', { size: 12, anchor: 'middle' }));
  return svg(W, H, parts.join('\n'));
}

// ---- 4. Tab close-up ------------------------------------------------------------------------------------------------
function tabDiagram() {
  const spec = MODEL_360CRAFT.tabs;
  const tabs = tabPlacements(unrolling, +1, spec);
  const i = 10; // mid-body, so the chord is the full body length
  const [t0, t1] = [tabs[i], tabs[i + 1]];
  // Frame of tab i's chord: origin A, x along A→B, y outward.
  const { A, B } = t0;
  const chord = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const tx = [(B[0] - A[0]) / chord, (B[1] - A[1]) / chord];
  const outwardLeft = (t0.outer[0][0] - A[0]) * -tx[1] + (t0.outer[0][1] - A[1]) * tx[0] > 0;
  const nx = outwardLeft ? [-tx[1], tx[0]] : [tx[1], -tx[0]];
  const local = (p) => [((p[0] - A[0]) * tx[0] + (p[1] - A[1]) * tx[1]) / chord, ((p[0] - A[0]) * nx[0] + (p[1] - A[1]) * nx[1]) / chord];
  const K = 300; // px per chord length
  const ox = 110;
  const oy = 270;
  const px = ([u, v]) => [ox + u * K, oy - v * K];
  const seam = unrolling.seams(0.002).pos.map(local).filter(([u]) => u > -0.6 && u < 2.9).map(px);
  const parts = [];
  parts.push(poly(seam, `stroke="${INK}" stroke-width="1.6" stroke-dasharray="5 3"`));
  for (const t of [t0, t1]) {
    parts.push(`<polygon points="${t.polygon.map((p) => px(local(p)).map(f).join(',')).join(' ')}" fill="${BAND1}" fill-opacity="0.7" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  const a = px(local(t0.A));
  const b = px(local(t0.B));
  const a2 = px(local(t1.A));
  const top = px(local(t0.outer[0]));
  const dim = (x1, y1, x2, y2, label, lx, ly, anchor = 'middle') =>
    `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${CENTRE}" stroke-width="1.4" marker-start="url(#arr)" marker-end="url(#arr)"/>` +
    text(lx, ly, label, { size: 13, fill: CENTRE, anchor, weight: 'bold' });
  parts.push(`<defs><marker id="arr" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L8 4L0 7z" fill="${CENTRE}"/></marker></defs>`);
  const yBelow = a[1] + 38;
  parts.push(dim(a[0], yBelow, b[0], yBelow, `length ${spec.length} R`, (a[0] + b[0]) / 2, yBelow + 18));
  parts.push(dim(a[0], yBelow + 52, a2[0], yBelow + 52, `pitch ${spec.pitch} R`, (a[0] + a2[0]) / 2, yBelow + 70));
  const hx = b[0] + 0.15 * K + 34;
  parts.push(dim(hx, b[1], hx, top[1], `height ≈ ${spec.outer.pos[0][2]}·chord`, hx + 8, (b[1] + top[1]) / 2, 'start'));
  const slantY = top[1] - 22;
  parts.push(`<line x1="${f(a[0])}" y1="${f(top[1] - 8)}" x2="${f(a[0])}" y2="${f(slantY - 6)}" stroke="${CENTRE}" stroke-width="0.8" stroke-dasharray="3 3"/>`);
  parts.push(dim(top[0], slantY, a[0], slantY, `slant ${spec.outer.pos[0][1]}·chord`, top[0], slantY - 8, 'start'));
  parts.push(text(a[0], a[1] + 16, 'A', { weight: 'bold', anchor: 'middle' }), text(b[0], b[1] + 16, 'B', { weight: 'bold', anchor: 'middle' }));
  parts.push(text(24, 28, 'Glue tab close-up (the + seam of one piece, tab 10 and its neighbour)', { size: 14, weight: 'bold' }));
  parts.push(text(24, 48, 'Length and pitch are sphere arc length along the seam; height and slant scale with the chord A→B. Dashed: the seam.', { size: 12 }));
  return svg(1080, 380, parts.join('\n'));
}

mkdirSync(OUT, { recursive: true });
for (const [name, content] of [['sphere', sphereDiagram()], ['band', bandDiagram()], ['flat', flatDiagram()], ['tab', tabDiagram()]]) {
  writeFileSync(new URL(`${name}.svg`, OUT), content);
  console.log(`wrote docs/img/${name}.svg (${(content.length / 1024).toFixed(0)} KB)`);
}
