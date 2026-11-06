// Packing several sphere pairs on one sheet. Pure geometry in mm: a pair (both pieces' cut paths)
// is copied on a grid whose x and y steps are (heuristically) the smallest at which the actual cut outlines of all
// neighbours (diagonals too) stay COPY_GAP_MM apart, so the S shapes may nest. Both the pair and
// the pair turned 90° are tried. Deterministic, and independent of the output DPI.

/** Cut outlines of neighbouring spheres keep at least this far apart (mm). */
export const COPY_GAP_MM = 3;
const SCAN_STEP_MM = 0.1; // resolution of the grid-step search
const COARSE_STEP_MM = 1;
const THIN_MM = 0.02; // the step search drops outline points closer than this to the last kept one (small spheres have very dense outlines), and widens the gap by 1.5x as much to compensate
/** The most pairs on a sheet: 120 pieces, the render guide's limit. */
export const MAX_COPIES = 60;
const PRE_STRIDE = 12; // a cheap pass over every n-th point rejects most colliding offsets

const dist2Seg = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
};

// Spatial hash of the closed rings' segments (cell = gap), answering "is p closer than gap?".
function makeIndex(rings, gap) {
  const cells = new Map();
  const key = (ix, iy) => (ix + 100000) * 200003 + (iy + 100000);
  const segs = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const id = segs.push([ax, ay, bx, by]) - 1;
      const x0 = Math.floor(Math.min(ax, bx) / gap);
      const x1 = Math.floor(Math.max(ax, bx) / gap);
      const y0 = Math.floor(Math.min(ay, by) / gap);
      const y1 = Math.floor(Math.max(ay, by) / gap);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const k = key(ix, iy);
          const list = cells.get(k);
          if (list) list.push(id);
          else cells.set(k, [id]);
        }
      }
    }
  }
  const g2 = gap * gap;
  const near = (px, py) => {
    const cx = Math.floor(px / gap);
    const cy = Math.floor(py / gap);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const list = cells.get(key(ix, iy));
        if (!list) continue;
        for (const id of list) {
          const s = segs[id];
          if (dist2Seg(px, py, s[0], s[1], s[2], s[3]) < g2) return true;
        }
      }
    }
    return false;
  };
  return { near };
}

/** Total area enclosed by the pieces' outlines (mm²). */
export const pairArea = (pieces) => pieces.reduce((sum, ring) => sum + Math.abs(ring.reduce((a, [x, y], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length];
  return a + (x * y2 - x2 * y);
}, 0)) / 2, 0);

// The ring without points closer than THIN_MM to the last kept one.
const thinned = (rings) => rings.map((ring) => {
  const out = [ring[0]];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= THIN_MM) out.push(p);
  }
  return out;
});

const boundsOf = (pts) => pts.reduce((m, [x, y]) => [Math.min(m[0], x), Math.min(m[1], y), Math.max(m[2], x), Math.max(m[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);

/**
 * One orientation of the pair: pieces (arrays of [x, y] mm, centred on the pair's bounding box),
 * its size, and the grid steps (x first, then y given x).
 */
function makeCandidate(pieces, rot90, realGap) {
  const gap = realGap + 1.5 * THIN_MM;
  const turn = ([x, y]) => (rot90 ? [-y, x] : [x, y]);
  const rings = pieces.map((ring) => ring.map(turn));
  const all = rings.flat();
  const bb = boundsOf(all);
  const bw = bb[2] - bb[0];
  const bh = bb[3] - bb[1];
  // Thinned rings for the step search; `all` (full) stays for validating placements.
  const index = makeIndex(thinned(rings), gap);
  const scan = thinned(rings).flat();
  const pre = scan.filter((_, i) => i % PRE_STRIDE === 0);

  // Is the pair at offset (ox, oy) from itself at least `gap` away from the pair at the origin?
  const clear = (ox, oy) => {
    if (Math.abs(ox) >= bw + gap || Math.abs(oy) >= bh + gap) return true;
    for (const pts of [pre, scan]) {
      for (const [x, y] of pts) {
        if (index.near(x + ox, y + oy) || index.near(x - ox, y - oy)) return false;
      }
    }
    return true;
  };

  // A small step along an axis for which every multiple (and, for the second axis, every
  // diagonal) is clear: the first clear step of a coarse scan, then the first clear one of a fine
  // scan just below it. A heuristic: a narrow clear window between collisions could be missed.
  const smallest = (limit, ok) => {
    const scan = (from, to, step) => {
      for (let s = from; s < to; s += step) if (ok(s)) return s;
      return null;
    };
    const coarse = scan(COARSE_STEP_MM, limit, COARSE_STEP_MM);
    if (coarse === null) return limit;
    return scan(Math.max(SCAN_STEP_MM, coarse - COARSE_STEP_MM + SCAN_STEP_MM), coarse, SCAN_STEP_MM) ?? coarse;
  };
  const dx = smallest(bw + gap, (s) => {
    for (let k = 1; k * s < bw + gap; k++) if (!clear(k * s, 0)) return false;
    return true;
  });
  const reach = Math.ceil((bw + gap) / dx);
  const dy = smallest(bh + gap, (s) => {
    for (let j = 1; j * s < bh + gap; j++) {
      for (let i = -reach; i <= reach; i++) if (!clear(i * dx, j * s)) return false;
    }
    return true;
  });
  return { rot90, rings, all, bw, bh, dx, dy };
}

/** The grid candidates (orientation) for a pair given as `pieces` (mm point arrays). */
export function gridCandidates(pieces, gap = COPY_GAP_MM) {
  const all = pieces.flat();
  const bb = boundsOf(all);
  const cx = (bb[0] + bb[2]) / 2;
  const cy = (bb[1] + bb[3]) / 2;
  const centred = pieces.map((ring) => ring.map(([x, y]) => [x - cx, y - cy]));
  const out = [];
  for (const rot90 of [false, true]) out.push(makeCandidate(centred, rot90, gap));
  return out;
}

/** Offsets of the first `n` copies of a cols × rows grid (row-major) and their bounding box [x0, y0, x1, y1] (centres at the origin copy). */
export function gridPositions(c, cols, rows, n) {
  const centres = [];
  for (let j = 0; j < rows && centres.length < n; j++) {
    for (let i = 0; i < cols && centres.length < n; i++) centres.push([i * c.dx, j * c.dy]);
  }
  const xs = centres.map((p) => p[0]);
  const ys = centres.map((p) => p[1]);
  const x0 = Math.min(...xs) - c.bw / 2;
  const x1 = Math.max(...xs) + c.bw / 2;
  const y0 = Math.min(...ys) - c.bh / 2;
  const y1 = Math.max(...ys) + c.bh / 2;
  return { centres, box: [x0, y0, x1, y1] };
}

const distToBox = (x, y, [x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));

/**
 * Place `copies` pairs ('max' = as many as fit in a grid, at most MAX_COPIES; or a count) inside
 * `rect` ({x0, y0, x1, y1}) keeping `gap` from each mark box ([x0, y0, x1, y1]). Grids have a
 * partial last row when the count is not a whole grid. Returns { copies, rot90, centres: [[x, y]…]
 * (mm, pair centres) } for the arrangement with the most copies (more even margins on a tie), or
 * null if not even one pair (or `copies` pairs when a count is asked for) fits. A heuristic: the
 * steps come from the greedy x-then-y search, so a cleverer arrangement might hold more.
 */
export function packCopies(pieces, rect, boxes, { copies = 'max', gap = COPY_GAP_MM, candidates = gridCandidates(pieces, gap) } = {}) {
  const W = rect.x1 - rect.x0;
  const H = rect.y1 - rect.y0;
  const cap = copies === 'max' ? MAX_COPIES : copies;
  const limits = candidates.map((c) => (c.bw > W || c.bh > H ? [0, 0]
    : [Math.floor((W - c.bw) / c.dx + 1e-9) + 1, Math.floor((H - c.bh) / c.dy + 1e-9) + 1]));
  // Whether copy `placed` (a pair centre) keeps inside the rectangle and `gap` from the marks.
  const copyOk = (c, [px, py]) => {
    const box = [px - c.bw / 2, py - c.bh / 2, px + c.bw / 2, py + c.bh / 2];
    if (box[0] < rect.x0 - 1e-9 || box[2] > rect.x1 + 1e-9 || box[1] < rect.y0 - 1e-9 || box[3] > rect.y1 + 1e-9) return false;
    const near = boxes.filter((b) => Math.hypot(Math.max(b[0] - box[2], 0, box[0] - b[2]), Math.max(b[1] - box[3], 0, box[1] - b[3])) < gap);
    if (!near.length) return true; // the whole bounding box is clear of every mark
    return c.all.every(([x, y]) => near.every((b) => distToBox(x + px, y + py, b) >= gap));
  };
  const most = limits.reduce((m, [cols, rows]) => Math.max(m, Math.min(cap, cols * rows)), 0);
  // Largest n first (for a count, only n = copies); the first n with a valid grid wins.
  for (let n = most; n >= (copies === 'max' ? 1 : cap); n--) {
    let best = null;
    candidates.forEach((c, k) => {
      const [colsMax, rowsMax] = limits[k];
      for (let cols = 1; cols <= Math.min(colsMax, n); cols++) {
        const rows = Math.ceil(n / cols);
        if (rows > rowsMax) continue;
        const { centres, box } = gridPositions(c, cols, rows, n);
        const bx = rect.x0 + (W - (box[2] - box[0])) / 2 - box[0];
        const by = rect.y0 + (H - (box[3] - box[1])) / 2 - box[1];
        const placed = centres.map(([x, y]) => [x + bx, y + by]);
        if (!placed.every((pt) => copyOk(c, pt))) continue;
        const uneven = Math.abs((W - (box[2] - box[0])) / 2 - (H - (box[3] - box[1])) / 2);
        if (!best || uneven < best.uneven - 1e-9) best = { uneven, copies: n, rot90: c.rot90, centres: placed };
      }
    });
    if (best) return { copies: best.copies, rot90: best.rot90, centres: best.centres };
  }
  return null;
}
