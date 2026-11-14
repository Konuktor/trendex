/** Deterministic hash noise in [0, 1). Ported 1:1 from the reference. */
export function H(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 10000) / 10000;
}

/** Smooth value noise at scale `sc`, built on H. */
export function V(x: number, y: number, s: number, sc: number): number {
  const gx = x / sc;
  const gy = y / sc;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = H(x0, y0, s);
  const b = H(x0 + 1, y0, s);
  const c = H(x0, y0 + 1, s);
  const d = H(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Weather-year anomaly for each season 2000–2025. */
export const YR: readonly number[] = [
  0.2, -0.1, 0.3, 0.1, -0.2, 0.4, 0.0, -0.3, -0.9, 0.2, 0.5, 0.1, -0.2, 0.3, -0.8, 0.2, 0.4, -0.1, 0.3, 0.0, 0.2,
  -1.0, 0.3, -0.7, 0.1, -0.4,
];

export const YEARS = 26;
export const FIRST_YEAR = 2000;
