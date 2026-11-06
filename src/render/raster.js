// Small dependency-free anti-aliased rasteriser for the print sheet.
// Images are RGBAImage = { width, height, data: Uint8ClampedArray }, row-major RGBA.
// Coordinates are px with the origin at the top-left; pixel (i, j) has its centre at (i + 0.5, j + 0.5).

const SUB = 4; // subsamples per pixel axis for polygon fill

export function createImage(w, h, rgba = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (rgba[0] || rgba[1] || rgba[2] || rgba[3]) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
      data[i + 3] = rgba[3];
    }
  }
  return { width: w, height: h, data };
}

export function transformPts(pts, [a, b, c, d, e, f]) {
  return pts.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
}

// Source-over blend of `rgb` at alpha `a` (0..1) into pixel offset `o`.
export function blend(data, o, rgb, a) {
  if (a <= 0) return;
  const da = data[o + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  const k = da * (1 - a);
  data[o] = (rgb[0] * a + data[o] * k) / oa;
  data[o + 1] = (rgb[1] * a + data[o + 1] * k) / oa;
  data[o + 2] = (rgb[2] * a + data[o + 2] * k) / oa;
  data[o + 3] = oa * 255;
}

/**
 * Fill polygons (implicitly closed) with the non-zero winding rule over all of them together,
 * 4x4 subsample coverage per pixel, source-over blend. Scanline / edge-table: cost is
 * O(edges log edges + covered area + crossings), independent of area x vertex count.
 */
export function fillPolygons(img, polygons, rgb, { opacity = 1 } = {}) {
  const { width: W, height: H, data } = img;
  const maxS = H * SUB; // sub-scanlines are 0..maxS-1, centre y = (s + 0.5) / SUB
  const edges = [];
  for (const poly of polygons) {
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      let [x0, y0] = poly[i];
      let [x1, y1] = poly[(i + 1) % n];
      if (y0 === y1) continue;
      let dir = 1;
      if (y0 > y1) {
        [x0, y0, x1, y1] = [x1, y1, x0, y0];
        dir = -1;
      }
      const s0 = Math.max(0, Math.ceil(y0 * SUB - 0.5));
      const s1 = Math.min(maxS - 1, Math.ceil(y1 * SUB - 0.5) - 1);
      if (s0 > s1) continue;
      edges.push({ x0, y0, slope: (x1 - x0) / (y1 - y0), dir, s0, s1 });
    }
  }
  if (!edges.length) return;
  edges.sort((p, q) => p.s0 - q.s0);

  let sMin = edges[0].s0;
  let sMax = 0;
  for (const e of edges) if (e.s1 > sMax) sMax = e.s1;

  const counts = new Uint8Array(W); // samples inside per pixel in the current row
  let rowMin = W;
  let rowMax = -1;
  let active = [];
  let next = 0;
  let xs = []; // crossings [x, dir] for the current sub-scanline

  const flushRow = (row) => {
    if (rowMax >= 0) {
      for (let x = rowMin; x <= rowMax; x++) {
        const c = counts[x];
        if (c) {
          blend(data, (row * W + x) * 4, rgb, (c / (SUB * SUB)) * opacity);
          counts[x] = 0;
        }
      }
    }
    rowMin = W;
    rowMax = -1;
  };

  let curRow = Math.floor(sMin / SUB);
  for (let s = sMin; s <= sMax; s++) {
    const row = Math.floor(s / SUB);
    if (row !== curRow) {
      flushRow(curRow);
      curRow = row;
    }
    while (next < edges.length && edges[next].s0 <= s) active.push(edges[next++]);
    active = active.filter((e) => e.s1 >= s);
    if (!active.length) continue;
    const y = (s + 0.5) / SUB;
    xs.length = 0;
    for (const e of active) xs.push([e.x0 + (y - e.y0) * e.slope, e.dir]);
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (wind === 0) continue;
      // samples at x = (j + 0.5) / SUB inside [xs[i], xs[i+1])
      let j0 = Math.ceil(xs[i][0] * SUB - 0.5);
      let j1 = Math.ceil(xs[i + 1][0] * SUB - 0.5) - 1;
      if (j0 < 0) j0 = 0;
      if (j1 > W * SUB - 1) j1 = W * SUB - 1;
      for (let j = j0; j <= j1; j++) {
        const px = (j / SUB) | 0;
        counts[px]++;
        if (px < rowMin) rowMin = px;
        if (px > rowMax) rowMax = px;
      }
    }
  }
  flushRow(curRow);
}

const BIN = 16;

/**
 * Stroke a polyline with round joins/caps. Coverage = clamp(width/2 - dist + 0.5, 0, 1), dist from the
 * pixel centre to the nearest segment. Segments are binned into a uniform grid so each pixel only
 * tests nearby segments and cost is proportional to the stroke's area.
 */
export function strokePolyline(img, pts, width, rgb, { closed = false } = {}) {
  const { width: W, height: H, data } = img;
  const n = pts.length;
  if (n < 2 || width <= 0) return;
  const segs = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    segs.push(ax, ay, bx, by);
  }
  const reach = width / 2 + 0.5;
  const nbx = Math.ceil(W / BIN);
  const nby = Math.ceil(H / BIN);
  const bins = new Map();
  for (let k = 0; k < segs.length; k += 4) {
    const bx0 = Math.max(0, Math.floor((Math.min(segs[k], segs[k + 2]) - reach) / BIN));
    const bx1 = Math.min(nbx - 1, Math.floor((Math.max(segs[k], segs[k + 2]) + reach) / BIN));
    const by0 = Math.max(0, Math.floor((Math.min(segs[k + 1], segs[k + 3]) - reach) / BIN));
    const by1 = Math.min(nby - 1, Math.floor((Math.max(segs[k + 1], segs[k + 3]) + reach) / BIN));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const key = by * nbx + bx;
        let list = bins.get(key);
        if (!list) bins.set(key, (list = []));
        list.push(k);
      }
    }
  }
  const half = width / 2;
  for (const [key, list] of bins) {
    const bx = key % nbx;
    const by = (key - bx) / nbx;
    const xEnd = Math.min(W, (bx + 1) * BIN);
    const yEnd = Math.min(H, (by + 1) * BIN);
    for (let y = by * BIN; y < yEnd; y++) {
      for (let x = bx * BIN; x < xEnd; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let best = Infinity;
        for (const k of list) {
          const ax = segs[k];
          const ay = segs[k + 1];
          const dx = segs[k + 2] - ax;
          const dy = segs[k + 3] - ay;
          const len2 = dx * dx + dy * dy;
          let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - (ax + t * dx);
          const ey = py - (ay + t * dy);
          const d2 = ex * ex + ey * ey;
          if (d2 < best) best = d2;
        }
        const cov = half - Math.sqrt(best) + 0.5;
        if (cov > 0) blend(data, (y * W + x) * 4, rgb, cov > 1 ? 1 : cov);
      }
    }
  }
}
