// The options form ↔ RenderOptions and the equivalent CLI command. Pure (importable in Node).
import { PAGE_SIZES, normalizeOptions } from '../src/options.js';
import { TIE_WIDTH_MM } from '../src/export/ties.js';
import { SILHOUETTE_PRESETS } from '../src/layout/silhouette-presets.js';

/**
 * RenderOptions (normalizeOptions) from the form's entries (name → string, as FormData gives
 * them). Blank values mean "default"; an absent `outline` checkbox means false.
 * Entries: page ('letter' | … | 'custom'), pageWidth, pageHeight (in `pageUnit`, 'mm' (default) | 'in', for 'custom'), dpi,
 * diameter, margin, outline, bleedMode ('auto' (the default when blank) | 'off' | 'mm'), bleedMm, marks, yaw, pitch, roll,
 * format, quality, cutFile, ties (checkbox), tieWidth (mm, blank = 0.5), copies ('max' | N, with a diameter). Two choice controls add a mode entry: `diameterMode` ('largest' ignores
 * `diameter`; `preset-<mm>` is a Silhouette preset size; anything else uses `diameter`) and `dpi` = 'custom' (use `dpiCustom`).
 */
const MM_PER_INCH = 25.4;

/** '<W>x<H>mm' for the custom page fields, converting from inches when pageUnit is 'in' (blank or non-numeric stays as typed so normalizeOptions rejects it). */
function customPage(e) {
  const inches = e.pageUnit === 'in';
  const mm = (v) => {
    const t = (v ?? '').trim();
    return inches && t !== '' && Number.isFinite(Number(t)) ? String(Math.round(Number(t) * MM_PER_INCH * 1000) / 1000) : t;
  };
  return `${mm(e.pageWidth)}x${mm(e.pageHeight)}mm`;
}

export function formToOptions(entries) {
  const e = entries;
  const mode = e.diameterMode ?? '';
  const diameter = mode === 'largest' ? '' : mode.startsWith('preset-') ? mode.slice('preset-'.length) : e.diameter;
  const bleed = e.bleedMode === 'off' ? 'off' : e.bleedMode === 'mm' ? e.bleedMm : 'auto';
  return normalizeOptions({
    page: e.page === 'custom' ? customPage(e) : e.page,
    dpi: e.dpi === 'custom' ? e.dpiCustom : e.dpi,
    diameterMm: diameter,
    marginMm: e.margin,
    copies: e.copies,
    outline: e.outline !== undefined && e.outline !== '',
    bleed,
    marks: e.marks,
    orientation: { yaw: e.yaw, pitch: e.pitch, roll: e.roll },
    format: e.format,
    jpegQuality: e.quality,
    cutFile: e.cutFile === 'studio3' ? '' : e.cutFile, // .studio3 is a web-only download, not a generated cut file
    ties: e.ties !== undefined && e.ties !== '' ? (e.tieWidth || true) : false,
  });
}

const shellQuote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/**
 * The `paper-sphere` command line that reproduces `options` (a normalizeOptions result) for the
 * input file `inputName`; only flags that differ from the defaults are written. Negative numbers
 * are separate tokens, which the CLI accepts.
 */
export function cliCommandFor(options, inputName) {
  const o = options;
  const args = ['paper-sphere', shellQuote(inputName), '-o', `sheet.${o.format}`];
  if (o.preset) args.push('--preset', o.preset);
  else {
    const named = Object.entries(PAGE_SIZES).find(([, [w, h]]) => w === o.page.widthMm && h === o.page.heightMm)?.[0];
    const silhouettePreset = named === 'letter' && o.marks === 'silhouette' && SILHOUETTE_PRESETS.letter.includes(o.diameterMm);
    if (named !== 'letter' || silhouettePreset) args.push('--page', named ?? `${o.page.widthMm}x${o.page.heightMm}mm`);
  }
  if (o.dpi !== 600) args.push('--dpi', String(o.dpi));
  if (!o.preset) {
    if (o.diameterMm !== null) args.push('--diameter', String(o.diameterMm));
    if (o.diameterMm !== null && o.copies !== 'max') args.push('--copies', String(o.copies));
    if (o.marginMm !== 6.35) args.push('--margin', String(o.marginMm));
  }
  if (!o.outline) args.push('--no-outline');
  if (o.bleedMm === 0) args.push('--bleed', 'off'); // auto is the default and needs no flag
  else if (o.bleedMm !== 'auto') args.push('--bleed', String(o.bleedMm));
  if (!o.preset && o.marks !== 'none') args.push('--marks', o.marks);
  for (const axis of ['yaw', 'pitch', 'roll']) if (o.orientation[axis] !== 0) args.push(`--${axis}`, String(o.orientation[axis]));
  if (o.cutFile) args.push('--cut-file', o.cutFile);
  if (o.tieMm === TIE_WIDTH_MM) args.push('--ties'); // the default width needs no value
  else if (o.tieMm !== null) args.push('--tie-width', String(o.tieMm));
  if (o.format === 'jpg' && o.jpegQuality !== 92) args.push('--quality', String(o.jpegQuality));
  return args.join(' ');
}
