// Nelder–Mead simplex minimiser (standard coefficients: reflect 1, expand 2, contract ½,
// shrink ½). Stops when the simplex's spread in f falls below tol or after maxIter steps.

/**
 * @param {(x: number[]) => number} f
 * @param {number[]} x0 start point
 * @param {{ step?: number | number[], maxIter?: number, tol?: number }} options
 *   step: initial simplex edge per coordinate (default 0.1·|x0ᵢ| or 0.1 where x0ᵢ = 0)
 * @returns {{ x: number[], fx: number, iterations: number }}
 */
export function nelderMead(f, x0, { step, maxIter = 4000, tol = 1e-10 } = {}) {
  const n = x0.length;
  const steps = x0.map((v, i) => (Array.isArray(step) ? step[i] : step ?? (v !== 0 ? 0.1 * Math.abs(v) : 0.1)));
  const simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += steps[i];
    simplex.push(x);
  }
  let values = simplex.map((x) => f(x));
  const blend = (a, b, t) => a.map((v, i) => v + t * (b[i] - v)); // a + t·(b − a)

  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const pts = order.map((i) => simplex[i]);
    const vals = order.map((i) => values[i]);
    simplex.splice(0, simplex.length, ...pts);
    values = vals;
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + tol)) break;

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) centroid[k] += simplex[i][k] / n;
    const worst = simplex[n];
    const xr = blend(centroid, worst, -1);
    const fr = f(xr);
    if (fr < values[0]) {
      const xe = blend(centroid, worst, -2);
      const fe = f(xe);
      if (fe < fr) [simplex[n], values[n]] = [xe, fe];
      else [simplex[n], values[n]] = [xr, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [xr, fr];
    } else {
      const outside = fr < values[n];
      const xc = outside ? blend(centroid, xr, 0.5) : blend(centroid, worst, 0.5);
      const fc = f(xc);
      if (fc < (outside ? fr : values[n])) {
        [simplex[n], values[n]] = [xc, fc];
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = blend(simplex[0], simplex[i], 0.5);
          values[i] = f(simplex[i]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (values[i] < values[best]) best = i;
  return { x: simplex[best], fx: values[best], iterations };
}
