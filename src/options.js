// Option normalisation shared by the CLI and the web app. Pure: no node-only imports.
import { TIE_WIDTH_MM, TIE_WIDTH_RANGE_MM } from './export/ties.js';

/** Page sizes in mm, [width, height]. */
export const PAGE_SIZES = { letter: [215.9, 279.4], a4: [210, 297], a3: [297, 420], tabloid: [279.4, 431.8] };

const PRESETS = ['original-low', 'original-high'];
const MARKS = ['none', 'silhouette'];
const CUT_FILES = ['svg', 'dxf'];
const FORMATS = ['pdf', 'png', 'jpg'];

/** Thrown for a bad option value; the message names the option (as the CLI flag). */
export class OptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OptionError';
  }
}

// '' / null / undefined count as "not given"; strings are parsed, so CLI text and numbers both work.
function num(value, name) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new OptionError(`${name} must be a number (got ${value})`);
  return n;
}
const given = (v) => v !== undefined && v !== null && v !== '';
const oneOf = (value, list, name) => {
  if (!list.includes(value)) throw new OptionError(`${name} must be one of ${list.join(', ')} (got ${value})`);
  return value;
};

function parsePage(page) {
  if (page && typeof page === 'object') {
    const { widthMm, heightMm } = page;
    if (!(widthMm > 0 && heightMm > 0 && Number.isFinite(widthMm) && Number.isFinite(heightMm))) {
      throw new OptionError('--page must have a positive width and height');
    }
    return { widthMm, heightMm };
  }
  const key = String(page).toLowerCase();
  if (Object.hasOwn(PAGE_SIZES, key)) return { widthMm: PAGE_SIZES[key][0], heightMm: PAGE_SIZES[key][1] };
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/.exec(key);
  if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return { widthMm: Number(m[1]), heightMm: Number(m[2]) };
  throw new OptionError(`--page must be ${Object.keys(PAGE_SIZES).join(', ')} or <W>x<H>mm (got ${page})`);
}

function parseBleed(bleed) {
  if (bleed === 'auto') return 'auto';
  if (bleed === 'off') return 0;
  const mm = num(bleed, '--bleed');
  if (mm < 0) throw new OptionError(`--bleed must be ≥ 0 mm, auto or off (got ${bleed})`);
  return mm;
}

// Spheres per sheet: 'max' (as many as fit) or a whole number ≥ 1.
function parseCopies(copies) {
  if (!given(copies) || copies === 'max') return 'max';
  const n = num(copies, '--copies');
  if (!Number.isInteger(n) || n < 1) throw new OptionError(`--copies must be max or a whole number ≥ 1 (got ${copies})`);
  return n;
}

// Tab ties: off (null) unless asked for; `true` means the default width.
function parseTies(ties) {
  if (!given(ties) || ties === false) return null;
  if (ties === true) return TIE_WIDTH_MM;
  const mm = num(ties, '--tie-width');
  const [lo, hi] = TIE_WIDTH_RANGE_MM;
  if (mm < lo || mm > hi) throw new OptionError(`--tie-width must be between ${lo} and ${hi} mm (got ${ties})`);
  return mm;
}

/**
 * RenderOptions from raw (CLI or web) input; every field is optional.
 * raw: { preset, page ('letter' | 'a4' | … | '<W>x<H>mm' | {widthMm, heightMm}), dpi, diameterMm,
 * marginMm, outline, bleed (mm | 'auto' | 'off', default 'auto'), marks ('none' | 'silhouette'),
 * orientation {yaw, pitch, roll} (degrees), format ('pdf' | 'png' | 'jpg', default 'pdf'), jpegQuality,
 * copies ('max' | N: spheres per sheet; with a diameter, as many as fit or exactly N), cutFile ('svg' | 'dxf'), ties (false | true | width in mm; true = 0.5 mm, valid 0.1–3) }.
 * A preset fixes the sheet at 360craft's size: page, diameterMm, marginMm and marks are then
 * ignored (and dpi only sets the metadata density and the mm ↔ px scale of bleed and the cut file).
 */
export function normalizeOptions(raw = {}) {
  const preset = given(raw.preset) ? oneOf(raw.preset, PRESETS, '--preset') : null;
  const dpi = given(raw.dpi) ? num(raw.dpi, '--dpi') : 300;
  if (dpi < 72 || dpi > 1200) throw new OptionError(`--dpi must be between 72 and 1200 (got ${dpi})`);
  const diameterMm = given(raw.diameterMm) ? num(raw.diameterMm, '--diameter') : null;
  if (diameterMm !== null && diameterMm <= 0) throw new OptionError(`--diameter must be > 0 mm (got ${diameterMm})`);
  const marginMm = given(raw.marginMm) ? num(raw.marginMm, '--margin') : 6.35;
  if (marginMm < 0) throw new OptionError(`--margin must be ≥ 0 mm (got ${marginMm})`);
  const o = raw.orientation ?? {};
  const orientation = {
    yaw: given(o.yaw) ? num(o.yaw, '--yaw') : 0,
    pitch: given(o.pitch) ? num(o.pitch, '--pitch') : 0,
    roll: given(o.roll) ? num(o.roll, '--roll') : 0,
  };
  const jpegQuality = given(raw.jpegQuality) ? num(raw.jpegQuality, '--quality') : 92;
  if (jpegQuality < 1 || jpegQuality > 100) throw new OptionError(`--quality must be between 1 and 100 (got ${jpegQuality})`);
  return {
    preset,
    page: parsePage(given(raw.page) ? raw.page : 'letter'),
    dpi,
    diameterMm,
    marginMm,
    outline: raw.outline ?? true,
    bleedMm: given(raw.bleed) ? parseBleed(raw.bleed) : 'auto',
    marks: given(raw.marks) ? oneOf(raw.marks, MARKS, '--marks') : 'none',
    orientation,
    format: given(raw.format) ? oneOf(raw.format, FORMATS, '--format') : 'pdf',
    jpegQuality,
    copies: parseCopies(raw.copies),
    cutFile: given(raw.cutFile) ? oneOf(raw.cutFile, CUT_FILES, '--cut-file') : null,
    tieMm: parseTies(raw.ties),
  };
}

/**
 * Check a panorama's size against 2:1. Within 1%: { ok: true, width, height } with the nearest
 * exact 2:1 size (the same size when it already is 2:1); otherwise { ok: false, message }.
 */
export function checkAspect(w, h) {
  if (!(w > 0 && h > 0) || Math.abs(w / (2 * h) - 1) > 0.01) {
    return { ok: false, message: `Panorama must be 2:1 (got ${w}×${h})` };
  }
  const height = Math.round((w / 2 + h) / 2);
  return { ok: true, width: 2 * height, height };
}
