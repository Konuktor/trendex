/** Native 1 km layer: sinusoidal lookup, chunk decode, shares, legend and the pixel card text. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chunkOf,
  decodePixel,
  fillGaps,
  inlineLabel,
  isPxMeta,
  legendCodes,
  Lru,
  choroplethBin,
  directionShare,
  emptyOutlineStats,
  overviewActive,
  pixelCenter,
  pixelCorners,
  pixelRowCol,
  ringWindow,
  tallyChunk,
  windowChunks,
  pxMatrixShare,
  pxScope,
  shortLabel,
  tierPercents,
  tierTrend,
  tileUrl,
  type PxMeta,
  type PxRegions,
  type PxStats,
} from './px';
import { pixelChart, tierSentence } from '../components/card/PixelBlock';

const ROOT = resolve(__dirname, '../..');
const PX = resolve(ROOT, 'public/data/v1/px');
const hasPx = existsSync(resolve(PX, 'meta.json'));

/** A small meta with the real layout (64 × 64 cells, 26 years). */
const N = 64 * 64;
const META: PxMeta = {
  dataset: 'naryn',
  years: [2000, 2025],
  chunk: 64,
  chunkBytes: 7 * N + N + 26 * N,
  grid: { R: 6371007.181, cell_m: 926.625433055833, x_origin: -20015109.354, y_origin: 10007554.677, row0: 5684, col0: 28133, H: 304, W: 531 },
  layout: [
    { name: 'tier', dtype: 'uint8', offset: 0, count: N },
    { name: 'level', dtype: 'uint8', offset: N, count: N },
    { name: 'score', dtype: 'uint8', offset: 2 * N, count: N },
    { name: 'slope_pct_decade_x10', dtype: 'int16', offset: 3 * N, count: N },
    { name: 'p_x250', dtype: 'uint8', offset: 5 * N, count: N },
    { name: 'q_x250', dtype: 'uint8', offset: 6 * N, count: N },
    { name: 'region', dtype: 'uint8', offset: 7 * N, count: N },
    { name: 'series', dtype: 'uint8', offset: 8 * N, count: 26 * N },
  ],
  regions: ['AK', 'AT', 'JU'],
  codes: {
    '1': { key: 'decline', label: 'Reliable decline', color: '#C2410C' },
    '2': { key: 'early_decline', label: 'Possible decline (pixel p < 0.05)', color: '#FDBA74' },
    '3': { key: 'stable', label: 'No reliable trend', color: '#E4E4E7' },
    '4': { key: 'early_growth', label: 'Possible growth (pixel p < 0.05)', color: '#99D5E0' },
    '5': { key: 'growth', label: 'Reliable growth', color: '#0E7490' },
    '6': { key: 'insufficient', label: 'Not enough data', color: '#FFFFFF' },
    '21': { key: 'low', label: 'Low (relative)', color: '#DCEBD3' },
    '40': { key: 'water', label: 'Water', color: '#BFD7EA' },
    '46': { key: 'bare', label: 'Desert and bare ground', color: '#EDE6D6' },
  },
  legend: { trend: [1, 2, 3, 4, 5, 6, 40, 46], level: [21, 40, 46] },
  tiles: { url: 'px/tiles/{layer}/{z}/{x}/{y}.png', layers: ['trend', 'level'], minZoom: 3, maxNativeZoom: 8, bounds: [[40, 73], [43, 79]] },
};

const STATS: PxStats = {
  pasture_km2: 1000,
  n_pasture_px: 1160,
  trend: { decline: 0.021, early_decline: 0.0396, stable: 0.7527, early_growth: 0.1044, growth: 0.0823, insufficient: 0 },
  level: { low: 0.29, moderate: 0.41, good: 0.3 },
  matrix: {
    low: { decline: 0.0067, early_decline: 0.01, stable: 0.2125, early_growth: 0.0303, growth: 0.0198, insufficient: 0 },
    moderate: { decline: 0.0089, early_decline: 0.0183, stable: 0.2924, early_growth: 0.0391, growth: 0.0385, insufficient: 0 },
    good: { decline: 0.0048, early_decline: 0.0106, stable: 0.2533, early_growth: 0.0324, growth: 0.0224, insufficient: 0 },
  },
  excluded_km2: { water: 400, bare: 0 },
};

describe('sinusoidal lookup', () => {
  it('finds the 1 km cell of a point (values from the backend decode)', () => {
    expect(pixelRowCol(META.grid, 41.83, 75.13)).toEqual({ row: 96, col: 184 }); // Lake Son-Kul
    expect(pixelRowCol(META.grid, 41.428, 75.991)).toEqual({ row: 144, col: 304 }); // Naryn town
    expect(pixelRowCol(META.grid, 45, 75)).toBeNull();
    expect(chunkOf(96, 184)).toEqual({ key: '1_2', i: 32 * 64 + 56 });
  });

  it('draws the footprint around the point', () => {
    const rc = pixelRowCol(META.grid, 41.0, 75.6)!;
    const c = pixelCorners(META.grid, rc.row, rc.col);
    const lons = c.map((p) => p[0]);
    const lats = c.map((p) => p[1]);
    expect(Math.min(...lons)).toBeLessThanOrEqual(75.6);
    expect(Math.max(...lons)).toBeGreaterThan(75.6);
    expect(Math.min(...lats)).toBeLessThanOrEqual(41.0);
    expect(Math.max(...lats)).toBeGreaterThan(41.0);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(926.6 / 111195, 3);
  });
});

describe('chunk decode', () => {
  it('reads every field of a cell (series year-major, int16 little-endian)', () => {
    const buf = new ArrayBuffer(META.chunkBytes);
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    const i = 1234;
    u8[i] = 2;
    u8[N + i] = 21;
    u8[2 * N + i] = 54;
    dv.setInt16(3 * N + 2 * i, -41, true);
    u8[5 * N + i] = 8; // p = 0.032
    u8[6 * N + i] = 53; // q = 0.212
    u8[7 * N + i] = 2; // AT
    for (let y = 0; y < 26; y++) u8[8 * N + y * N + i] = y === 3 ? 255 : 127;
    const p = decodePixel(buf, i, META);
    expect(p).toMatchObject({ code: 2, levelCode: 21, score: 54, slopeDecade: -4.1, p: 0.032, q: 0.212, region: 'AT' });
    expect(p.series).toHaveLength(26);
    expect(p.series[3]).toBeNull();
    expect(p.series[0]).toBeCloseTo((127 / 254) * 1.2 - 0.2, 9);
  });

  it('reports missing values as null', () => {
    const buf = new ArrayBuffer(META.chunkBytes);
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    u8[0] = 40;
    u8[2 * N] = 255;
    dv.setInt16(3 * N, -32768, true);
    u8[5 * N] = 255;
    u8[6 * N] = 255;
    expect(decodePixel(buf, 0, META)).toMatchObject({ code: 40, score: null, slopeDecade: null, p: null, q: null, region: null });
  });

  it.runIf(hasPx)('decodes the real Naryn export: Lake Son-Kul is water, Naryn town is built-up', () => {
    const meta = JSON.parse(readFileSync(resolve(PX, 'meta.json'), 'utf8')) as PxMeta;
    expect(isPxMeta(meta)).toBe(true);
    const at = (lat: number, lon: number) => {
      const rc = pixelRowCol(meta.grid, lat, lon)!;
      const { key, i } = chunkOf(rc.row, rc.col, meta.chunk);
      const b = readFileSync(resolve(PX, `chunks/${key}.bin`));
      expect(b.byteLength).toBe(meta.chunkBytes);
      return decodePixel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), i, meta);
    };
    expect(meta.codes[String(at(41.83, 75.13).code)].key).toBe('water');
    expect(meta.codes[String(at(41.428, 75.991).code)].key).toBe('urban');
    const valley = at(41.0, 75.6);
    expect(valley.code).toBeGreaterThanOrEqual(1);
    expect(valley.code).toBeLessThanOrEqual(6);
    expect(valley.series.filter((v) => v !== null).length).toBeGreaterThan(20);
  });
});

describe('shares and legend', () => {
  const R: PxRegions = { all: STATS, regions: { KO: { ...STATS, pasture_km2: 10 } }, countries: { KGZ: { ...STATS, pasture_km2: 20 } } };

  it('picks the scope: region, else country, else all', () => {
    expect(pxScope(R, 'KO', 'KGZ')!.pasture_km2).toBe(10);
    expect(pxScope(R, null, 'KGZ')!.pasture_km2).toBe(20);
    expect(pxScope(R, null, null)).toBe(STATS);
    expect(pxScope(R, 'XX', null)).toBeNull();
    expect(pxScope(null, null, null)).toBeNull();
  });

  it('rounds tier shares to whole percentages that add up to 100', () => {
    const pc = tierPercents(STATS);
    // 2.1, 3.96, 75.27, 10.44, 8.23: plain rounding gives 99, the largest remainders (.96, .44) take the two points
    expect(pc).toEqual({ decline: 2, early_decline: 4, stable: 75, early_growth: 11, growth: 8, insufficient: 0 });
    expect(Object.values(pc).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('builds the level × trend matrix from the joint shares (possible trends count as not reliable)', () => {
    expect(pxMatrixShare(STATS, 'moderate', 'dec')).toBe(1);
    expect(pxMatrixShare(STATS, 'moderate', 'nr')).toBe(35);
    expect(pxMatrixShare(STATS, 'low', 'inc')).toBe(2);
    expect(pxMatrixShare({ ...STATS, matrix: undefined }, 'low', 'dec')).toBeNull();
  });

  it('lists the legend classes that cover any area', () => {
    expect(legendCodes(META, 'trend', STATS)).toEqual([1, 2, 3, 4, 5, 6, 40]);
    expect(legendCodes(META, 'level', STATS)).toEqual([21, 40]);
    expect(legendCodes(META, 'trend', null)).toEqual(META.legend.trend);
  });

  it('builds tile URLs and short labels from the export', () => {
    expect(tileUrl({ base: '/data/v1', meta: META, regions: null }, 'level')).toBe('/data/v1/px/tiles/level/{z}/{x}/{y}.png');
    expect(shortLabel(META, 2)).toBe('Possible decline');
    expect(inlineLabel(META, 4)).toBe('possible growth');
    expect(isPxMeta({ hello: 1 })).toBe(false);
    expect(isPxMeta(null)).toBe(false);
  });
});

describe('pixel card', () => {
  const base = { levelCode: 21, score: 54, slopeDecade: -4.1, p: 0.032, q: 0.212, region: 'AT', series: Array.from({ length: 26 }, (_, i) => 0.4 - i * 0.002) };

  it('says "possible" and why it is not yet reliable for tiers 2 and 4', () => {
    expect(tierSentence({ ...base, code: 2 }, META)).toBe(
      'Possible decline: −4.1% per decade, p = 0.032. Not yet reliable: it does not pass the correction for testing every pixel (q = 0.21).',
    );
    expect(tierSentence({ ...base, code: 1, q: 0.02 }, META)).toMatch(/^Reliable decline: −4\.1% per decade, p = 0\.032\. It passes the correction/);
    expect(tierSentence({ ...base, code: 3 }, META)).toMatch(/^No reliable trend: /);
    expect(tierSentence({ ...base, code: 6 }, META)).toBe('Not enough clear seasons for a trend at this pixel.');
  });

  it('charts the pixel series with its own slope, filling gaps', () => {
    const series = base.series.map((v, i) => (i === 5 ? null : v));
    const c = pixelChart({ ...base, code: 2, series })!;
    expect(c.trend).toBe('nr');
    expect(c.model.slope).toBe(-0.4);
    expect(c.model.values).toHaveLength(26);
    expect(c.model.values[5]).toBeCloseTo((series[4]! + series[6]!) / 2, 9);
    expect(c.model.cov).toBeCloseTo(25 / 26, 9);
    expect(tierTrend(1)).toBe('dec');
    expect(tierTrend(5)).toBe('inc');
    expect(pixelChart({ ...base, code: 3, series: Array(26).fill(null) })).toBeNull();
  });

  it('fills gaps linearly and holds the ends', () => {
    expect(fillGaps([null, 1, null, 3, null])).toEqual([1, 1, 2, 3, 3]);
    expect(fillGaps([null, 1, null])).toBeNull();
  });
});

describe('chunk cache', () => {
  it('keeps the most recently used entries', () => {
    const c = new Lru<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect([c.get('a'), c.get('b'), c.get('c'), c.size]).toEqual([1, undefined, 3, 2]);
  });
});

describe('pixels inside a drawn outline', () => {
  it('maps a pixel centre back into its own cell', () => {
    const [lon, lat] = pixelCenter(META.grid, 96, 184);
    expect(pixelRowCol(META.grid, lat, lon)).toEqual({ row: 96, col: 184 });
  });

  it('finds the window and chunks an outline covers, clamped to the grid', () => {
    const ring: [number, number][] = [[75.3, 41.1], [75.9, 41.1], [75.9, 40.8], [75.3, 40.8]];
    const w = ringWindow(META.grid, ring)!;
    for (const [lon, lat] of ring) {
      const rc = pixelRowCol(META.grid, lat, lon)!;
      expect(rc.row).toBeGreaterThanOrEqual(w.r0);
      expect(rc.row).toBeLessThanOrEqual(w.r1);
      expect(rc.col).toBeGreaterThanOrEqual(w.c0);
      expect(rc.col).toBeLessThanOrEqual(w.c1);
    }
    expect(windowChunks({ r0: 60, r1: 70, c0: 0, c1: 130 })).toEqual(['0_0', '0_1', '0_2', '1_0', '1_1', '1_2']);
    expect(ringWindow(META.grid, [[10, 10], [11, 10], [11, 11]])).toBeNull();
  });

  it('counts pasture tiers and masks of the pixels whose centre is inside', () => {
    const buf = new ArrayBuffer(META.chunkBytes);
    const u8 = new Uint8Array(buf);
    // chunk 0_0: row 1 has tiers 1, 2, 3 and water in columns 0..3; everything else is outside the study area (0)
    [1, 2, 3, 40].forEach((code, c) => (u8[1 * 64 + c] = code));
    const acc = emptyOutlineStats(META);
    const w = { r0: 0, r1: 3, c0: 0, c1: 3 };
    const inside = (lon: number) => lon < pixelCenter(META.grid, 1, 2)[0] + 1e-9; // columns 0..2 only: the water in column 3 is outside
    tallyChunk(acc, buf, META, '0_0', w, inside);
    expect(acc.pasture).toBe(3);
    expect(acc.tiers).toMatchObject({ decline: 1, early_decline: 1, stable: 1 });
    expect(acc.masked).toEqual({});
    const all = emptyOutlineStats(META);
    tallyChunk(all, buf, META, '0_0', w, () => true);
    expect(all.masked).toEqual({ water: 1 });
    expect(all.pixelKm2).toBeCloseTo(0.8586, 3);
  });
});

describe('Central Asia overview shading', () => {
  it('bins the share of pasture with a reliable or possible decline or growth', () => {
    expect(directionShare(STATS, 'decline')).toBeCloseTo(0.0606, 9);
    expect(directionShare(STATS, 'growth')).toBeCloseTo(0.1867, 9);
    expect(choroplethBin(STATS, 'decline')).toBe(1); // 6%: 5–10%
    expect(choroplethBin(STATS, 'growth')).toBe(2); // 19%: 10–20%
    const t = (d: number) => ({ ...STATS, trend: { ...STATS.trend, decline: d, early_decline: 0 } });
    expect([0.01, 0.05, 0.1, 0.2, 0.9].map((d) => choroplethBin(t(d), 'decline'))).toEqual([0, 1, 2, 3, 3]);
    expect(choroplethBin({ ...STATS, n_pasture_px: 10 }, 'decline')).toBeNull();
    expect(choroplethBin(undefined, 'decline')).toBeNull();
  });

  it('shows only for several countries, the Trend layer, zoom 6 or less and no region or matrix filter', () => {
    const on = { hasStats: true, multi: true, layer: 'trend' as const, zoom: 4.6, filtered: false };
    expect(overviewActive(on)).toBe(true);
    expect(overviewActive({ ...on, zoom: 6 })).toBe(true);
    expect(overviewActive({ ...on, zoom: 6.1 })).toBe(false);
    expect(overviewActive({ ...on, multi: false })).toBe(false);
    expect(overviewActive({ ...on, layer: 'level' })).toBe(false);
    expect(overviewActive({ ...on, filtered: true })).toBe(false);
    expect(overviewActive({ ...on, hasStats: false })).toBe(false);
  });
});
