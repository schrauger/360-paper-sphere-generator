// Renders the README's "assembled sphere" image: each fixture panorama on a lit, slightly tilted
// sphere with the seam between the two pieces drawn as a thin paper join.
// Usage: node tools/readme-globe.mjs
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { MODEL_360CRAFT as model } from '../src/model/360craft.js';
import { makeModelGeometry } from '../src/model/geometry.js';
import { bandPhase } from '../src/sphere/band.js';
import { directionToEquirect } from '../src/sphere/orient.js';
import { sampleEquirect } from '../src/render/sample.js';
import { totalRotation } from '../src/render/warp.js';
import { loadPanorama } from '../test/support/golden-cases.js';

const SIZE = 420; // output px per globe
const SS = 3; // supersampling per axis
const TILT = (25 * Math.PI) / 180; // pole tipped toward the viewer
const LIGHT = normalize([-0.45, 0.55, 0.7]); // view space: x right, y up, z toward the viewer
const SEAM_WIDTH = 0.004; // seam half-width, sphere radians
const SEAM_DARKEN = 0.55;
const EXAMPLES = [
  { fixture: 'blue-marble', yaw: 0 },
  { fixture: 'pxhere-461435', yaw: 0 },
];
const OUT = new URL('../docs/img/', import.meta.url);

function normalize(v) {
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
}

/** View space → band frame: band +z (the pole) is up, tipped TILT toward the viewer. */
function viewToBand([x, y, z]) {
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  return [x, s * y - c * z, c * y + s * z];
}

function renderGlobe(pano, rotation, spiral) {
  const N = SIZE * SS;
  const acc = new Float64Array(SIZE * SIZE * 4);
  const uv = [0, 0];
  const rgb = new Float64Array(3);
  for (let j = 0; j < N; j++) {
    const y = 1 - ((j + 0.5) / N) * 2;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1;
      const r2 = x * x + y * y;
      if (r2 >= 1) continue;
      const z = Math.sqrt(1 - r2);
      const p = viewToBand([x, y, z]);
      const q = [0, 1, 2].map((k) => rotation[3 * k] * p[0] + rotation[3 * k + 1] * p[1] + rotation[3 * k + 2] * p[2]);
      directionToEquirect(q, pano.width, pano.height, uv);
      sampleEquirect(pano, uv[0], uv[1], rgb, 0);
      // Seam: distance to |phase| = π/2 (first order, as in src/render/preview.js).
      const theta = Math.acos(Math.max(-1, Math.min(1, p[2])));
      const st = Math.sin(theta);
      const dl = spiral.dLambda(theta);
      const dist = Math.abs(((Math.PI / 2 - Math.abs(bandPhase(p, spiral))) * st) / Math.sqrt(1 + dl * dl * st * st));
      const seam = dist < SEAM_WIDTH ? SEAM_DARKEN : 1;
      const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
      const shade = (0.35 + 0.75 * diffuse) * seam;
      const o = 4 * (Math.floor(j / SS) * SIZE + Math.floor(i / SS));
      for (let k = 0; k < 3; k++) acc[o + k] += Math.min(255, rgb[k] * shade);
      acc[o + 3] += 255;
    }
  }
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const n = SS * SS;
  for (let o = 0; o < acc.length; o += 4) {
    const a = acc[o + 3] / n;
    if (a === 0) continue;
    for (let k = 0; k < 3; k++) out[o + k] = Math.round(acc[o + k] / (acc[o + 3] / 255));
    out[o + 3] = Math.round(a);
  }
  return out;
}

const { spiral } = makeModelGeometry(model);
mkdirSync(OUT, { recursive: true });
const PAD = 24;
const globes = [];
for (const { fixture, yaw } of EXAMPLES) {
  const pano = await loadPanorama(fixture);
  globes.push(renderGlobe(pano, totalRotation(model, { yaw, pitch: 0, roll: 0 }), spiral));
}
const W = PAD + globes.length * (SIZE + PAD);
const H = SIZE + 2 * PAD;
const file = new URL('assembled-globes.png', OUT);
await sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
  .composite(globes.map((data, k) => ({ input: data, raw: { width: SIZE, height: SIZE, channels: 4 }, left: PAD + k * (SIZE + PAD), top: PAD })))
  .png({ compressionLevel: 9 })
  .toFile(file.pathname);
console.log(`wrote docs/img/assembled-globes.png (${W}x${H})`);
