// The geometry of a model (spiral, centre line, unrolling, piece outline), built once per model.
import { makeSpiral } from '../sphere/spiral.js';
import { makeCentreLine } from '../sphere/band.js';
import { makeUnrolling } from '../sphere/develop.js';
import { buildPieceOutline } from '../layout/piece.js';

const cache = new WeakMap();

/** { spiral, centreLine, unrolling, outline } for a model such as MODEL_360CRAFT; memoised by object identity. */
export function makeModelGeometry(model) {
  if (cache.has(model)) return cache.get(model);
  const spiral = makeSpiral(model.spiral);
  const centreLine = makeCentreLine(spiral);
  const unrolling = makeUnrolling(spiral, centreLine);
  const geometry = { spiral, centreLine, unrolling, outline: buildPieceOutline(unrolling, model.tabs) };
  cache.set(model, geometry);
  return geometry;
}
