import { contours } from 'd3-contour';
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { avg } from './format';
import { cellIdOf, COLS, DLAT, DLON, LAT0, LON0, ringHas, ROWS } from './geo';
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

const UP = 8; // upsample factor
const PAD = 2; // cells of padding around the grid
const SIGMA = 0.26 * UP; // Gaussian sigma in pixels
const THRESHOLD = 0.45;
const GW = (COLS + 2 * PAD) * UP;
const GH = (ROWS + 2 * PAD) * UP;

const KERNEL = (() => {
  const rad = Math.ceil(SIGMA * 3);
  const k: number[] = [];
  let s = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = Math.exp(-(i * i) / (2 * SIGMA * SIGMA));
    k.push(v);
    s += v;
  }
  return k.map((v) => v / s);
})();

function rasterize(list: readonly Cell[]): Float64Array {
  const a = new Float64Array(GW * GH);
  for (const x of list) {
    const x0 = (x.c + PAD) * UP;
    const y0 = (x.r + PAD) * UP;
    for (let y = y0; y < y0 + UP; y++) a.fill(1, y * GW + x0, y * GW + x0 + UP);
  }
  return a;
}

function blur(src: Float64Array): Float64Array {
  const rad = (KERNEL.length - 1) / 2;
  const tmp = new Float64Array(GW * GH);
  const out = new Float64Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    const o = y * GW;
    for (let x = 0; x < GW; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < GW) s += src[o + xx] * KERNEL[k + rad];
      }
      tmp[o + x] = s;
    }
  }
  for (let x = 0; x < GW; x++) {
    for (let y = 0; y < GH; y++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < GH) s += tmp[yy * GW + x] * KERNEL[k + rad];
      }
      out[y * GW + x] = s;
    }
  }
  return out;
}

const contour = contours().size([GW, GH]).thresholds([THRESHOLD]);

/** Contour pixel coordinates → lon/lat (a cell spans UP pixels; tested to stay centred). */
function pxToLonLat([x, y]: number[]): LonLat {
  const c = x / UP - PAD;
  const r = y / UP - PAD;
  return [+(LON0 + c * DLON).toFixed(5), +(LAT0 - r * DLAT).toFixed(5)];
}

/** Smoothed multipolygon around a set of cells (upsample → blur → contour at 0.45). */
export function smoothPolygon(list: readonly Cell[]): MultiPolygon | null {
  if (!list.length) return null;
  const [mp] = contour(Array.from(blur(rasterize(list))));
  if (!mp || !mp.coordinates.length) return null;
  return {
    type: 'MultiPolygon',
    coordinates: mp.coordinates.map((poly) => poly.map((ring) => ring.map(pxToLonLat))),
  };
}

export type ZoneFeature = Feature<MultiPolygon, { cls: ZoneFeatureClass; cells: number }>;

export function matchesFilter(x: Cell, filter: ZoneFilter): boolean {
  if (filter.matrix && !(x.kind === 'pasture' && x.level === filter.matrix.level && x.trend === filter.matrix.trend))
    return false;
  if (filter.district && x.d !== filter.district) return false;
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
