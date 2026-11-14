import type { LonLat } from './types';

export interface Grid {
  cols: number;
  rows: number;
  /** lon of the left edge of column 0 */
  lon0: number;
  /** lat of the top edge of row 0 */
  lat0: number;
  dlon: number;
  dlat: number;
  /** nominal area of one cell, km² */
  cellKm2: number;
}

/** The Naryn pilot grid: 40 × 22 cells of 0.12° lon × 0.09° lat, origin top-left. Also used by the mock. */
export const NARYN_GRID: Readonly<Grid> = { cols: 40, rows: 22, lon0: 73.6, lat0: 42.55, dlon: 0.12, dlat: 0.09, cellKm2: 100 };

/*
 * The analysis grid of the active dataset. These are live bindings: setGrid() (called when a dataset
 * is activated, from meta.grid) updates them for every importer. They default to the Naryn grid.
 */
export let LON0 = NARYN_GRID.lon0;
export let LAT0 = NARYN_GRID.lat0;
export let DLON = NARYN_GRID.dlon;
export let DLAT = NARYN_GRID.dlat;
export let COLS = NARYN_GRID.cols;
export let ROWS = NARYN_GRID.rows;
export let CELL_KM2 = NARYN_GRID.cellKm2;
/** Approximate side of one cell in km (10 for Naryn). */
export let CELL_KM = Math.sqrt(NARYN_GRID.cellKm2);

let current: Readonly<Grid> = NARYN_GRID;

/** The active grid (a new object after each change, so it can key caches). */
export const getGrid = (): Readonly<Grid> => current;

function valid(g: Partial<Grid> | null | undefined): g is Grid {
  return (
    !!g &&
    (['cols', 'rows', 'lon0', 'lat0', 'dlon', 'dlat'] as const).every((k) => typeof g[k] === 'number' && Number.isFinite(g[k])) &&
    g.cols! > 0 &&
    g.rows! > 0 &&
    g.dlon! > 0 &&
    g.dlat! > 0
  );
}

/** Switch the analysis grid (from meta.grid). Missing or invalid input falls back to the Naryn grid. */
export function setGrid(g?: Partial<Grid> | null): void {
  const next: Grid = valid(g)
    ? { ...g, cellKm2: typeof g.cellKm2 === 'number' && g.cellKm2 > 0 ? g.cellKm2 : approxCellKm2(g) }
    : { ...NARYN_GRID };
  const same = (Object.keys(next) as (keyof Grid)[]).every((k) => next[k] === current[k]);
  if (same) return;
  current = next;
  LON0 = next.lon0;
  LAT0 = next.lat0;
  DLON = next.dlon;
  DLAT = next.dlat;
  COLS = next.cols;
  ROWS = next.rows;
  CELL_KM2 = next.cellKm2;
  CELL_KM = Math.sqrt(next.cellKm2);
}

function approxCellKm2(g: Grid): number {
  const midLat = g.lat0 - (g.rows * g.dlat) / 2;
  return Math.round(g.dlon * 111.32 * Math.cos((midLat * Math.PI) / 180) * g.dlat * 110.57);
}

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
