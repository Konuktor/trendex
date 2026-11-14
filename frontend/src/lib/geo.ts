import type { LonLat } from './types';

/** Analysis grid: 40 × 22 cells of 0.12° lon × 0.09° lat, origin top-left. */
export const LON0 = 73.6;
export const LAT0 = 42.55;
export const DLON = 0.12;
export const DLAT = 0.09;
export const COLS = 40;
export const ROWS = 22;
export const CELL_KM2 = 100;

export const cellId = (c: number, r: number): string => `${c},${r}`;

export function cellCenter(c: number, r: number): LonLat {
  return [LON0 + (c + 0.5) * DLON, LAT0 - (r + 0.5) * DLAT];
}

/** Continuous grid coordinates (not floored). */
export function toCell(lon: number, lat: number): { c: number; r: number } {
  return { c: (lon - LON0) / DLON, r: (LAT0 - lat) / DLAT };
}

export function gridToLonLat(c: number, r: number): LonLat {
  return [LON0 + c * DLON, LAT0 - r * DLAT];
}

export function cellIdOf(lat: number, lon: number): string {
  const k = toCell(lon, lat);
  return cellId(Math.floor(k.c), Math.floor(k.r));
}

export function ringHas(ring: number[][], x: number, y: number): boolean {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function polyHas(p: number[][][], x: number, y: number): boolean {
  if (!ringHas(p[0], x, y)) return false;
  for (let k = 1; k < p.length; k++) if (ringHas(p[k], x, y)) return false;
  return true;
}

type Geom = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

export function geomHas(g: Geom | null | undefined, x: number, y: number): boolean {
  if (!g) return false;
  if (g.type === 'Polygon') return polyHas(g.coordinates, x, y);
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => polyHas(p, x, y));
  return false;
}

export function bboxOf(g: Geom): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90];
  const walk = (a: unknown): void => {
    const arr = a as unknown[];
    if (typeof arr[0] === 'number') {
      const [x, y] = arr as number[];
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    } else arr.forEach(walk);
  };
  walk(g.coordinates);
  return b;
}

/** Planar area in km² of a lon/lat ring (no closing point needed). */
export function polyAreaKm(pts: LonLat[]): number {
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] * k + pts[i][0] * k) * (pts[j][1] * 110.57 - pts[i][1] * 110.57);
  }
  return Math.abs(a / 2);
}
