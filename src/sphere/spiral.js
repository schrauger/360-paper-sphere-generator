// Spiral families that define the centre line of a band. θ is the polar angle
// from +z (north); λ is longitude. Units: radians, sphere radius 1.

const LOX_EPS = 1e-9;

export function makeSpiral({ family, rate }) {
  if (family === 'clelia') {
    return { family, rate, lambda: (t) => rate * t, dLambda: () => rate };
  }
  if (family === 'loxodrome') {
    // λ = rate·ln tan(θ/2) diverges at the poles, so θ is clamped.
    const clamp = (t) => Math.min(Math.max(t, LOX_EPS), Math.PI - LOX_EPS);
    return {
      family,
      rate,
      lambda: (t) => rate * Math.log(Math.tan(clamp(t) / 2)),
      dLambda: (t) => rate / Math.sin(clamp(t)),
    };
  }
  throw new Error(`Unknown spiral family: ${family}`);
}

export function pointAt(theta, lambda) {
  const s = Math.sin(theta);
  return [s * Math.cos(lambda), s * Math.sin(lambda), Math.cos(theta)];
}
