// Orientation (yaw/pitch/roll) and equirectangular helpers.
// Vec3 = [x, y, z]; Mat3 = Float64Array(9), row-major.
// M = Rz(yaw) * Ry(pitch) * Rx(roll), angles in degrees.

const DEG = Math.PI / 180;

export function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return Float64Array.from([c, -s, 0, s, c, 0, 0, 0, 1]);
}

function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return Float64Array.from([c, 0, s, 0, 1, 0, -s, 0, c]);
}

function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return Float64Array.from([1, 0, 0, 0, c, -s, 0, s, c]);
}

export function mul(A, B) {
  const C = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    }
  }
  return C;
}

export function transpose(M) {
  return Float64Array.from([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);
}

export function apply(M, v) {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}

export function rotationFromYPR({ yaw, pitch, roll }) {
  return mul(rotZ(yaw * DEG), mul(rotY(pitch * DEG), rotX(roll * DEG)));
}

// Inverse of rotationFromYPR. pitch is in [-90, 90]. At |pitch| = 90 the yaw
// and roll axes coincide, so all of the remaining rotation goes into yaw and
// roll is 0.
export function yprFromRotation(M) {
  const sinPitch = Math.max(-1, Math.min(1, -M[6]));
  const pitch = Math.asin(sinPitch);
  let yaw, roll;
  if (Math.abs(sinPitch) > 1 - 1e-12) {
    yaw = Math.atan2(-M[1], M[4]);
    roll = 0;
  } else {
    yaw = Math.atan2(M[3], M[0]);
    roll = Math.atan2(M[7], M[8]);
  }
  return { yaw: yaw / DEG, pitch: pitch / DEG, roll: roll / DEG };
}

// Gram-Schmidt on the rows; the third row is the cross product of the first
// two so the result is a proper rotation (det = +1).
export function orthonormalize(M) {
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const r0 = norm([M[0], M[1], M[2]]);
  const d = M[3] * r0[0] + M[4] * r0[1] + M[5] * r0[2];
  const r1 = norm([M[3] - d * r0[0], M[4] - d * r0[1], M[5] - d * r0[2]]);
  const r2 = [
    r0[1] * r1[2] - r0[2] * r1[1],
    r0[2] * r1[0] - r0[0] * r1[2],
    r0[0] * r1[1] - r0[1] * r1[0],
  ];
  return Float64Array.from([...r0, ...r1, ...r2]);
}

// lon = atan2(y, x), lat = asin(z); u wraps into [0, W), v is clamped to [0, H].
export function directionToEquirect(v, W, H) {
  const lon = Math.atan2(v[1], v[0]);
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2] / Math.hypot(v[0], v[1], v[2]))));
  let u = ((lon + Math.PI) / (2 * Math.PI)) * W;
  if (u >= W) u -= W;
  const vv = Math.max(0, Math.min(H, ((Math.PI / 2 - lat) / Math.PI) * H));
  return [u, vv];
}

// u, v are pixel-edge coordinates (a pixel centre is at +0.5).
export function equirectToDirection(u, v, W, H) {
  const lon = (u / W) * 2 * Math.PI - Math.PI;
  const lat = Math.PI / 2 - (v / H) * Math.PI;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}
