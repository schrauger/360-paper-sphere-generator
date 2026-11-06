// Synthetic images for render tests.

/**
 * W×H RGBA panorama: R ramps with longitude (column), G with latitude (row), B is a 32 px
 * checker (64 / 192). Every channel stays ≥ 16, so it contains no pure black: a (0,0,0)
 * pixel in a render means a NaN or a missed write.
 */
export function gradientPanorama(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      data[o] = Math.round(16 + (223 * (i + 0.5)) / W);
      data[o + 1] = Math.round(16 + (223 * (j + 0.5)) / H);
      data[o + 2] = ((i >> 5) + (j >> 5)) % 2 ? 192 : 64;
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

/** w×h opaque RGBA image of one colour. */
export function solidImage(w, h, rgb) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
