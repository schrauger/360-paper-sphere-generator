/** Parse LINE entities in the ENTITIES section. Raw DXF coordinates (y-up). */
export function readDxfLines(text) {
  const rows = text.split(/\r?\n/);
  const lines = [];
  let inEntities = false;
  let cur = null;
  const flush = () => {
    if (cur && cur.layer !== undefined && [cur.x1, cur.y1, cur.x2, cur.y2].every(Number.isFinite)) lines.push(cur);
    cur = null;
  };
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const code = parseInt(rows[i].trim(), 10);
    const value = rows[i + 1].trim();
    if (code === 0) {
      flush();
      if (value === 'SECTION') continue;
      if (value === 'ENDSEC') { inEntities = false; continue; }
      if (inEntities && value === 'LINE') cur = { layer: undefined, x1: NaN, y1: NaN, x2: NaN, y2: NaN };
      continue;
    }
    if (code === 2 && !cur) { inEntities = value === 'ENTITIES'; continue; }
    if (!cur) continue;
    if (code === 8) cur.layer = value;
    else if (code === 10) cur.x1 = parseFloat(value);
    else if (code === 20) cur.y1 = parseFloat(value);
    else if (code === 11) cur.x2 = parseFloat(value);
    else if (code === 21) cur.y2 = parseFloat(value);
  }
  flush();
  return lines;
}

const TOL = 1e-6;
const near = (a, b) => Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL;

/** Chain segments end-to-end into polylines per layer, flipping y to sheetHeight - y. */
export function dxfToPolylines(lines, { sheetHeight }) {
  const byLayer = new Map();
  for (const l of lines) {
    const a = [l.x1, l.y1], b = [l.x2, l.y2];
    if (near(a, b)) continue;
    if (!byLayer.has(l.layer)) byLayer.set(l.layer, []);
    byLayer.get(l.layer).push([a, b]);
  }
  const out = new Map();
  for (const [layer, segs] of byLayer) {
    // Endpoint index keyed on a quantised grid; check neighbouring cells for tolerance.
    const key = (p) => `${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`;
    const index = new Map();
    segs.forEach((s, i) => s.forEach((p, e) => {
      const k = key(p);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push([i, e]);
    }));
    const find = (p, used) => {
      const [cx, cy] = [Math.round(p[0] / TOL), Math.round(p[1] / TOL)];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const [i, e] of index.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (!used[i] && near(segs[i][e], p)) return [i, e];
        }
      }
      return null;
    };
    const used = new Array(segs.length).fill(false);
    const polys = [];
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      const pts = [segs[s][0], segs[s][1]];
      for (let grow = true; grow;) {
        grow = false;
        const hit = find(pts[pts.length - 1], used);
        if (hit) {
          used[hit[0]] = true;
          pts.push(segs[hit[0]][1 - hit[1]]);
          grow = true;
        }
      }
      // Drop the duplicated closing point if the chain closed.
      if (pts.length > 2 && near(pts[0], pts[pts.length - 1])) pts.pop();
      polys.push(pts.map(([x, y]) => [x, sheetHeight - y]));
    }
    out.set(layer, polys);
  }
  return out;
}
