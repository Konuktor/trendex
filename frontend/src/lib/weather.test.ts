/** Weather model in the 1 km export: beyond-weather shares and labels, expected series, what-if lookup, pixel line. */
import { decodePixel, layerInlineLabel, layerLabel, seasonLine, sharesFor, whatifScope, whatifValue, type PxMeta, type PxStats, type PxWhatIf } from './px';
import { residLine } from '../components/card/PixelBlock';
import { expectedDomain, meaningLines } from '../components/weather/WeatherPanel';

const N = 64 * 64;
const META = {
  dataset: 'naryn',
  years: [2000, 2025],
  chunk: 64,
  chunkBytes: 8 * N + 26 * N + N + 2 * N,
  grid: { R: 6371007.181, cell_m: 926.6, x_origin: -20015109.354, y_origin: 10007554.677, row0: 0, col0: 0, H: 64, W: 64 },
  layout: [
    { name: 'tier', dtype: 'uint8', offset: 0, count: N },
    { name: 'level', dtype: 'uint8', offset: N, count: N },
    { name: 'score', dtype: 'uint8', offset: 2 * N, count: N },
    { name: 'slope_pct_decade_x10', dtype: 'int16', offset: 3 * N, count: N },
    { name: 'p_x250', dtype: 'uint8', offset: 5 * N, count: N },
    { name: 'q_x250', dtype: 'uint8', offset: 6 * N, count: N },
    { name: 'region', dtype: 'uint8', offset: 7 * N, count: N },
    { name: 'series', dtype: 'uint8', offset: 8 * N, count: 26 * N },
    { name: 'resid', dtype: 'uint8', offset: 34 * N, count: N },
    { name: 'resid_slope_ndvi_x1000_per_decade', dtype: 'int16', offset: 35 * N, count: N },
  ],
  regions: ['NA'],
  codes: {
    '2': { key: 'early_decline', label: 'Possible decline (pixel p < 0.05)', color: '#FDBA74' },
    '5': { key: 'growth', label: 'Reliable growth', color: '#0E7490' },
    '6': { key: 'insufficient', label: 'Not enough data', color: '#FFFFFF' },
  },
  legend: { trend: [], level: [], resid: [2, 5, 6] },
  tiles: { url: 'px/tiles/{layer}/{z}/{x}/{y}.png', layers: ['trend', 'level', 'resid'], minZoom: 3, maxNativeZoom: 8, bounds: [[0, 0], [1, 1]] },
} as PxMeta;

const T = { decline: 0.1, early_decline: 0.1, stable: 0.7, early_growth: 0.05, growth: 0.05, insufficient: 0 };
const R = { decline: 0.01, early_decline: 0.02, stable: 0.7, early_growth: 0.11, growth: 0.11, insufficient: 0.05 };
const ST: PxStats = { pasture_km2: 1, n_pasture_px: 1, trend: T, resid: R, level: { low: 0, moderate: 1, good: 0 }, excluded_km2: {} };

const W: PxWhatIf = {
  months: [5, 6, 7, 8, 9],
  precip_pct: [-30, -20, -10, 0, 10, 20, 30],
  temp_c: [-2, -1, 0, 1, 2],
  label: 'Model sensitivity, not a causal effect',
  meaning: 'Expected greenness change vs typical weather for that month. Model sensitivity, not a causal effect; not forage quality. Wetter-than-normal does not raise NDVI in this model (see model card).',
  all: { typical: [0.27, 0.37, 0.41, 0.36, 0.28], change: Array.from({ length: 5 }, (_, m) => Array.from({ length: 7 }, (_, p) => Array.from({ length: 5 }, (_, t) => m / 100 + p / 1000 - t / 10000))) },
  countries: { KGZ: { typical: [0.1, 0.1, 0.1, 0.1, 0.1], change: [] } },
  regions: { NA: { typical: [0.2, 0.2, 0.2, 0.2, 0.2], change: [] } },
};

describe('beyond weather', () => {
  it('swaps in the residual shares only when shown and available', () => {
    expect(sharesFor(ST, true).trend).toBe(R);
    expect(sharesFor(ST, false).trend).toBe(T);
    expect(sharesFor({ ...ST, resid: undefined }, true).trend).toBe(T);
  });

  it('labels code 6 "No model output" on the beyond-weather layer only', () => {
    expect(layerLabel(META, 6, true)).toBe('No model output');
    expect(layerLabel(META, 6, false)).toBe('Not enough data');
    expect(layerInlineLabel(META, 6, true)).toBe('no model output');
    expect(layerInlineLabel(META, 2, true)).toBe('possible decline');
  });

  it('decodes the residual tier and slope of a pixel', () => {
    const buf = new ArrayBuffer(META.chunkBytes);
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    u8[7] = 3;
    u8[34 * N + 7] = 2;
    dv.setInt16(35 * N + 14, -12, true);
    const p = decodePixel(buf, 7, META);
    expect(p).toMatchObject({ code: 3, resid: 2, residSlope: -0.012 });
    expect(residLine(p, META)).toBe('Beyond weather (Jun–Aug): Possible decline, −0.012 NDVI per decade.');
    dv.setInt16(35 * N + 14, -32768, true);
    u8[34 * N + 7] = 6;
    expect(residLine(decodePixel(buf, 7, META), META)).toBe('Beyond weather (Jun–Aug): no model output for this pixel.');
  });
});

describe('expected greenness and what-if', () => {
  it('states this summer against the weather', () => {
    expect(seasonLine({ year: 2025, residual: -0.0059, percentile: 20.8, class: 'below' })).toBe('Summer 2025 vs weather: below usual (21st percentile)');
    expect(seasonLine({ year: 2025, residual: 0, percentile: 62.5, class: 'within' })).toBe('Summer 2025 vs weather: within the usual range (63rd percentile)');
    expect(seasonLine({ year: 2024, residual: 0.01, percentile: 92, class: 'above' })).toBe('Summer 2024 vs weather: above usual (92nd percentile)');
    expect(seasonLine(undefined)).toBeNull();
  });

  it('frames the chart around the observed series and the band', () => {
    expect(expectedDomain({ years: [1, 2], observed: [0.31, 0.42], expected: [0.33, 0.4], p10: [0.27, 0.3], p90: [0.39, 0.44] })).toEqual([0.25, 0.45]);
  });

  it('looks up the scope and the expected value: typical + change[month][precip][temp]', () => {
    expect(whatifScope(W, 'NA', 'KGZ')).toBe(W.regions.NA);
    expect(whatifScope(W, null, 'KGZ')).toBe(W.countries!.KGZ);
    expect(whatifScope(W, null, null)).toBe(W.all);
    expect(whatifScope(W, 'SU', null)).toBeNull();
    const v = whatifValue(W, W.all, 7, 10, 1)!;
    expect(v.typical).toBe(0.41);
    expect(v.change).toBeCloseTo(0.02 + 0.004 - 0.0003, 9);
    expect(v.expected).toBeCloseTo(0.41 + 0.0237, 9);
    expect(whatifValue(W, W.all, 4, 0, 0)).toBeNull();
    expect(whatifValue(W, W.all, 7, 15, 0)).toBeNull();
  });

  it('keeps the meaning without repeating the label', () => {
    expect(meaningLines(W.meaning)).toEqual([
      'Expected greenness change vs typical weather for that month.',
      'Wetter-than-normal does not raise NDVI in this model (see model card).',
    ]);
  });
});
