// Equirectangular panorama sampling.

/**
 * Bilinear sample of the RGBAImage `pano` at (u, v) in pixel-edge coordinates (pixel centres
 * at +0.5). u wraps modulo W (longitude), v is clamped to [0.5, H − 0.5] (latitude: no wrap
 * over the poles). Writes R, G, B (floats, 0–255) to out[o], out[o + 1], out[o + 2].
 */
export function sampleEquirect(pano, u, v, out, o = 0) {
  const { width: W, height: H, data } = pano;
  const x = u - 0.5;
  const y = Math.min(Math.max(v, 0.5), H - 0.5) - 0.5;
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const fx = x - xf;
  const fy = y - yf;
  const i0 = ((xf % W) + W) % W;
  const i1 = i0 + 1 === W ? 0 : i0 + 1;
  const j0 = yf;
  const j1 = Math.min(yf + 1, H - 1);
  const a = (j0 * W + i0) * 4;
  const b = (j0 * W + i1) * 4;
  const c = (j1 * W + i0) * 4;
  const d = (j1 * W + i1) * 4;
  const wa = (1 - fx) * (1 - fy);
  const wb = fx * (1 - fy);
  const wc = (1 - fx) * fy;
  const wd = fx * fy;
  out[o] = wa * data[a] + wb * data[b] + wc * data[c] + wd * data[d];
  out[o + 1] = wa * data[a + 1] + wb * data[b + 1] + wc * data[c + 1] + wd * data[d + 1];
  out[o + 2] = wa * data[a + 2] + wb * data[b + 2] + wc * data[c + 2] + wd * data[d + 2];
}
