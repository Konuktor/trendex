import { contours } from 'd3-contour';
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { avg } from './format';
import { cellIdOf, COLS, DLAT, DLON, LAT0, LON0, ringHas, ROWS } from './geo';
import { countryOf } from './regions';
import type { Cell, DataSet, Layer, LonLat, Selection, ZoneFilter } from './types';

export type TrendClass = 'decS' | 'dec' | 'nr' | 'inc' | 'incS';
export type LevelClass = 'Llow' | 'Lmoderate' | 'Lgood';
export type ZoneClass = TrendClass | LevelClass | 'excl' | 'nodata';
export type ZoneFeatureClass = ZoneClass | 'dim';

/** Draw order per layer. */
export const SLOTS: Record<Layer, ZoneClass[]> = {
  trend: ['decS', 'dec', 'nr', 'inc', 'incS', 'excl', 'nodata'],
  level: ['Llow', 'Lmoderate', 'Lgood', 'excl', 'nodata'],
};

/** Map class of a cell for a layer; null for water (never drawn). */
export function classOf(x: Cell, layer: Layer): ZoneClass | null {
  if (x.water) return null;
  if (x.kind === 'excluded') return 'excl';
  if (x.kind === 'nodata') return 'nodata';
  if (layer === 'level') return `L${x.level}` as LevelClass;
  if (x.cov < 0.6) return 'nr';
  return (x.trend + (x.strong ? 'S' : '')) as TrendClass;
}

/** Key that defines which cells belong to the same selectable zone. */
export function zoneKey(x: Cell, layer: Layer): string | null {
  if (x.water) return 'water';
  if (layer !== 'level' && x.kind === 'pasture' && x.cov < 0.6) return 'lowc';
  return classOf(x, layer);
}

export const ZONE_RADIUS = 2.3;

/** Same zone key, 4-connected, within 2.3 cells of the anchor. Anchor first. */
export function zoneOf(anchor: Cell, layer: Layer, byId: Record<string, Cell>): Cell[] {
  const k = zoneKey(anchor, layer);
  const out = [anchor];
  const seen: Record<string, 1> = { [anchor.id]: 1 };
  const q = [anchor];
  while (q.length) {
    const x = q.shift()!;
    for (const [oc, or] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nk = `${x.c + oc},${x.r + or}`;
      if (seen[nk]) continue;
      seen[nk] = 1;
      const n = byId[nk];
      if (!n || zoneKey(n, layer) !== k) continue;
      const dc = n.c - anchor.c;
      const dr = n.r - anchor.r;
      if (Math.sqrt(dc * dc + dr * dr) > ZONE_RADIUS) continue;
      out.push(n);
      q.push(n);
    }
  }
  return out;
}

export function cellAt(data: DataSet, lon: number, lat: number): Cell | null {
  return data.byId[cellIdOf(lat, lon)] ?? null;
}

export function selectZone(data: DataSet, id: string, layer: Layer): Selection | null {
  const a = data.byId[id];
  if (!a) return null;
  return { mode: 'zone', anchor: id, cells: zoneOf(a, layer, data.byId) };
}

/** Cells whose centre is inside the outline; else the cell under the outline's centre. */
export function selectDrawn(data: DataSet, poly: LonLat[]): Selection {
  let Z = data.cells.filter((x) => ringHas(poly, x.lon, x.lat));
  if (!Z.length) {
    const cx = avg(poly, (p) => p[0]);
    const cy = avg(poly, (p) => p[1]);
    const h = data.byId[cellIdOf(cy, cx)];
    if (h) Z = [h];
  }
  return { mode: 'drawn', poly, cells: Z };
}

/* ---------- smoothed zone polygons ---------- */

const PAD = 2; // cells of padding around the cells' bounding box
const THRESHOLD = 0.45;
/** Pixel budget for a raster of the whole grid; larger grids get a lower upsample factor. */
const MAX_PX = 400_000;

/** Upsample factor for a grid: ×8 (Naryn), lower for large grids so a full-grid raster stays under MAX_PX. */
export function upsampleFor(cols: number, rows: number): number {
  for (const up of [8, 6, 4, 3]) if ((cols + 2 * PAD) * (rows + 2 * PAD) * up * up <= MAX_PX) return up;
  return 2;
}

const kernels = new Map<number, Float64Array>();

/** Normalised 1-D Gaussian, sigma 0.26 cell. */
function kernelFor(up: number): Float64Array {
  let k = kernels.get(up);
  if (!k) {
    const sigma = 0.26 * up;
    const rad = Math.ceil(sigma * 3);
    const v: number[] = [];
    let s = 0;
    for (let i = -rad; i <= rad; i++) {
      const e = Math.exp(-(i * i) / (2 * sigma * sigma));
      v.push(e);
      s += e;
    }
    k = Float64Array.from(v, (e) => e / s);
    kernels.set(up, k);
  }
  return k;
}

/** Separable blur; per pixel the taps are summed in the same order in both passes. */
function blur(src: Float64Array, W: number, H: number, K: Float64Array): Float64Array {
  const rad = (K.length - 1) / 2;
  const tmp = new Float64Array(W * H);
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < W) s += src[o + xx] * K[k + rad];
      }
      tmp[o + x] = s;
    }
  }
  // Vertical pass row by row (cache-friendly); `out` accumulates taps in ascending k order.
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let k = -rad; k <= rad; k++) {
      const yy = y + k;
      if (yy < 0 || yy >= H) continue;
      const w = K[k + rad];
      const oo = yy * W;
      for (let x = 0; x < W; x++) out[o + x] += tmp[oo + x] * w;
    }
  }
  return out;
}

/**
 * Smoothed multipolygon around a set of cells (upsample → blur → contour at 0.45). Only the cells'
 * bounding box plus 2 cells of padding is rasterised, which gives the same contour as a raster of the
 * whole grid (the blur reaches less than one cell) at a fraction of the cost.
 */
export function smoothPolygon(list: readonly Cell[]): MultiPolygon | null {
  if (!list.length) return null;
  let c0 = Infinity;
  let c1 = -Infinity;
  let r0 = Infinity;
  let r1 = -Infinity;
  for (const x of list) {
    if (x.c < c0) c0 = x.c;
    if (x.c > c1) c1 = x.c;
    if (x.r < r0) r0 = x.r;
    if (x.r > r1) r1 = x.r;
  }
  const up = upsampleFor(COLS, ROWS);
  const ox = c0 - PAD;
  const oy = r0 - PAD;
  const W = (c1 - c0 + 1 + 2 * PAD) * up;
  const H = (r1 - r0 + 1 + 2 * PAD) * up;
  const a = new Float64Array(W * H);
  for (const x of list) {
    const x0 = (x.c - ox) * up;
    const y0 = (x.r - oy) * up;
    for (let y = y0; y < y0 + up; y++) a.fill(1, y * W + x0, y * W + x0 + up);
  }
  const values = blur(a, W, H, kernelFor(up));
  const [mp] = contours().size([W, H]).thresholds([THRESHOLD])(values as unknown as number[]);
  if (!mp || !mp.coordinates.length) return null;
  // Contour pixel coordinates → lon/lat (a cell spans `up` pixels; tested to stay centred).
  const toLonLat = ([px, py]: number[]): LonLat => [
    +(LON0 + (px / up + ox) * DLON).toFixed(5),
    +(LAT0 - (py / up + oy) * DLAT).toFixed(5),
  ];
  return {
    type: 'MultiPolygon',
    coordinates: mp.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat))),
  };
}

export type ZoneFeature = Feature<MultiPolygon, { cls: ZoneFeatureClass; cells: number }>;

export function matchesFilter(x: Cell, filter: ZoneFilter): boolean {
  if (filter.matrix && !(x.kind === 'pasture' && x.level === filter.matrix.level && x.trend === filter.matrix.trend))
    return false;
  if (filter.district && x.d !== filter.district) return false;
  if (filter.country && countryOf(x) !== filter.country) return false;
  return true;
}

/**
 * One feature per class (in draw order) plus a "dim" feature for cells
 * that do not match the filter. Water is never drawn.
 */
export function buildZoneGeoJSON(
  cells: readonly Cell[],
  layer: Layer,
  filter: ZoneFilter,
): FeatureCollection<MultiPolygon, ZoneFeature['properties']> {
  const slots = SLOTS[layer];
  const lists = new Map<ZoneClass, Cell[]>(slots.map((s) => [s, []]));
  const dim: Cell[] = [];
  for (const x of cells) {
    const c = classOf(x, layer);
    if (c === null) continue;
    if (!matchesFilter(x, filter)) {
      dim.push(x);
      continue;
    }
    lists.get(c)?.push(x);
  }
  const features: ZoneFeature[] = [];
  const push = (cls: ZoneFeatureClass, list: Cell[]) => {
    const g = smoothPolygon(list);
    if (g) features.push({ type: 'Feature', geometry: g, properties: { cls, cells: list.length } });
  };
  for (const s of slots) push(s, lists.get(s)!);
  push('dim', dim);
  return { type: 'FeatureCollection', features };
}
