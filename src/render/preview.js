// Fast interactive previews for the web app: a cached print sheet, the panorama as a band view
// with seams, and a rotatable globe. Browser-safe (no node-only imports).
//
// The panorama view and the globe mark what is on each band: band 1 is tinted, and the two seams
// are drawn as lines (dashed where a glue tab sits on that seam, gap = every other DASH_PX view px).
import { makeModelGeometry } from '../model/geometry.js';
import { layoutSheet } from '../layout/sheet.js';
import { tabPlacements } from '../layout/tabs.js';
import { bandPhase } from '../sphere/band.js';
import { directionToEquirect, equirectToDirection } from '../sphere/orient.js';
import { blend, createImage, fillPolygons, strokePolyline, transformPts } from './raster.js';
import { drawMarks } from './marks.js';
import { makePixelMapper } from './warp.js';
import { sampleEquirect } from './sample.js';

const HALF_PI = Math.PI / 2;
const TINT = [59, 130, 246]; // #3b82f6, band 1
const TINT_MIX = 0.25;
const SEAM_RGB = [255, 255, 255];
const SEAM_PX = 1.5; // seam lines: within this many view px of the seam
const DASH_PX = 8; // dash period over tab intervals, view px
const SHADE_BASE = 0.85; // globe: Lambert shading from SHADE_BASE at the rim to 1 at the centre

// Per-view-pixel classes (panorama view and globe).
const PLAIN = 0;
const TINTED = 1;
const LINE = 2;

const clamp1 = (z) => Math.min(1, Math.max(-1, z));
const thetaOf = (p) => Math.acos(clamp1(p[2]));

/** Affine [a, b, c, d, e, f] scaled by s. */
const scaleAffine = ([a, b, c, d, e, f], s) => [a * s, b * s, c * s, d * s, e * s, f * s];

/** Numeric fields of a mark (px) scaled by s. */
const scaleMark = (m, s) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? v * s : v]));

/** out = M · v for a row-major Mat3 and a Vec3. */
function rotateInto(M, v, out) {
  out[0] = M[0] * v[0] + M[1] * v[1] + M[2] * v[2];
  out[1] = M[3] * v[0] + M[4] * v[1] + M[5] * v[2];
  out[2] = M[6] * v[0] + M[7] * v[1] + M[8] * v[2];
  return out;
}

/**
 * Sheet preview: the layout for `layoutOptions` (passed to layoutSheet) scaled to fit
 * maxWidth × maxHeight. The per-pixel band vectors and alpha are computed once; the static
 * layers (background, tabs; then the outline and marks) are pre-rendered.
 * Returns { width, height, layout, render(pano, rotation) → RGBAImage }; `rotation` is
 * totalRotation(model, ypr).
 */
export function makeSheetPreview(model, geometry, { maxWidth, maxHeight, outline = true, bleedR = 0, layoutOptions = {} }) {
  if (!(maxWidth >= 1 && maxHeight >= 1)) throw new RangeError('maxWidth and maxHeight must be ≥ 1 px');
  const full = layoutSheet(model, geometry.outline, layoutOptions);
  const s = Math.min(maxWidth / full.widthPx, maxHeight / full.heightPx);
  const width = Math.max(1, Math.floor(full.widthPx * s));
  const height = Math.max(1, Math.floor(full.heightPx * s));
  const layout = {
    ...full,
    widthPx: width,
    heightPx: height,
    pxPerR: full.pxPerR * s,
    pieces: full.pieces.map((p) => ({ band: p.band, affine: scaleAffine(p.affine, s) })),
    marks: full.marks.map((m) => scaleMark(m, s)),
  };

  const mapper = makePixelMapper(layout, geometry, { bleedR });
  const n = width * height;
  const alpha = new Uint8Array(n); // piece coverage × 255
  const vec = new Float32Array(3 * n); // band-frame sphere point of each piece pixel
  const dir = new Float64Array(3);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      const a = mapper.map(i + 0.5, j + 0.5, dir);
      if (a <= 0) continue;
      alpha[k] = Math.round(a * 255);
      vec[3 * k] = dir[0];
      vec[3 * k + 1] = dir[1];
      vec[3 * k + 2] = dir[2];
    }
  }

  const { style } = model;
  const base = createImage(width, height, [...style.background, 255]);
  for (const { affine } of layout.pieces) {
    fillPolygons(base, geometry.outline.tabs.map((tab) => transformPts(tab, affine)), style.tabColor);
  }
  const top = createImage(width, height, [0, 0, 0, 0]);
  if (outline) {
    const w = style.outlineWidth * layout.pxPerR;
    for (const { affine } of layout.pieces) {
      strokePolyline(top, transformPts(geometry.outline.cutPath, affine), w, style.outlineColor, { closed: true });
    }
  }
  drawMarks(top, layout.marks);

  function render(pano, rotation) {
    const out = { width, height, data: new Uint8ClampedArray(base.data) };
    const v = new Float64Array(3);
    const q = new Float64Array(3);
    const rgb = new Float64Array(3);
    const uv = [0, 0];
    for (let k = 0; k < n; k++) {
      const a = alpha[k];
      if (a === 0) continue;
      v[0] = vec[3 * k];
      v[1] = vec[3 * k + 1];
      v[2] = vec[3 * k + 2];
      directionToEquirect(rotateInto(rotation, v, q), pano.width, pano.height, uv);
      sampleEquirect(pano, uv[0], uv[1], rgb, 0);
      blend(out.data, 4 * k, rgb, a / 255);
    }
    for (let k = 0; k < n; k++) {
      const o = 4 * k;
      if (top.data[o + 3] === 0) continue;
      blend(out.data, o, [top.data[o], top.data[o + 1], top.data[o + 2]], top.data[o + 3] / 255);
    }
    return out;
  }

  return { width, height, layout, render };
}

// Per-model data shared by the panorama view and the globe: the geometry and, per seam (index 0:
// pos, 1: neg), the θ intervals of its glue tabs.
const modelCache = new WeakMap();

function modelData(model) {
  let data = modelCache.get(model);
  if (!data) {
    const geometry = makeModelGeometry(model);
    const { unrolling } = geometry;
    // A tab's θ interval from its base ends on the seam (inside the valid chart, R22/R34).
    const seamTabs = [1, -1].map((side) =>
      tabPlacements(unrolling, side, model.tabs).flatMap(({ A, B }) => {
        const th = [A, B].map((pt) => {
          const rec = unrolling.flatToStrip(pt[0], pt[1]);
          return rec.ok ? thetaOf(unrolling.stripToSphere(rec)) : NaN;
        });
        return th.some(Number.isNaN) ? [] : [[Math.min(...th), Math.max(...th)]];
      }),
    );
    data = { geometry, seamTabs, view: null };
    modelCache.set(model, data);
  }
  return data;
}

/**
 * Class of a view point p (band-frame unit vector) at `pixelAngle` sphere radians per view px:
 * PLAIN, TINTED (band 1) or LINE (on a seam, not in a dash gap). Seam proximity is the cheap
 * first-order phase-margin distance (R38): exact near the tips only within ~0.5 rad of a pole.
 */
function classify(p, { geometry, seamTabs }, pixelAngle) {
  const { spiral } = geometry;
  const phase = bandPhase(p, spiral);
  const band1 = Math.abs(phase) >= HALF_PI;
  const theta = thetaOf(p);
  const st = Math.sin(theta);
  const dl = spiral.dLambda(theta);
  const dist = ((HALF_PI - Math.abs(phase)) * st) / Math.sqrt(1 + dl * dl * st * st);
  if (Math.abs(dist) >= SEAM_PX * pixelAngle) return band1 ? TINTED : PLAIN;
  // The seam's side of band 0: band 1 is band 0 rotated by π about z.
  const q0 = band1 ? [-p[0], -p[1], p[2]] : p;
  const intervals = seamTabs[bandPhase(q0, spiral) >= 0 ? 0 : 1];
  const onTab = intervals.some(([lo, hi]) => theta >= lo && theta <= hi);
  if (onTab && Math.floor(theta / (DASH_PX * pixelAngle)) % 2 === 1) return band1 ? TINTED : PLAIN; // gap
  return LINE;
}

/** Panorama view at `width` × width/2: view pixel → band-frame direction → panorama colour. */
export function renderPanoramaSeams(pano, rotation, model, { width }) {
  if (!Number.isInteger(width) || width < 2 || width % 2) throw new RangeError(`width must be an even integer ≥ 2 (got ${width})`);
  const height = width / 2;
  const data = modelData(model);
  if (!data.view || data.view.width !== width) {
    const n = width * height;
    const dir = new Float32Array(3 * n);
    const code = new Uint8Array(n);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const k = j * width + i;
        const p = equirectToDirection(i + 0.5, j + 0.5, width, height);
        dir[3 * k] = p[0];
        dir[3 * k + 1] = p[1];
        dir[3 * k + 2] = p[2];
        code[k] = classify(p, data, (2 * Math.PI) / width);
      }
    }
    data.view = { width, dir, code };
  }
  const { dir, code } = data.view;
  const n = width * height;
  const out = { width, height, data: new Uint8ClampedArray(4 * n) };
  const m = rotation;
  const q = new Float64Array(3);
  const uv = [0, 0];
  const rgb = new Float64Array(3);
  const { data: px } = out;
  for (let k = 0; k < n; k++) {
    const x = dir[3 * k];
    const y = dir[3 * k + 1];
    const z = dir[3 * k + 2];
    q[0] = m[0] * x + m[1] * y + m[2] * z;
    q[1] = m[3] * x + m[4] * y + m[5] * z;
    q[2] = m[6] * x + m[7] * y + m[8] * z;
    // Unit q (the rotation keeps unit length): the same mapping as directionToEquirect, with
    // v = acos(z)·H/π = (π/2 − lat)·H/π, one trig call less.
    let u = ((Math.atan2(q[1], q[0]) + Math.PI) / (2 * Math.PI)) * pano.width;
    if (u >= pano.width) u -= pano.width;
    uv[0] = u;
    uv[1] = (Math.acos(Math.max(-1, Math.min(1, q[2]))) / Math.PI) * pano.height;
    sampleEquirect(pano, uv[0], uv[1], rgb, 0);
    if (code[k] !== PLAIN) shadeClass(rgb, code[k]);
    const o = 4 * k;
    px[o] = rgb[0];
    px[o + 1] = rgb[1];
    px[o + 2] = rgb[2];
    px[o + 3] = 255;
  }
  return out;
}

/** In place: the band-1 tint or the seam colour for the class `c`. */
function shadeClass(rgb, c) {
  if (c === TINTED) for (let k = 0; k < 3; k++) rgb[k] = rgb[k] * (1 - TINT_MIX) + TINT[k] * TINT_MIX;
  else if (c === LINE) for (let k = 0; k < 3; k++) rgb[k] = SEAM_RGB[k];
}

/**
 * Orthographic globe, size × size px, transparent outside the disk. The view pixel (x right,
 * y up, z toward the viewer) → p = apply(viewRotation, v) → panorama at apply(rotation, p).
 */
export function renderGlobe(pano, rotation, viewRotation, model, { size }) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`size must be an integer ≥ 1 (got ${size})`);
  const data = modelData(model);
  const pixelAngle = 2 / size;
  const out = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  const v = new Float64Array(3);
  const p = new Float64Array(3);
  const q = new Float64Array(3);
  const uv = [0, 0];
  const rgb = new Float64Array(3);
  for (let j = 0; j < size; j++) {
    const y = 1 - ((j + 0.5) / size) * 2;
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1;
      const r2 = x * x + y * y;
      if (r2 >= 1) continue;
      const z = Math.sqrt(1 - r2);
      v[0] = x;
      v[1] = y;
      v[2] = z;
      rotateInto(viewRotation, v, p);
      rotateInto(rotation, p, q);
      directionToEquirect(q, pano.width, pano.height, uv);
      sampleEquirect(pano, uv[0], uv[1], rgb, 0);
      shadeClass(rgb, classify(p, data, pixelAngle));
      const shade = SHADE_BASE + (1 - SHADE_BASE) * z;
      const o = 4 * (j * size + i);
      out.data[o] = rgb[0] * shade;
      out.data[o + 1] = rgb[1] * shade;
      out.data[o + 2] = rgb[2] * shade;
      out.data[o + 3] = 255;
    }
  }
  return out;
}
