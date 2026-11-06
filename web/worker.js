// Module worker: decodes the panorama, renders the three previews and the final sheet.
// Messages in:  { type: 'load', file } | { type: 'preview', rotation, viewRotation, options, sizes? } | { type: 'render', options }
// Messages out: { type: 'loaded', width, height, scaled, sourceWidth, sourceHeight }
//               { type: 'frames', sheet, panorama, globe, diameterMm, warnings, sheetMap? }  (ImageBitmaps)
//               { type: 'done', blob, cutFile, diameterMm, warnings }
//               { type: 'error', message, context: 'load' | 'preview' | 'render' }
import { MODEL_360CRAFT } from '../src/model/360craft.js';
import { makeModelGeometry } from '../src/model/geometry.js';
import { layoutSheet } from '../src/layout/sheet.js';
import { checkAspect } from '../src/options.js';
import { rgbFromRgba, sheetPdf } from '../src/export/pdf.js';
import { layoutOptionsFor, renderSheet, resolveBleed } from '../src/pipeline.js';
import { makeSheetPreview, renderGlobe, renderPanoramaSeams } from '../src/render/preview.js';
import { TOO_LARGE_MESSAGE, fitDecodeSize, setJpegDpi, setPngDpi, tooLargeForCanvas } from './imageio.js';

const model = MODEL_360CRAFT;
const PREVIEW_MAX_WIDTH = 2048; // R39: the previews never need the full-resolution texture
const DEFAULT_SIZES = { sheet: { width: 600, height: 900 }, panoramaWidth: 1200, globeSize: 400 };

let fullPano = null; // decoded at fitDecodeSize, used for the final render
let previewPano = null; // ≤ 2048 px wide copy for the previews
let pending = null; // the latest preview request (requests coalesce)
let scheduled = false;
let sheetCache = null; // { key, layoutKey, full, preview, sent }

const post = (message, transfer = []) => self.postMessage(message, transfer);
const fail = (context, e) => post({ type: 'error', context, message: messageFor(e) });

function messageFor(e) {
  const text = e instanceof Error ? e.message : String(e);
  return e instanceof RangeError && /allocation|memory|array length/i.test(text) ? TOO_LARGE_MESSAGE : text;
}

self.onmessage = (event) => {
  const m = event.data;
  if (m.type === 'load') load(m).catch((e) => fail('load', e));
  else if (m.type === 'preview') {
    pending = m;
    if (!scheduled) {
      scheduled = true;
      setTimeout(runPreview, 0);
    }
  } else if (m.type === 'render') render(m).catch((e) => fail('render', e));
};

async function load({ file }) {
  fullPano = previewPano = sheetCache = null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    const big = e instanceof RangeError || /memory|too large|size/i.test(String(e?.message));
    throw new Error(big
      ? `${file.name ?? 'This image'} is too large for this browser to decode — downscale it first or use the CLI`
      : `Cannot read ${file.name ?? 'this file'} as an image`);
  }
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const aspect = checkAspect(sourceWidth, sourceHeight);
    if (!aspect.ok) throw new Error(aspect.message);
    const size = fitDecodeSize(sourceWidth, sourceHeight);
    // Flatten onto white (transparency) and resample to the 2:1 decode size in one draw.
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error(TOO_LARGE_MESSAGE);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    // Deliberate (R41): decode at full (fitDecodeSize) resolution once at load so each render needn't re-decode.
    fullPano = { width: size.width, height: size.height, data: ctx.getImageData(0, 0, size.width, size.height).data };
    if (size.width <= PREVIEW_MAX_WIDTH) previewPano = fullPano;
    else {
      const small = new OffscreenCanvas(PREVIEW_MAX_WIDTH, PREVIEW_MAX_WIDTH / 2);
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(canvas, 0, 0, small.width, small.height);
      previewPano = { width: small.width, height: small.height, data: sctx.getImageData(0, 0, small.width, small.height).data };
    }
    post({ type: 'loaded', width: size.width, height: size.height, scaled: size.scaled, sourceWidth, sourceHeight });
  } finally {
    bitmap.close();
  }
}

const toBitmap = (img) => createImageBitmap(new ImageData(img.data, img.width, img.height));

// The cached sheet preview for the options (layout, bleed, outline and view size); rebuilt when any changes.
function sheetPreviewFor(options, size) {
  const geometry = makeModelGeometry(model);
  const layoutOptions = layoutOptionsFor(options);
  const layoutKey = JSON.stringify(layoutOptions);
  let full = sheetCache?.layoutKey === layoutKey ? sheetCache.full : null;
  if (!full) {
    const layout = layoutSheet(model, geometry.outline, layoutOptions); // RangeErrors (page too small, …) propagate
    full = { layout };
  }
  const { bleedR, warnings } = resolveBleed(options, full.layout, model);
  const key = JSON.stringify([layoutKey, options.outline, bleedR, size]);
  if (sheetCache?.key !== key) {
    const preview = makeSheetPreview(model, geometry, {
      maxWidth: size.width, maxHeight: size.height, outline: options.outline, bleedR, layoutOptions,
    });
    sheetCache = { key, layoutKey, full, preview, sent: false, warnings };
  }
  return sheetCache;
}

async function runPreview() {
  scheduled = false;
  const m = pending;
  pending = null;
  if (!m) return;
  if (!previewPano) {
    post({ type: 'preview-skipped' }); // every request gets one reply (a load may be in progress)
    return;
  }
  try {
    const sizes = { ...DEFAULT_SIZES, ...m.sizes };
    const cache = sheetPreviewFor(m.options, sizes.sheet);
    const { preview } = cache;
    const rotation = Float64Array.from(m.rotation);
    const viewRotation = Float64Array.from(m.viewRotation);
    const sheetImage = preview.render(previewPano, rotation);
    const panoramaImage = renderPanoramaSeams(previewPano, rotation, model, { width: sizes.panoramaWidth });
    const globeImage = renderGlobe(previewPano, rotation, viewRotation, model, { size: sizes.globeSize });
    const [sheet, panorama, globe] = await Promise.all([sheetImage, panoramaImage, globeImage].map(toBitmap));
    const message = {
      type: 'frames', sheet, panorama, globe,
      diameterMm: cache.full.layout.diameterMm,
      warnings: [...cache.full.layout.warnings, ...cache.warnings],
    };
    if (!cache.sent) {
      cache.sent = true;
      message.sheetMap = { width: preview.width, height: preview.height, ...preview.bandDirections };
    }
    post(message, [sheet, panorama, globe]);
  } catch (e) {
    fail('preview', e);
  }
}

async function render({ options }) {
  if (!fullPano) throw new Error('Load a panorama first');
  const { image, warnings, diameterMm, cutFile } = renderSheet(fullPano, options);
  if (options.format === 'pdf') {
    const rgb = rgbFromRgba(image.data);
    const deflated = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const pdf = sheetPdf({ widthPx: image.width, heightPx: image.height, dpi: options.dpi, rgbDeflated: deflated });
    post({ type: 'done', blob: new Blob([pdf], { type: 'application/pdf' }), cutFile, diameterMm, warnings });
    return;
  }
  if (tooLargeForCanvas(image.width, image.height)) throw new Error(TOO_LARGE_MESSAGE);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(TOO_LARGE_MESSAGE);
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const png = options.format === 'png';
  let bytes;
  try {
    const raw = await canvas.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: options.jpegQuality / 100 });
    bytes = new Uint8Array(await raw.arrayBuffer());
  } catch {
    throw new Error(TOO_LARGE_MESSAGE);
  }
  const encoded = png ? bytes[0] === 0x89 : bytes[0] === 0xff; // browsers hand back another type for a canvas they cannot encode
  if (!encoded) throw new Error(TOO_LARGE_MESSAGE);
  const out = png ? setPngDpi(bytes, options.dpi) : setJpegDpi(bytes, options.dpi);
  post({ type: 'done', blob: new Blob([out], { type: png ? 'image/png' : 'image/jpeg' }), cutFile, diameterMm, warnings });
}
