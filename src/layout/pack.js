// Packing several sphere pairs on one sheet. Pure geometry in mm: a pair (both pieces' cut paths)
// is copied on a grid whose x and y steps are the smallest at which the actual cut outlines of all
// neighbours (diagonals too) stay COPY_GAP_MM apart, so the S shapes may nest. Both the pair and
// the pair turned 90° are tried. Deterministic, and independent of the output DPI.

/** Cut outlines of neighbouring spheres keep at least this far apart (mm). */
export const COPY_GAP_MM = 3;
const SCAN_STEP_MM = 0.1; // resolution of the grid-step search
const COARSE_STEP_MM = 1;
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

const boundsOf = (pts) => pts.reduce((m, [x, y]) => [Math.min(m[0], x), Math.min(m[1], y), Math.max(m[2], x), Math.max(m[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);

/**
 * One orientation of the pair: pieces (arrays of [x, y] mm, centred on the pair's bounding box),
 * its size, and the grid steps (x first, then y given x).
 */
function makeCandidate(pieces, rot90, gap) {
  const turn = ([x, y]) => (rot90 ? [-y, x] : [x, y]);
  const rings = pieces.map((ring) => ring.map(turn));
  const all = rings.flat();
  const bb = boundsOf(all);
  const bw = bb[2] - bb[0];
  const bh = bb[3] - bb[1];
  const index = makeIndex(rings, gap);
  const pre = all.filter((_, i) => i % PRE_STRIDE === 0);

  // Is the pair at offset (ox, oy) from itself at least `gap` away from the pair at the origin?
  const clear = (ox, oy) => {
    if (Math.abs(ox) >= bw + gap || Math.abs(oy) >= bh + gap) return true;
    for (const pts of [pre, all]) {
      for (const [x, y] of pts) {
        if (index.near(x + ox, y + oy) || index.near(x - ox, y - oy)) return false;
      }
    }
    return true;
  };

  // Smallest step along an axis for which every multiple (and, for the second axis, every
  // diagonal) is clear: a coarse scan, then a fine one inside the last coarse interval.
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
 * Place `copies` ('max' or a count) pairs inside `rect` ({x0, y0, x1, y1}) keeping `gap` from each
 * mark box ([x0, y0, x1, y1]). Returns { copies, rot90, centres: [[x, y]…] (mm, pair centres) } for
 * the arrangement with the most copies (more even margins on a tie), or null if not even one
 * pair fits (or `copies` pairs when a count is asked for).
 */
export function packCopies(pieces, rect, boxes, { copies = 'max', gap = COPY_GAP_MM, candidates = gridCandidates(pieces, gap) } = {}) {
  const W = rect.x1 - rect.x0;
  const H = rect.y1 - rect.y0;
  let best = null;
  for (const c of candidates) {
    const colsMax = Math.max(0, Math.floor((W - c.bw) / c.dx + 1e-9) + 1);
    const rowsMax = Math.max(0, Math.floor((H - c.bh) / c.dy + 1e-9) + 1);
    if (c.bw > W || c.bh > H) continue;
    for (let cols = 1; cols <= colsMax; cols++) {
      for (let rows = 1; rows <= rowsMax; rows++) {
        const n = copies === 'max' ? cols * rows : copies;
        if (n > cols * rows || n <= (rows - 1) * cols) continue; // a partial last row only
        const { centres, box } = gridPositions(c, cols, rows, n);
        const bx = rect.x0 + (W - (box[2] - box[0])) / 2 - box[0];
        const by = rect.y0 + (H - (box[3] - box[1])) / 2 - box[1];
        const placed = centres.map(([x, y]) => [x + bx, y + by]);
        const ok = placed.every(([px, py]) => {
          // Cheap box test first, then every point.
          const near = boxes.filter((b) => distToBox(px, py, b) < Math.hypot(c.bw, c.bh) / 2 + gap);
          return c.all.every(([x, y]) => {
            const X = x + px;
            const Y = y + py;
            return X >= rect.x0 && X <= rect.x1 && Y >= rect.y0 && Y <= rect.y1 && near.every((b) => distToBox(X, Y, b) >= gap);
          });
        });
        if (!ok) continue;
        const mx = (W - (box[2] - box[0])) / 2;
        const my = (H - (box[3] - box[1])) / 2;
        const score = [n, -Math.abs(mx - my)];
        if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1] + 1e-9)) {
          best = { score, copies: n, rot90: c.rot90, centres: placed, cols, rows };
        }
      }
    }
  }
  return best && { copies: best.copies, rot90: best.rot90, centres: best.centres, cols: best.cols, rows: best.rows };
}
