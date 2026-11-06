// Pure image helpers for the web app (importable in Node): decode sizing and DPI metadata.
import { checkAspect } from '../src/options.js';
import { rgbFromRgba, sheetPdf } from '../src/export/pdf.js';

/** Largest decoded panorama (pixels): the common browser canvas area limit. */
export const MAX_DECODE_PIXELS = 16_777_216;
/** Largest sheet the app will try to encode through a canvas (Chrome/Firefox limits). */
export const MAX_CANVAS_SIDE = 32_767;
export const MAX_CANVAS_AREA = 268_435_456;
export const TOO_LARGE_MESSAGE = 'Too large for this browser — lower the DPI or use the CLI';

/** True when a w × h canvas is beyond what browsers reliably allocate. */
export function tooLargeForCanvas(w, h) {
  return w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE || w * h > MAX_CANVAS_AREA;
}

/**
 * The size to decode a w × h panorama at: exactly 2:1 (via checkAspect, which throws a RangeError
 * "Panorama must be 2:1 (got W×H)" when the input is not) and the largest such size ≤ maxPixels.
 * { width, height, scaled } — scaled is true when the image is smaller than the 2:1-corrected input.
 */
export function fitDecodeSize(w, h, maxPixels = MAX_DECODE_PIXELS) {
  const aspect = checkAspect(w, h);
  if (!aspect.ok) throw new RangeError(aspect.message);
  if (aspect.width * aspect.height <= maxPixels) return { width: aspect.width, height: aspect.height, scaled: false };
  const height = Math.max(1, Math.floor(Math.sqrt(maxPixels / 2)));
  return { width: 2 * height, height, scaled: true };
}

/** The sheet (renderSheet's RGBA image) as a PDF page at dpi, with its RGB pixels deflated in the browser. */
export async function pdfFromImage(image, dpi) {
  const rgb = rgbFromRgba(image.data);
  const deflated = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  return sheetPdf({ widthPx: image.width, heightPx: image.height, dpi, rgbDeflated: deflated });
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The PNG with a pHYs chunk of round(dpi / 0.0254) px per metre (any existing pHYs is replaced). */
export function setPngDpi(bytes, dpi) {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (o) => String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
  const chunk = new Uint8Array(21); // length(4) type(4) data(9) crc(4)
  const cv = new DataView(chunk.buffer);
  const ppm = Math.round(dpi / 0.0254);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [bytes.subarray(0, 8)];
  let inserted = false;
  for (let o = 8; o < bytes.length;) {
    if (o + 12 > bytes.length) throw new Error('Truncated PNG file');
    const end = o + 12 + view.getUint32(o);
    if (end > bytes.length) throw new Error('Truncated PNG file');
    const t = type(o);
    if (t !== 'pHYs') {
      // pHYs must precede the first IDAT; the IHDR is always first.
      if (!inserted && t !== 'IHDR') {
        parts.push(chunk);
        inserted = true;
      }
      parts.push(bytes.subarray(o, end));
      if (!inserted && t === 'IHDR') {
        parts.push(chunk);
        inserted = true;
      }
    }
    o = end;
  }
  return concat(parts);
}

/** The JPEG with its JFIF APP0 density set to dpi × dpi (units = 1); APP0 is inserted when missing. */
export function setJpegDpi(bytes, dpi) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG file');
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif = (o) => bytes[o] === 0xff && bytes[o + 1] === 0xe0 && bytes[o + 4] === 0x4a && bytes[o + 5] === 0x46 && bytes[o + 6] === 0x49 && bytes[o + 7] === 0x46 && bytes[o + 8] === 0;
  if (isJfif(2)) {
    const out = bytes.slice();
    out.set([1, d >> 8, d & 255, d >> 8, d & 255], 13); // units, Xdensity, Ydensity
    return out;
  }
  const app0 = Uint8Array.from([
    0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, // APP0, length 16, 'JFIF\0', version 1.1
    1, d >> 8, d & 255, d >> 8, d & 255, 0, 0, // units, densities, no thumbnail
  ]);
  return concat([bytes.subarray(0, 2), app0, bytes.subarray(2)]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
