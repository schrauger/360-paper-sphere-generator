#!/usr/bin/env node
// paper-sphere: turn an equirectangular panorama into a printable paper-sphere sheet.
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { OptionError, checkAspect, normalizeOptions } from './src/options.js';
import { renderSheet } from './src/pipeline.js';
import { rgbFromRgba, sheetPdf } from './src/export/pdf.js';

const USAGE = `Usage: paper-sphere <input> -o <out.pdf|out.png|out.jpg> [options]
  --preset original-low|original-high   360craft's own sheet sizes (ignores --page, --diameter, --marks)
  --page letter|a4|a3|tabloid|8x10|<W>x<H>mm   page size (default letter)
  --dpi N                               72–1200 (default 600)
  --diameter MM                         sphere diameter (default: largest that fits)
  --copies max|N                        spheres per sheet with --diameter: as many as fit (default) or exactly N
  --margin MM                           margin around the sheet (default 6.35; ignored with --marks silhouette, which uses 10 mm)
  --outline | --no-outline              cut outline (default on)
  --bleed MM|auto|off                   image bleed past the cut line (default auto)
  --marks silhouette                    Silhouette Studio Type 1 registration marks (10 mm inset; margin 10 mm)
  --yaw D --pitch D --roll D            panorama orientation in degrees
  --cut-file svg|dxf                    also write <out>.svg / <out>.dxf
  --ties                                leave a 0.5 mm uncut tie at the middle of every tab in the cut file
  --tie-width MM                        tie width, 0.1–3 mm (implies --ties)
  --quality Q                           JPEG quality 1–100 (default 92)`;

const FORMAT_OF_EXTENSION = new Map([['pdf', 'pdf'], ['png', 'png'], ['jpg', 'jpg'], ['jpeg', 'jpg']]);

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  preset: { type: 'string' }, page: { type: 'string' }, dpi: { type: 'string' }, diameter: { type: 'string' },
  margin: { type: 'string' }, copies: { type: 'string' },
  outline: { type: 'boolean' }, 'no-outline': { type: 'boolean' },
  bleed: { type: 'string' }, marks: { type: 'string' },
  yaw: { type: 'string' }, pitch: { type: 'string' }, roll: { type: 'string' },
  'cut-file': { type: 'string' }, ties: { type: 'boolean' }, 'tie-width': { type: 'string' }, quality: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

// node:util parseArgs reads `--pitch -20` as an ambiguous option, so a negative value would be rejected.
// Merge `--name` with a following numeric token into `--name=<value>` for every value-taking option.
function joinNegativeValues(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    const name = /^--([^=]+)$/.exec(token)?.[1];
    const takesValue = name !== undefined && OPTIONS[name]?.type === 'string';
    if (takesValue && next !== undefined && next.trim() !== '' && Number.isFinite(Number(next))) {
      out.push(`${token}=${next}`);
      i++;
    } else {
      out.push(token);
    }
  }
  return out;
}

const { values, positionals } = (() => {
  try {
    return parseArgs({ args: joinNegativeValues(process.argv.slice(2)), allowPositionals: true, options: OPTIONS });
  } catch (e) {
    return fail(e.message);
  }
})();

function fail(message) {
  console.error(message);
  process.exit(2);
}

async function main() {
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [input] = positionals;
  if (!input || positionals.length > 1 || !values.output) fail(USAGE);
  const out = values.output;
  const format = FORMAT_OF_EXTENSION.get(/\.([^./\\]+)$/.exec(out)?.[1].toLowerCase());
  if (!format) fail('Output must be a .pdf, .png, .jpg or .jpeg file (-o)');
  const options = normalizeOptions({
    preset: values.preset,
    page: values.page,
    dpi: values.dpi,
    diameterMm: values.diameter,
    marginMm: values.margin,
    copies: values.copies,
    outline: values['no-outline'] ? false : values.outline,
    bleed: values.bleed,
    marks: values.marks,
    orientation: { yaw: values.yaw, pitch: values.pitch, roll: values.roll },
    format,
    jpegQuality: values.quality,
    cutFile: values['cut-file'],
    ties: values['tie-width'] ?? values.ties,
  });

  const decode = (size) => {
    let img = sharp(input).toColourspace('srgb').flatten({ background: '#fff' }).ensureAlpha();
    if (size) img = img.resize(size.width, size.height, { fit: 'fill' });
    return img.raw().toBuffer({ resolveWithObject: true });
  };
  let { data, info } = await decode().catch((e) => fail(`Cannot read ${input}: ${e.message}`));
  const aspect = checkAspect(info.width, info.height);
  if (!aspect.ok) fail(aspect.message);
  if (aspect.width !== info.width || aspect.height !== info.height) ({ data, info } = await decode(aspect));
  const pano = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };

  const { image, warnings, diameterMm, copies, cutFile } = renderSheet(pano, options);
  if (options.tieMm && !options.cutFile) warnings.push('--ties has no effect without --cut-file svg|dxf');
  if (format === 'pdf') {
    const rgbDeflated = deflateSync(rgbFromRgba(image.data));
    await writeFile(out, sheetPdf({ widthPx: image.width, heightPx: image.height, dpi: options.dpi, rgbDeflated }));
  } else {
    const sheet = sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length), {
      raw: { width: image.width, height: image.height, channels: 4 },
    }).removeAlpha().withMetadata({ density: options.dpi });
    await (format === 'png' ? sheet.png() : sheet.jpeg({ quality: options.jpegQuality })).toFile(out);
  }
  if (cutFile) await writeFile(out.replace(/\.[^./\\]+$/, `.${cutFile.type}`), cutFile.content);
  console.error(`Sphere diameter: ${diameterMm.toFixed(1)} mm`);
  if (copies > 1) console.error(`${copies} spheres on this sheet`);
  else if (Number.isInteger(options.copies) && options.copies > 1) warnings.push('--copies needs --diameter; one sphere placed');
  for (const w of warnings) console.error(w);
}

main().catch((e) => {
  // Never a stack trace: the message only. Bad options and the layout's RangeErrors (page too small,
  // sheet too large, …) exit 2; anything else (unwritable output, encoder failure, …) exits 1.
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof OptionError || e instanceof RangeError) fail(message);
  console.error(message);
  process.exit(1);
});
