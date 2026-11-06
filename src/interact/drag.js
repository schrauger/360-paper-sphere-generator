// Drag math for the preview renderers. Pure functions: no DOM, no node-only modules.
// Vec3 = [x, y, z]; Mat3 = Float64Array(9), row-major.

import { mul, orthonormalize, rotationFromYPR, transpose, yprFromRotation } from '../sphere/orient.js';

const TINY = 1e-12;

function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Rotation by angle about a unit axis n (Rodrigues).
function rotationAbout(n, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const [x, y, z] = n;
  return Float64Array.from([
    c + t * x * x, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, c + t * y * y, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, c + t * z * z,
  ]);
}

// A unit vector perpendicular to u, built from the cardinal axis least aligned with u.
function perpendicular(u) {
  const ax = Math.abs(u[0]), ay = Math.abs(u[1]), az = Math.abs(u[2]);
  const e = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return unit(cross(u, e));
}

// Minimal rotation taking unit a to unit b (Rodrigues). For a ~ -b the axis is
// ambiguous, so a pi rotation about a perpendicular axis is used.
export function rotationBetween(a, b) {
  const u = unit(a), v = unit(b);
  const k = cross(u, v);
  const s = Math.hypot(k[0], k[1], k[2]);
  const c = dot(u, v);
  if (s < TINY) {
    return c > 0 ? Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]) : rotationAbout(perpendicular(u), Math.PI);
  }
  return rotationAbout(k.map((x) => x / s), Math.atan2(s, c));
}

// Keeps the photo content under the cursor: pFrom/pTo are band-frame directions
// under the cursor at drag start and now.
export function dragPhoto(rotation, pFrom, pTo) {
  return orthonormalize(mul(rotation, rotationBetween(pTo, pFrom)));
}

// Trackball orbit of the view; same construction as dragPhoto, in view space.
export function orbitView(viewRotation, vFrom, vTo) {
  return orthonormalize(mul(viewRotation, rotationBetween(vTo, vFrom)));
}

// Rotates the photo by deg about an axis given in band-frame coordinates.
export function rollPhoto(rotation, axis, deg) {
  const n = unit(axis);
  return orthonormalize(mul(rotation, rotationAbout(n, deg * Math.PI / 180)));
}

// Inverse of totalRotation: the yaw/pitch/roll that reproduces the given total rotation.
export function userYPR(model, totalRotation) {
  return yprFromRotation(mul(totalRotation, transpose(rotationFromYPR(model.baseOrientation))));
}
