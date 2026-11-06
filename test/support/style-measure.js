// Print-style measurements on a sheet image (ours or a 360craft reference), the same three as
// tools/research/measure-style.py: tab grey, outline width, bleed width. Geometry arguments are
// in sheet px of the image: [{ tabs, cutPath, edge, pos, neg }] per piece.
import { createImage, fillPolygons, strokePolyline } from '../../src/render/raster.js';

const median = (a) => {
  const s = Float64Array.from(a).sort();
  return s[s.length >> 1];
};
const lumAt = (img, x, y) => {
  // bilinear luminance at continuous (x, y), pixel centres at +0.5, edge-clamped
  const { width: W, height: H, data } = img;
  const fx = Math.min(Math.max(x - 0.5, 0), W - 1.001);
  const fy = Math.min(Math.max(y - 0.5, 0), H - 1.001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const l = (i, j) => {
    const o = (j * W + i) * 4;
    return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  };
  return (l(x0, y0) * (1 - tx) + l(x0 + 1, y0) * tx) * (1 - ty) + (l(x0, y0 + 1) * (1 - tx) + l(x0 + 1, y0 + 1) * tx) * ty;
};

/** Pixels of the image mask (Uint8Array, 1 = covered) for polygons / thick lines. */
function coverage(w, h, draw) {
  const m = createImage(w, h, [0, 0, 0, 0]);
  draw(m);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = m.data[i * 4 + 3];
  return out;
}

/** Tab interior pixels ≥ margin px from the seam and the cut path: { mask, tab } (tab: any tab coverage ≥ 0.5). */
export function tabMasks(w, h, pieces, margin = 3) {
  const tab = coverage(w, h, (m) => {
    for (const p of pieces) fillPolygons(m, p.tabs, [0, 0, 0]);
  });
  const near = coverage(w, h, (m) => {
    for (const p of pieces) {
      strokePolyline(m, p.pos, 2 * margin, [0, 0, 0]);
      strokePolyline(m, p.neg, 2 * margin, [0, 0, 0]);
      strokePolyline(m, p.cutPath, 2 * margin, [0, 0, 0], { closed: true });
    }
  });
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = tab[i] > 250 && near[i] === 0 ? 1 : 0;
  return { inside, tab };
}

/** Median RGB over the tab interiors. */
export function tabGrey(img, pieces) {
  const { inside } = tabMasks(img.width, img.height, pieces);
  const ch = [[], [], []];
  for (let i = 0; i < inside.length; i += 7) {
    if (!inside[i]) continue;
    for (let c = 0; c < 3; c++) ch[c].push(img.data[i * 4 + c]);
  }
  return ch.map(median);
}

/** Median sub-pixel dark-run width (px) across the cut path (profiles every 3 px, away from vertices). */
export function outlineWidth(img, pieces) {
  const widths = [];
  const N = 181;
  const prof = new Float64Array(N);
  for (const p of pieces) {
    const path = p.cutPath;
    for (let i = 0; i < path.length; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[(i + 1) % path.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 12) continue;
      const tx = (bx - ax) / len;
      const ty = (by - ay) / len;
      const nx = -ty;
      const ny = tx;
      for (let s = 6; s <= len - 6; s += 3) {
        const cx = ax + tx * s;
        const cy = ay + ty * s;
        for (let k = 0; k < N; k++) {
          const t = -9 + k * 0.1;
          prof[k] = lumAt(img, cx + nx * t, cy + ny * t);
        }
        let j = 40;
        for (let k = 40; k <= 140; k++) if (prof[k] < prof[j]) j = k;
        const m = prof[j];
        if (m > 50) continue;
        const bgL = median(prof.slice(0, 15));
        const bgR = median(prof.slice(N - 15));
        if (Math.min(bgL, bgR) - m < 60) continue;
        const thrL = (m + bgL) / 2;
        const thrR = (m + bgR) / 2;
        let a = j;
        while (a > 0 && prof[a] < thrL) a--;
        let b = j;
        while (b < N - 1 && prof[b] < thrR) b++;
        if (a === 0 || b === N - 1) continue;
        const xl = a + ((thrL - prof[a]) / (prof[a + 1] - prof[a]));
        const xr = b - 1 + ((thrR - prof[b - 1]) / (prof[b] - prof[b - 1]));
        widths.push((xr - xl) * 0.1);
      }
    }
  }
  return { width: median(widths), samples: widths.length };
}

function insidePolygon(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Median distance (px) from the seam outward to where the image content gives way to tab grey
 * (a run of ≥ 4 grey pixels within the tab), over seam points with arc length (σ = index·step) in
 * [margin, length − margin].
 */
export function bleedWidth(img, pieces, grey, { step = 0.002, length, margin = 0.5, tolerance = 8 } = {}) {
  const { width: W, height: H, data } = img;
  const { tab } = tabMasks(W, H, pieces, 0);
  const isGrey = (x, y) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(x - 0.5)));
    const yi = Math.min(H - 1, Math.max(0, Math.round(y - 0.5)));
    const o = (yi * W + xi) * 4;
    return Math.max(Math.abs(data[o] - grey[0]), Math.abs(data[o + 1] - grey[1]), Math.abs(data[o + 2] - grey[2])) <= tolerance;
  };
  const inTab = (x, y) => tab[Math.min(H - 1, Math.max(0, Math.round(y - 0.5))) * W + Math.min(W - 1, Math.max(0, Math.round(x - 0.5)))] > 127;
  const out = [];
  const RUN = 4;
  const DS = 0.25;
  for (const p of pieces) {
    for (const side of [p.pos, p.neg]) {
      for (let i = 25; i < side.length - 25; i += 12) {
        const sigma = i * step;
        if (sigma < margin || sigma > length - margin) continue;
        const [x, y] = side[i];
        let tx = side[i + 3][0] - side[i - 3][0];
        let ty = side[i + 3][1] - side[i - 3][1];
        const l = Math.hypot(tx, ty);
        tx /= l;
        ty /= l;
        let nx = -ty;
        let ny = tx;
        if (insidePolygon(p.edge, x + nx * 2, y + ny * 2)) {
          nx = -nx;
          ny = -ny;
        }
        let run = 0;
        let found = -1;
        for (let d = 0; d < 40; d += DS) {
          const px = x + nx * d;
          const py = y + ny * d;
          if (!inTab(px, py)) break;
          run = isGrey(px, py) ? run + 1 : 0;
          if (run >= RUN / DS) {
            found = d - (RUN / DS - 1) * DS;
            break;
          }
        }
        if (found >= 0) out.push(found);
      }
    }
  }
  return { width: median(out), samples: out.length };
}
