// Drag math for the preview renderers. Pure functions: no DOM, no node-only modules.
// Vec3 = [x, y, z]; Mat3 = Float64Array(9), row-major.

import { mul, orthonormalize, rotationFromYPR, transpose, yprFromRotation } from '../sphere/orient.js';

const TINY = 1e-12;
// Below this dot product the direct formula loses accuracy (sin of the angle
// shrinks as a and b approach antipodal), so rotationBetween goes through a
// perpendicular instead.
const ANTIPODAL_DOT = -0.5;

function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 0) || !Number.isFinite(l)) {
    throw new RangeError(`expected a non-zero finite vector, got [${v}]`);
  }
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

// Direct Rodrigues for unit u, v with dot(u, v) > ANTIPODAL_DOT (or any pair with
// |u x v| not tiny). The identity return is only reached for u ~ v.
function directRotation(u, v) {
  const k = cross(u, v);
  const s = Math.hypot(k[0], k[1], k[2]);
  if (s < TINY) return Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  return rotationAbout(k.map((x) => x / s), Math.atan2(s, dot(u, v)));
}

// Minimal rotation taking a to b (Rodrigues). Near-antipodal pairs are split
// into two rotations through a perpendicular w, each with sin(angle) >= 0.5.
export function rotationBetween(a, b) {
  const u = unit(a), v = unit(b);
  if (dot(u, v) > ANTIPODAL_DOT) return directRotation(u, v);
  const w = perpendicular(u);
  return mul(directRotation(w, v), directRotation(u, w));
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
