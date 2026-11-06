import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rotationBetween, dragPhoto, orbitView, rollPhoto, userYPR,
} from '../../src/interact/drag.js';
import { MODEL_360CRAFT } from '../../src/model/360craft.js';
import { apply, mul, rotationFromYPR, transpose } from '../../src/sphere/orient.js';
import { totalRotation } from '../../src/render/warp.js';

const I = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const maxDiff = (A, B) => Math.max(...Array.from(A, (x, i) => Math.abs(x - B[i])));
const nearVec = (a, b, tol, msg = '') =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= tol, `${msg} [${i}] ${x} vs ${b[i]}`));

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function randomUnit(next) {
  for (;;) {
    const v = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1];
    const l = Math.hypot(...v);
    if (l > 1e-3) return v.map((x) => x / l);
  }
}

function isRotation(M, tol) {
  const MMt = mul(M, transpose(M));
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  return maxDiff(MMt, I) <= tol && Math.abs(det - 1) <= tol;
}

test('rotationBetween maps a to b for 1000 random pairs, including antipodal ones', () => {
  const next = rng(1);
  for (let i = 0; i < 1000; i++) {
    const a = randomUnit(next);
    // Every 5th pair is antipodal (b = -a) to exercise the pi-rotation branch.
    const b = i % 5 === 0 ? a.map((x) => -x) : randomUnit(next);
    const R = rotationBetween(a, b);
    assert.ok(R instanceof Float64Array && R.length === 9);
    nearVec(apply(R, a), b, 1e-12, `pair ${i}`);
    assert.ok(isRotation(R, 1e-12), `pair ${i} is a proper rotation`);
  }
});

test('rotationBetween of identical vectors is the identity', () => {
  const a = [0.6, 0.0, 0.8];
  assert.ok(maxDiff(rotationBetween(a, a), I) <= 1e-12);
});

test('dragPhoto: apply(new, pTo) equals apply(old, pFrom) within 1e-12', () => {
  const next = rng(2);
  for (let i = 0; i < 200; i++) {
    const old = rotationFromYPR({ yaw: next() * 360, pitch: next() * 170 - 85, roll: next() * 360 });
    const pFrom = randomUnit(next);
    const pTo = randomUnit(next);
    const fresh = dragPhoto(old, pFrom, pTo);
    nearVec(apply(fresh, pTo), apply(old, pFrom), 1e-12, `drag ${i}`);
  }
});

test('1000 random consecutive drags stay orthonormal within 1e-9 (no drift)', () => {
  const next = rng(3);
  let M = rotationFromYPR({ yaw: 10, pitch: 20, roll: 30 });
  for (let i = 0; i < 1000; i++) {
    const pFrom = randomUnit(next);
    const pTo = i % 7 === 0 ? pFrom.map((x) => -x) : randomUnit(next);
    M = dragPhoto(M, pFrom, pTo);
    assert.ok(isRotation(M, 1e-9), `drag ${i} stays a rotation`);
  }
});

test('1000 mixed orbit and roll steps stay orthonormal within 1e-9 (no drift)', () => {
  const next = rng(4);
  let M = I;
  for (let i = 0; i < 1000; i++) {
    if (i % 2) M = orbitView(M, randomUnit(next), randomUnit(next));
    else M = rollPhoto(M, randomUnit(next), next() * 10 - 5);
    assert.ok(isRotation(M, 1e-9), `step ${i} stays a rotation`);
  }
});

test('orbitView applies the same construction in view space', () => {
  const next = rng(5);
  const view = rotationFromYPR({ yaw: 40, pitch: -15, roll: 5 });
  const vFrom = randomUnit(next);
  const vTo = randomUnit(next);
  const out = orbitView(view, vFrom, vTo);
  nearVec(apply(out, vTo), apply(view, vFrom), 1e-12, 'orbit');
});

test('rollPhoto rotates by deg about the given axis, and is orthonormal', () => {
  const M = rotationFromYPR({ yaw: 0, pitch: 0, roll: 0 });
  // Rolling 90 degrees about +z from the identity maps +x to +y.
  nearVec(apply(rollPhoto(M, [0, 0, 1], 90), [1, 0, 0]), [0, 1, 0], 1e-12, 'roll z');
  // Axis length must not matter.
  nearVec(apply(rollPhoto(M, [0, 0, 5], 90), [1, 0, 0]), [0, 1, 0], 1e-12, 'roll scaled axis');
  assert.ok(isRotation(rollPhoto(M, [1, 2, 3], 37), 1e-12));
});

test('userYPR(totalRotation(model, ypr)) round-trips random ypr (|pitch| < 89.9)', () => {
  const model = MODEL_360CRAFT;
  const next = rng(6);
  for (let i = 0; i < 500; i++) {
    const ypr = {
      yaw: next() * 360 - 180,
      pitch: next() * 179.8 - 89.9,
      roll: next() * 360 - 180,
    };
    const back = userYPR(model, totalRotation(model, ypr));
    for (const k of ['yaw', 'pitch', 'roll']) {
      const d = Math.abs(back[k] - ypr[k]);
      const wrapped = Math.min(d, Math.abs(d - 360));
      assert.ok(wrapped <= 1e-9, `ypr ${i} ${k}: ${back[k]} vs ${ypr[k]}`);
    }
  }
});

test('userYPR of the base orientation is the zero orientation', () => {
  const model = MODEL_360CRAFT;
  const back = userYPR(model, rotationFromYPR(model.baseOrientation));
  assert.ok(Math.abs(back.yaw) < 1e-9 && Math.abs(back.pitch) < 1e-9 && Math.abs(back.roll) < 1e-9, JSON.stringify(back));
});
