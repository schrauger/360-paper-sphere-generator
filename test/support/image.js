// Image helpers for the local-data regression tests (sharp for decode/encode).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Decode to RGBAImage (opaque, 8-bit sRGB). */
export async function loadRGBA(file) {
  const { data, info } = await sharp(file).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    out[j] = data[i];
    out[j + 1] = data[i + 1];
    out[j + 2] = data[i + 2];
    out[j + 3] = 255;
  }
  return { width: info.width, height: info.height, data: out };
}

/** Write an RGBAImage or { width, height, channels: 3, data } as PNG, creating the directory. */
export async function savePNG(img, file, channels = 4) {
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels } }).png({ compressionLevel: 3 }).toFile(file);
}

/** Separable box max (dilate) or min (erode) of a Uint8Array mask, radius r px (Chebyshev). */
export function boxFilter(mask, w, h, r, mode) {
  const lo = mode === 'erode';
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let cnt = 0; // number of set pixels in the window
    for (let x = 0; x < Math.min(r, w); x++) cnt += mask[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) cnt += mask[row + x + r];
      if (x - r - 1 >= 0) cnt -= mask[row + x - r - 1];
      const size = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
      tmp[row + x] = lo ? (cnt === size && x - r >= 0 && x + r < w ? 1 : 0) : cnt > 0 ? 1 : 0;
    }
  }
  const cnts = new Int32Array(w);
  for (let y = 0; y < Math.min(r, h); y++) for (let x = 0; x < w; x++) cnts[x] += tmp[y * w + x];
  for (let y = 0; y < h; y++) {
    if (y + r < h) for (let x = 0; x < w; x++) cnts[x] += tmp[(y + r) * w + x];
    if (y - r - 1 >= 0) for (let x = 0; x < w; x++) cnts[x] -= tmp[(y - r - 1) * w + x];
    const size = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
    const full = y - r >= 0 && y + r < h;
    for (let x = 0; x < w; x++) out[y * w + x] = lo ? (cnts[x] === size && full ? 1 : 0) : cnts[x] > 0 ? 1 : 0;
  }
  return out;
}
