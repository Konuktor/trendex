/**
 * Native 1 km pixel layers (px/): palette tiles for the map, 64 × 64 binary chunks for a clicked pixel, and
 * share-of-pasture statistics per region. Pure helpers; fetching lives in data/px.ts.
 */
import { ord } from './format';
import type { Level, Trend } from './types';

export interface PxCode {
  key: string;
  label: string;
  color: string;
}

export interface PxLayoutEntry {
  name: string;
  dtype: 'uint8' | 'int16';
  offset: number;
  count: number;
}

export interface PxGrid {
  crs?: string;
  /** sphere radius of the MODIS sinusoidal grid, m */
  R: number;
  cell_m: number;
  x_origin: number;
  y_origin: number;
  row0: number;
  col0: number;
  H: number;
  W: number;
}

export interface PxMeta {
  dataset: string;
  years: [number, number];
  chunk: number;
  chunkBytes: number;
  grid: PxGrid;
  layout: PxLayoutEntry[];
  /** region codes; a chunk's region byte is a 1-based index into this list (0 = none) */
  regions: string[];
  codes: Record<string, PxCode>;
  legend: { trend: number[]; level: number[]; resid?: number[] };
  tiles: { url: string; layers: string[]; minZoom: number; maxNativeZoom: number; bounds: [[number, number], [number, number]] };
  method?: Record<string, string>;
}

export const TIER_KEYS = ['decline', 'early_decline', 'stable', 'early_growth', 'growth', 'insufficient'] as const;
export type TierKey = (typeof TIER_KEYS)[number];
/** Tier code (1–6) of each key. */
export const TIER_CODE: Record<TierKey, number> = { decline: 1, early_decline: 2, stable: 3, early_growth: 4, growth: 5, insufficient: 6 };
export const LEVEL_KEYS = ['low', 'moderate', 'good'] as const;

/** Summer (May–Sep) observed greenness against the weather-expected value, for one scope. */
export interface PxExpected {
  years: number[];
  observed: number[];
  expected: number[];
  p10: number[];
  p90: number[];
  season?: { year: number; residual: number; percentile: number; class: 'below' | 'within' | 'above' };
}

export interface PxStats {
  /** share of pasture area per "beyond weather" tier (trend of Jun–Aug residuals), when the model covers it */
  resid?: Record<TierKey, number>;
  expected?: PxExpected;
  pasture_km2: number;
  n_pasture_px: number;
  /** share of pasture area per trend tier (sums to 1) */
  trend: Record<TierKey, number>;
  /** share of pasture area per level class */
  level: Record<Level, number>;
  /** share of pasture area per level and tier (sums to 1), when the export has it */
  matrix?: Record<Level, Record<TierKey, number>>;
  excluded_km2: Record<string, number>;
}

export interface PxRegions {
  all: PxStats;
  regions: Record<string, PxStats>;
  /** Central Asia: by country (ISO3) */
  countries?: Record<string, PxStats>;
}

export interface WhatIfEntry {
  n_cells?: number;
  /** typical NDVI per month */
  typical: number[];
  /** change[month][precip][temp], NDVI */
  change: number[][][];
}

/** Model sensitivity table (px/whatif.json): expected = typical[m] + change[m][p][t]. */
export interface PxWhatIf {
  model?: string;
  months: number[];
  precip_pct: number[];
  temp_c: number[];
  label: string;
  meaning: string;
  all: WhatIfEntry;
  countries?: Record<string, WhatIfEntry>;
  regions: Record<string, WhatIfEntry>;
}

export interface PxSkill {
  point: number;
  ci_lo: number;
  ci_hi: number;
  /** number of test units the score was computed over */
  units: number;
}

/** Model card facts for Methods (px/ml.json). */
export interface PxMl {
  model: string;
  version: string;
  url: string;
  training_log: string;
  gate: { rule: string; passed: boolean; shipped_model?: string };
  skill_vs_ridge: { temporal: PxSkill; spatial: PxSkill };
  skill_vs_climatology: { temporal: PxSkill; spatial: PxSkill };
  coverage_p10_p90: number;
  cells_by_source: Record<string, number> | null;
  residual_season?: string;
  git_commit?: string;
  wording?: string;
}

/** The 1 km layer of one dataset: its folder, meta and statistics. */
export interface PxInfo {
  /** dataset folder, e.g. "/data/v1" */
  base: string;
  meta: PxMeta;
  regions: PxRegions | null;
  whatif?: PxWhatIf | null;
  ml?: PxMl | null;
}

/** True for a usable px/meta.json (an HTML fallback page or a partial file is not). */
export function isPxMeta(m: unknown): m is PxMeta {
  const x = m as PxMeta;
  return (
    !!x &&
    typeof x === 'object' &&
    !!x.grid &&
    Number.isFinite(x.grid.cell_m) &&
    Array.isArray(x.layout) &&
    !!x.tiles &&
    typeof x.tiles.url === 'string' &&
    !!x.codes &&
    !!x.legend
  );
}

/** Tile URL template for a layer: "/data/v1/px/tiles/trend/{z}/{x}/{y}.png". */
export function tileUrl(px: PxInfo, layer: 'trend' | 'level' | 'resid'): string {
  return `${px.base}/${px.meta.tiles.url.replace('{layer}', layer)}`;
}

/** Local row/col of the 1 km cell under a point (MODIS sinusoidal, closed form); null outside the grid. */
export function pixelRowCol(g: PxGrid, lat: number, lon: number): { row: number; col: number } | null {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const x = g.R * lo * Math.cos(la);
  const y = g.R * la;
  const row = Math.floor((g.y_origin - y) / g.cell_m) - g.row0;
  const col = Math.floor((x - g.x_origin) / g.cell_m) - g.col0;
  if (row < 0 || col < 0 || row >= g.H || col >= g.W) return null;
  return { row, col };
}

/** Corners [lon, lat] of a 1 km cell (inverse sinusoidal), for drawing its footprint. */
export function pixelCorners(g: PxGrid, row: number, col: number): [number, number][] {
  const pt = (r: number, c: number): [number, number] => {
    const y = g.y_origin - (r + g.row0) * g.cell_m;
    const x = g.x_origin + (c + g.col0) * g.cell_m;
    const lat = y / g.R;
    return [((x / (g.R * Math.cos(lat))) * 180) / Math.PI, (lat * 180) / Math.PI];
  };
  return [pt(row, col), pt(row, col + 1), pt(row + 1, col + 1), pt(row + 1, col)];
}

/** Chunk file key ("2_5") and the index of the cell inside it. */
export function chunkOf(row: number, col: number, size = 64): { key: string; i: number } {
  return { key: `${Math.floor(row / size)}_${Math.floor(col / size)}`, i: (row % size) * size + (col % size) };
}

export interface PixelInfo {
  /** trend tier 1–6 for pasture, mask code 40–47 otherwise, 0 outside the study area */
  code: number;
  /** level code 21–23 for pasture (47 when missing), the mask code otherwise */
  levelCode: number;
  /** TrendeX score 0–100 */
  score: number | null;
  /** Theil–Sen slope, % per decade */
  slopeDecade: number | null;
  p: number | null;
  q: number | null;
  region: string | null;
  /** NDVI per year (null where missing) */
  series: (number | null)[];
  /** "beyond weather" tier (codes as trend, 6 = no model output); undefined when the export has no model layer */
  resid?: number;
  /** trend of the Jun–Aug residuals, NDVI per decade */
  residSlope?: number | null;
}

function field(meta: PxMeta, name: string): PxLayoutEntry {
  const f = meta.layout.find((x) => x.name === name);
  if (!f) throw new Error(`px layout has no ${name}`);
  return f;
}

/** Decode one cell of a chunk (struct of arrays; `series` is year-major: year * cells + i). */
export function decodePixel(buf: ArrayBuffer, i: number, meta: PxMeta): PixelInfo {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const n = meta.chunk * meta.chunk;
  const years = meta.years[1] - meta.years[0] + 1;
  const b = (name: string) => u8[field(meta, name).offset + i];
  const score = b('score');
  const p = b('p_x250');
  const q = b('q_x250');
  const slope = dv.getInt16(field(meta, 'slope_pct_decade_x10').offset + 2 * i, true);
  const r = b('region');
  const so = field(meta, 'series').offset;
  const series: (number | null)[] = [];
  for (let y = 0; y < years; y++) {
    const v = u8[so + y * n + i];
    series.push(v === 255 ? null : (v / 254) * 1.2 - 0.2);
  }
  const rf = meta.layout.find((x) => x.name === 'resid');
  const rs = meta.layout.find((x) => x.name === 'resid_slope_ndvi_x1000_per_decade');
  const rv = rs ? dv.getInt16(rs.offset + 2 * i, true) : null;
  return {
    ...(rf ? { resid: u8[rf.offset + i], residSlope: rv === null || rv === -32768 ? null : rv / 1000 } : {}),
    code: b('tier'),
    levelCode: b('level'),
    score: score === 255 ? null : score,
    slopeDecade: slope === -32768 ? null : slope / 10,
    p: p === 255 ? null : p / 250,
    q: q === 255 ? null : q / 250,
    region: r > 0 ? (meta.regions[r - 1] ?? null) : null,
    series,
  };
}

export const isPastureCode = (code: number) => code >= 1 && code <= 6;
export const isMaskCode = (code: number) => code >= 40 && code <= 47;

/** Map trend class of a tier: only reliable tiers carry a direction; possible trends count as not reliable. */
export function tierTrend(code: number): Trend {
  return code === 1 ? 'dec' : code === 5 ? 'inc' : 'nr';
}

export function levelOfCode(code: number): Level | null {
  return code === 21 ? 'low' : code === 22 ? 'moderate' : code === 23 ? 'good' : null;
}

/** Statistics for the scope: a region, else a country (Central Asia), else the whole area. Null when missing. */
export function pxScope(r: PxRegions | null | undefined, district: string | null, country: string | null): PxStats | null {
  if (!r) return null;
  if (district) return r.regions[district] ?? null;
  if (country) return r.countries?.[country] ?? null;
  return r.all;
}

/** Whole percentages per tier that add up to 100 (largest remainders). */
export function tierPercents(s: Pick<PxStats, 'trend'>): Record<TierKey, number> {
  return roundShares(TIER_KEYS.map((k) => s.trend[k] ?? 0), TIER_KEYS) as Record<TierKey, number>;
}

function roundShares<K extends string>(shares: number[], keys: readonly K[]): Record<K, number> {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const raw = shares.map((v) => (100 * v) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return Object.fromEntries(keys.map((k, i) => [k, out[i]])) as Record<K, number>;
}

/**
 * Level × trend matrix from the joint shares: Decline = reliable decline, Growth = reliable growth, and
 * Not reliable = everything else (possible trends, no reliable trend, not enough data). Null without `matrix`.
 */
export function pxMatrixShare(s: PxStats | null, level: Level, trend: Trend): number | null {
  const m = s?.matrix?.[level];
  if (!m) return null;
  const v = trend === 'dec' ? m.decline : trend === 'inc' ? m.growth : m.early_decline + m.stable + m.early_growth + m.insufficient;
  return Math.round(100 * (v ?? 0));
}

/** Legend codes for a layer, without classes that cover no area here (keeps the five trend tiers). */
export function legendCodes(meta: PxMeta, layer: 'trend' | 'level' | 'resid', all: PxStats | null): number[] {
  const keep = (code: number) => {
    if (!all) return true;
    const c = meta.codes[String(code)];
    if (!c) return false;
    if (code >= 1 && code <= 5) return true;
    // White "not enough data" pixels also occur outside pasture (code 47, not in the area tables): keep the entry.
    if (code === 6) return true;
    if (code >= 21 && code <= 23) return true;
    return (all.excluded_km2[c.key] ?? 0) > 0;
  };
  return (meta.legend[layer] ?? []).filter(keep);
}

/** A small LRU map (insertion order = recency). */
export class Lru<K, V> {
  private m = new Map<K, V>();
  constructor(private readonly max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }
  delete(k: K): void {
    this.m.delete(k);
  }
  get size(): number {
    return this.m.size;
  }
}

/** Fill missing years by linear interpolation (nearest value at the ends); null when fewer than 2 years exist. */
export function fillGaps(v: readonly (number | null)[]): number[] | null {
  const idx = v.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  return v.map((x, i) => {
    if (x !== null) return x;
    const prev = [...idx].reverse().find((j) => j < i);
    const next = idx.find((j) => j > i);
    if (prev === undefined) return v[next!]!;
    if (next === undefined) return v[prev]!;
    const a = v[prev]!;
    const b = v[next]!;
    return a + ((b - a) * (i - prev)) / (next - prev);
  });
}

/** A class label without its note, for running text: "Possible decline (pixel p < 0.05)" → "Possible decline". */
export function shortLabel(meta: PxMeta, code: number): string {
  return (meta.codes[String(code)]?.label ?? '').replace(/\s*\(.*\)\s*$/, '');
}

/** The same, starting lower case: "possible decline". */
export const inlineLabel = (meta: PxMeta, code: number): string => {
  const t = shortLabel(meta, code);
  return t.charAt(0).toLowerCase() + t.slice(1);
};

/** Centre [lon, lat] of a 1 km cell (inverse sinusoidal). */
export function pixelCenter(g: PxGrid, row: number, col: number): [number, number] {
  const y = g.y_origin - (row + g.row0 + 0.5) * g.cell_m;
  const x = g.x_origin + (col + g.col0 + 0.5) * g.cell_m;
  const lat = y / g.R;
  return [((x / (g.R * Math.cos(lat))) * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Row/col window of the cells a lon/lat ring can touch (clamped to the grid); null when it misses the grid. */
export function ringWindow(g: PxGrid, ring: readonly [number, number][]): { r0: number; r1: number; c0: number; c1: number } | null {
  let r0 = Infinity;
  let r1 = -Infinity;
  let c0 = Infinity;
  let c1 = -Infinity;
  // Sinusoidal x depends on latitude: check every vertex and the ring's lat extremes at each vertex's lon.
  const lats = ring.map((p) => p[1]);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  for (const [lon, lat] of ring) {
    for (const la of [lat, latMin, latMax]) {
      const a = (la * Math.PI) / 180;
      const x = g.R * ((lon * Math.PI) / 180) * Math.cos(a);
      const y = g.R * a;
      const row = Math.floor((g.y_origin - y) / g.cell_m) - g.row0;
      const col = Math.floor((x - g.x_origin) / g.cell_m) - g.col0;
      r0 = Math.min(r0, row);
      r1 = Math.max(r1, row);
      c0 = Math.min(c0, col);
      c1 = Math.max(c1, col);
    }
  }
  r0 = Math.max(0, r0);
  c0 = Math.max(0, c0);
  r1 = Math.min(g.H - 1, r1);
  c1 = Math.min(g.W - 1, c1);
  return r0 > r1 || c0 > c1 ? null : { r0, r1, c0, c1 };
}

/** Chunk keys a row/col window needs. */
export function windowChunks(w: { r0: number; r1: number; c0: number; c1: number }, size = 64): string[] {
  const out: string[] = [];
  for (let a = Math.floor(w.r0 / size); a <= Math.floor(w.r1 / size); a++)
    for (let b = Math.floor(w.c0 / size); b <= Math.floor(w.c1 / size); b++) out.push(`${a}_${b}`);
  return out;
}

export interface OutlineStats {
  /** pasture pixels inside, by tier (1–6) */
  tiers: Record<TierKey, number>;
  pasture: number;
  /** masked pixels inside, by mask key */
  masked: Record<string, number>;
  /** km² of one pixel */
  pixelKm2: number;
}

const TIER_BY_CODE: Record<number, TierKey> = { 1: 'decline', 2: 'early_decline', 3: 'stable', 4: 'early_growth', 5: 'growth', 6: 'insufficient' };

/** Count the pixels of one chunk whose centre lies inside the ring, into `acc`. */
export function tallyChunk(
  acc: OutlineStats,
  buf: ArrayBuffer,
  meta: PxMeta,
  key: string,
  w: { r0: number; r1: number; c0: number; c1: number },
  inside: (lon: number, lat: number) => boolean,
): void {
  const size = meta.chunk;
  const [kr, kc] = key.split('_').map(Number);
  const tier = new Uint8Array(buf, meta.layout.find((f) => f.name === 'tier')!.offset, size * size);
  const rA = Math.max(w.r0, kr * size);
  const rB = Math.min(w.r1, kr * size + size - 1);
  const cA = Math.max(w.c0, kc * size);
  const cB = Math.min(w.c1, kc * size + size - 1);
  for (let row = rA; row <= rB; row++)
    for (let col = cA; col <= cB; col++) {
      const code = tier[(row % size) * size + (col % size)];
      if (code === 0) continue;
      const [lon, lat] = pixelCenter(meta.grid, row, col);
      if (!inside(lon, lat)) continue;
      const t = TIER_BY_CODE[code];
      if (t) {
        acc.tiers[t]++;
        acc.pasture++;
      } else {
        const k = meta.codes[String(code)]?.key ?? 'other';
        acc.masked[k] = (acc.masked[k] ?? 0) + 1;
      }
    }
}

export function emptyOutlineStats(meta: PxMeta): OutlineStats {
  return {
    tiers: { decline: 0, early_decline: 0, stable: 0, early_growth: 0, growth: 0, insufficient: 0 },
    pasture: 0,
    masked: {},
    pixelKm2: (meta.grid.cell_m * meta.grid.cell_m) / 1e6,
  };
}

/* ---------- overview choropleth (Central Asia at low zoom) ---------- */

/** Up to this zoom the Central Asia view shades regions; from the next level the 1 km pixels are readable. */
export const OVERVIEW_MAX_ZOOM = 6;
/** Upper bounds of the share bins (the last bin is open). */
export const CHORO_BINS = [0.05, 0.1, 0.2] as const;
/** Fill opacity per bin, over the class colour. */
export const CHORO_OPACITY = [0.12, 0.28, 0.44, 0.6] as const;
/** Regions with fewer pasture pixels than this are left unshaded (a few pixels make a share meaningless). */
export const CHORO_MIN_PX = 200;

export type OverviewKind = 'decline' | 'growth';

/** Share of pasture area with a reliable or possible decline (or growth). */
export function directionShare(st: PxStats, kind: OverviewKind): number {
  return kind === 'decline' ? (st.trend.decline ?? 0) + (st.trend.early_decline ?? 0) : (st.trend.growth ?? 0) + (st.trend.early_growth ?? 0);
}

/** Bin index 0–3 of a share; null when the region has too little pasture to shade. */
export function choroplethBin(st: PxStats | undefined, kind: OverviewKind): number | null {
  if (!st || st.n_pasture_px < CHORO_MIN_PX) return null;
  const v = directionShare(st, kind);
  const i = CHORO_BINS.findIndex((b) => v < b);
  return i < 0 ? CHORO_BINS.length : i;
}

export const CHORO_LABELS = ['under 5%', '5–10%', '10–20%', '20% or more'] as const;

/** Whether the overview shading shows: Central Asia (several countries) with 1 km statistics, Trend layer, low zoom, no region or matrix filter. */
export function overviewActive(o: { hasStats: boolean; multi: boolean; layer: 'trend' | 'level'; zoom: number; filtered: boolean }): boolean {
  return o.hasStats && o.multi && o.layer === 'trend' && o.zoom > 0 && o.zoom <= OVERVIEW_MAX_ZOOM && !o.filtered;
}

/* ---------- weather model: beyond weather, expected greenness, what-if ---------- */

/** Whether the export has the "beyond weather" layer. */
export const hasResid = (px: PxInfo | null | undefined): boolean => !!px?.meta.tiles.layers?.includes('resid');

/** Statistics with the trend shares swapped for the "beyond weather" shares (when shown and available). */
export function sharesFor(st: PxStats, resid: boolean): PxStats {
  return resid && st.resid ? { ...st, trend: st.resid } : st;
}

/** Label of a class on a layer: code 6 reads "No model output" on the beyond-weather layer. */
export function layerLabel(meta: PxMeta, code: number, resid: boolean): string {
  if (resid && code === 6) return 'No model output';
  return meta.codes[String(code)]?.label ?? '';
}

export function layerInlineLabel(meta: PxMeta, code: number, resid: boolean): string {
  if (resid && code === 6) return 'no model output';
  return inlineLabel(meta, code);
}

/** "Summer 2025 vs weather: below usual (21st percentile)". */
export function seasonLine(season: PxExpected['season']): string | null {
  if (!season) return null;
  const word = season.class === 'below' ? 'below usual' : season.class === 'above' ? 'above usual' : 'within the usual range';
  return `Summer ${season.year} vs weather: ${word} (${ord(Math.round(season.percentile))} percentile)`;
}

/** What-if table for the scope: a region, else a country, else all. */
export function whatifScope(w: PxWhatIf | null | undefined, district: string | null, country: string | null): WhatIfEntry | null {
  if (!w) return null;
  if (district) return w.regions[district] ?? null;
  if (country) return w.countries?.[country] ?? null;
  return w.all;
}

/** Expected NDVI for a month under a precipitation (%) and temperature (°C) change; null off the table. */
export function whatifValue(
  w: PxWhatIf,
  e: WhatIfEntry,
  month: number,
  precipPct: number,
  tempC: number,
): { typical: number; change: number; expected: number } | null {
  const m = w.months.indexOf(month);
  const p = w.precip_pct.indexOf(precipPct);
  const t = w.temp_c.indexOf(tempC);
  if (m < 0 || p < 0 || t < 0) return null;
  const typical = e.typical[m];
  const change = e.change[m]?.[p]?.[t];
  if (typical === undefined || change === undefined) return null;
  return { typical, change, expected: typical + change };
}
