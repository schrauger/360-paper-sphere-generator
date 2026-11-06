// The options form ↔ RenderOptions and the equivalent CLI command. Pure (importable in Node).
import { PAGE_SIZES, normalizeOptions } from '../src/options.js';

/**
 * RenderOptions (normalizeOptions) from the form's entries (name → string, as FormData gives
 * them). Blank values mean "default"; an absent `outline` checkbox means false.
 * Entries: preset, page ('letter' | … | 'custom'), pageWidth, pageHeight (mm, for 'custom'), dpi,
 * diameter, margin, outline, bleedMode ('off' | 'auto' | 'mm'), bleedMm, marks, yaw, pitch, roll,
 * format, quality, cutFile. Two choice controls add a mode entry: `diameterMode` ('largest' ignores
 * `diameter`; anything else uses it) and `dpi` = 'custom' (use `dpiCustom`).
 */
export function formToOptions(entries) {
  const e = entries;
  const bleed = e.bleedMode === 'auto' ? 'auto' : e.bleedMode === 'mm' ? e.bleedMm : 'off';
  return normalizeOptions({
    preset: e.preset,
    page: e.page === 'custom' ? `${(e.pageWidth ?? '').trim()}x${(e.pageHeight ?? '').trim()}mm` : e.page,
    dpi: e.dpi === 'custom' ? e.dpiCustom : e.dpi,
    diameterMm: e.diameterMode === 'largest' ? '' : e.diameter,
    marginMm: e.margin,
    outline: e.outline !== undefined && e.outline !== '',
    bleed,
    marks: e.marks,
    orientation: { yaw: e.yaw, pitch: e.pitch, roll: e.roll },
    format: e.format,
    jpegQuality: e.quality,
    cutFile: e.cutFile,
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
    if (named !== 'letter') args.push('--page', named ?? `${o.page.widthMm}x${o.page.heightMm}mm`);
  }
  if (o.dpi !== 300) args.push('--dpi', String(o.dpi));
  if (!o.preset) {
    if (o.diameterMm !== null) args.push('--diameter', String(o.diameterMm));
    if (o.marginMm !== 6.35) args.push('--margin', String(o.marginMm));
  }
  if (!o.outline) args.push('--no-outline');
  if (o.bleedMm === 'auto') args.push('--bleed', 'auto');
  else if (o.bleedMm > 0) args.push('--bleed', String(o.bleedMm));
  if (!o.preset && o.marks !== 'none') args.push('--marks', o.marks);
  for (const axis of ['yaw', 'pitch', 'roll']) if (o.orientation[axis] !== 0) args.push(`--${axis}`, String(o.orientation[axis]));
  if (o.cutFile) args.push('--cut-file', o.cutFile);
  if (o.format === 'jpg' && o.jpegQuality !== 92) args.push('--quality', String(o.jpegQuality));
  return args.join(' ');
}
