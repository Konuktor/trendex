/**
 * Two datasets: the Naryn pilot and Central Asia. Grid, regions, naming, zones and the answer copy
 * must follow the active dataset, and fall back to Naryn (the mock) by default.
 */
import { contours } from 'd3-contour';
import { CELL_KM, CELL_KM2, cellCenter, cellIdOf, COLS, getGrid, LON0, NARYN_GRID, setGrid, toCell, type Grid } from './geo';
import { DISTRICT_ORDER } from './mask';
import {
  coverageText,
  NARYN_REGION_META,
  regionFull,
  regionGroups,
  regionLabel,
  regionName,
  regionOrder,
  relativeNote,
  setRegionContext,
  studyTitle,
  type RegionMeta,
} from './regions';
import { nearest, parseSearch, placeName, PLACES } from './places';
import { selectZone, smoothPolygon, upsampleFor } from './zones';
import { answer } from './answer';
import { countryRow, districtRow, districtRows } from './stats';
import { districtPanels } from './trends';
import { buildQueue } from './queue';
import { datasetBase, parseDataset } from '../data/dataset';
import { inferGrid, normaliseMeta } from '../data/source';
import { queueFor, type QueueItem } from '../store';
import { fixture } from '../test/fixtures';
import type { Cell, DataSet, Level, Trend } from './types';

const CA_GRID: Grid = { cols: 30, rows: 20, lon0: 70, lat0: 46, dlon: 0.24, dlat: 0.18, cellKm2: 400 };

const CA_META: RegionMeta = {
  dataset: 'ca',
  title: 'Central Asia',
  regionLabel: { en: 'Region', ru: 'Регион' },
  regions: [
    { code: 'KZ-jambyl-region', name: 'Jambyl Region', country: 'KAZ', iso2: 'KZ', countryName: 'Kazakhstan' },
    { code: 'KG-chuy-region', name: 'Chuy Region', country: 'KGZ', iso2: 'KG', countryName: 'Kyrgyzstan' },
    { code: 'KZ-almaty-region', name: 'Almaty Region', country: 'KAZ', iso2: 'KZ', countryName: 'Kazakhstan' },
  ],
};

/** A small synthetic Central Asia dataset on CA_GRID (cell centres from the grid). */
function caData(): DataSet {
  const cells: Cell[] = [];
  for (let r = 0; r < CA_GRID.rows; r++)
    for (let c = 0; c < CA_GRID.cols; c++) {
      const lon = CA_GRID.lon0 + (c + 0.5) * CA_GRID.dlon;
      const lat = CA_GRID.lat0 - (r + 0.5) * CA_GRID.dlat;
      const d = r >= 10 ? 'KG-chuy-region' : c < 15 ? 'KZ-jambyl-region' : 'KZ-almaty-region';
      const pct = (c * 7 + r * 13) % 100;
      const level: Level = pct < 33 ? 'low' : pct < 66 ? 'moderate' : 'good';
      const trend: Trend = (c + r) % 5 === 0 ? 'dec' : (c + r) % 5 === 1 ? 'inc' : 'nr';
      cells.push({
        id: `${c},${r}`, c, r, lon, lat, d, country: d.slice(0, 2), kind: 'pasture', why: '', water: false,
        pct, level, slope: trend === 'dec' ? -1.2 : trend === 'inc' ? 0.9 : 0.1, trend, strong: trend === 'dec',
        cov: 0.9, seasons: 23, conf: 'Medium',
      });
    }
  const byId: Record<string, Cell> = {};
  for (const x of cells) byId[x.id] = x;
  return { cells, past: cells, byId, demo: '5,5', low: null, excl: null };
}

function useCa(data = caData()) {
  setGrid(CA_GRID);
  setRegionContext(CA_META, data.cells);
  return data;
}

afterEach(() => {
  setGrid();
  setRegionContext(NARYN_REGION_META);
});

describe('runtime grid', () => {
  it('defaults to the Naryn grid', () => {
    expect(getGrid()).toEqual(NARYN_GRID);
    const [lon, lat] = cellCenter(0, 0);
    expect(lon).toBeCloseTo(73.66, 9);
    expect(lat).toBeCloseTo(42.505, 9);
    expect([COLS, CELL_KM2, CELL_KM]).toEqual([40, 100, 10]);
  });

  it('follows meta.grid for every importer (live bindings)', () => {
    setGrid(CA_GRID);
    expect(LON0).toBe(70);
    expect(COLS).toBe(30);
    expect(CELL_KM2).toBe(400);
    expect(CELL_KM).toBe(20);
    const [lon, lat] = cellCenter(3, 2);
    expect(lon).toBeCloseTo(70.84, 9);
    expect(lat).toBeCloseTo(45.55, 9);
    expect(cellIdOf(lat, lon)).toBe('3,2');
    const k = toCell(70.12, 45.91);
    expect(k.c).toBeCloseTo(0.5, 9);
    expect(k.r).toBeCloseTo(0.5, 9);
  });

  it('falls back to Naryn for a missing or invalid grid and estimates a missing cell area', () => {
    setGrid(CA_GRID);
    setGrid({ cols: 0, rows: 3, lon0: 1, lat0: 1, dlon: 1, dlat: 1 });
    expect(getGrid()).toEqual(NARYN_GRID);
    setGrid({ ...CA_GRID, cellKm2: undefined });
    expect(CELL_KM2).toBeGreaterThan(300);
    expect(CELL_KM2).toBeLessThan(450);
  });
});

describe('dataset base URL', () => {
  it('maps the Naryn folder to the sibling ca/v1 folder', () => {
    expect(datasetBase('naryn', '/data/v1')).toBe('/data/v1');
    expect(datasetBase('ca', '/data/v1')).toBe('/data/ca/v1');
    expect(datasetBase('ca', '/data/v1/')).toBe('/data/ca/v1');
    expect(datasetBase('ca', 'https://api.example.kg/trendex/v1')).toBe('https://api.example.kg/trendex/ca/v1');
    expect([parseDataset('ca'), parseDataset('x'), parseDataset(null)]).toEqual(['ca', 'naryn', 'naryn']);
  });
});

describe('regions', () => {
  it('default to the Naryn districts and copy', () => {
    expect(regionOrder()).toEqual(DISTRICT_ORDER);
    expect(regionName('KO')).toBe('Kochkor');
    expect(regionFull('KO')).toBe('Kochkor');
    expect(regionLabel()).toBe('District');
    expect(relativeNote()).toBe('Relative to other pastures in Naryn oblast');
    expect(coverageText()).toBe('TrendeX covers Naryn oblast and the Suusamyr valley');
  });

  it('come from meta.regions and group by country when there are several', () => {
    useCa();
    expect(studyTitle()).toBe('Central Asia');
    expect(regionLabel()).toBe('Region');
    expect(relativeNote()).toBe('Relative to other pastures in Central Asia');
    expect(regionGroups().map((g) => [g.countryName, g.codes])).toEqual([
      ['Kazakhstan', ['KZ-almaty-region', 'KZ-jambyl-region']],
      ['Kyrgyzstan', ['KG-chuy-region']],
    ]);
    expect(regionOrder()).toEqual(['KZ-almaty-region', 'KZ-jambyl-region', 'KG-chuy-region']);
    expect(regionFull('KG-chuy-region')).toBe('Chuy Region, Kyrgyzstan');
    expect(regionName('unknown-code')).toBe('unknown-code');
    expect(coverageText()).toBe('TrendeX covers Central Asia: Kazakhstan and Kyrgyzstan');
  });

  it('region rows and panels follow the region order', () => {
    const data = useCa();
    const rows = districtRows(data.past);
    for (const d of regionOrder()) expect({ ...rows.get(d)!, n: undefined, nDec: undefined, nInc: undefined }).toEqual({ ...districtRow(data.past, d)!, n: undefined, nDec: undefined, nInc: undefined });
    const kz = countryRow(['KZ-almaty-region', 'KZ-jambyl-region'].map((d) => rows.get(d)!));
    const kzCells = data.past.filter((x) => x.d.startsWith('KZ'));
    expect(kz.km2).toBe(kzCells.length * 400);
    expect(kz.dec).toBe(Math.round((100 * kzCells.filter((x) => x.trend === 'dec').length) / kzCells.length));
    expect(districtPanels(data.past).map((p) => p.d).sort()).toEqual([...regionOrder()].sort());
  });

  it('Naryn district rows are unchanged by the one-pass version', () => {
    const { data } = fixture();
    const rows = districtRows(data.past);
    for (const d of DISTRICT_ORDER) {
      const a = districtRow(data.past, d)!;
      expect(rows.get(d)).toMatchObject(a);
    }
  });
});

describe('places in Central Asia', () => {
  it('names a point near a city "Around <city>" and otherwise by region and distance from its centre', () => {
    useCa();
    // Taraz (42.9 N, 71.367 E) lies inside this small grid
    const k = toCell(71.367, 42.9 + 3 * 0.18); // 3 cells north of Taraz
    expect(placeName(k.c, k.r, false, 'KZ-jambyl-region')).toMatch(/^Jambyl Region, \d+ km [NSEW]{1,2} of centre$|^Centre of Jambyl Region$/);
    const t = toCell(71.367, 42.9);
    expect(placeName(t.c, t.r)).toBe('Around Taraz');
    expect(nearest(t.c, t.r).p.en).toBe('Taraz');
  });

  it('searches CA cities in Latin and Cyrillic, and region names', () => {
    useCa();
    expect(parseSearch('Ташкент')[0]).toMatchObject({ kind: 'place', label: 'Tashkent', lat: 41.311, lon: 69.279 });
    expect(parseSearch('bish')[0]).toMatchObject({ label: 'Bishkek' });
    expect(parseSearch('Jambyl').map((s) => s.label)).toContain('Jambyl Region');
    expect(parseSearch('43.24, 76.95')[0]).toMatchObject({ kind: 'coords', lat: 43.24, lon: 76.95 });
  });

  it('keeps the Naryn places and naming when Naryn is active', () => {
    const s = PLACES[0];
    expect(placeName(s.c, s.r)).toBe('Around Suusamyr');
    expect(parseSearch('Ташкент')).toEqual([]);
  });
});

/** The original full-grid implementation (×8, whole grid plus 2 cells of padding), for comparison. */
function fullGridSmooth(list: readonly Cell[]) {
  const UP = 8;
  const PAD = 2;
  const SIGMA = 0.26 * UP;
  const GW = (40 + 2 * PAD) * UP;
  const GH = (22 + 2 * PAD) * UP;
  const rad = Math.ceil(SIGMA * 3);
  const K: number[] = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = Math.exp(-(i * i) / (2 * SIGMA * SIGMA));
    K.push(v);
    sum += v;
  }
  const KK = K.map((v) => v / sum);
  const a = new Float64Array(GW * GH);
  for (const x of list) {
    const x0 = (x.c + PAD) * UP;
    const y0 = (x.r + PAD) * UP;
    for (let y = y0; y < y0 + UP; y++) a.fill(1, y * GW + x0, y * GW + x0 + UP);
  }
  const tmp = new Float64Array(GW * GH);
  const out = new Float64Array(GW * GH);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) if (x + k >= 0 && x + k < GW) s += a[y * GW + x + k] * KK[k + rad];
      tmp[y * GW + x] = s;
    }
  for (let x = 0; x < GW; x++)
    for (let y = 0; y < GH; y++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) if (y + k >= 0 && y + k < GH) s += tmp[(y + k) * GW + x] * KK[k + rad];
      out[y * GW + x] = s;
    }
  const [mp] = contours().size([GW, GH]).thresholds([0.45])(Array.from(out));
  return mp.coordinates.map((poly) =>
    poly.map((ring) => ring.map(([px, py]) => [+(73.6 + (px / UP - PAD) * 0.12).toFixed(5), +(42.55 - (py / UP - PAD) * 0.09).toFixed(5)])),
  );
}

describe('smoothed zones on any grid', () => {
  it('upsamples ×8 on the Naryn grid and less on large grids', () => {
    expect(upsampleFor(40, 22)).toBe(8);
    expect(upsampleFor(171, 114)).toBe(4);
  });

  it('cropping to the cells gives the same Naryn polygons as a raster of the whole grid', () => {
    const { data } = fixture();
    const sets = [
      selectZone(data, '3,4', 'trend')!.cells,
      data.cells.filter((x) => x.trend === 'dec' && x.kind === 'pasture'),
      data.cells.filter((x) => x.level === 'good'),
    ];
    for (const cells of sets) {
      const got = smoothPolygon(cells)!.coordinates;
      const want = fullGridSmooth(cells);
      expect(got.length).toBe(want.length);
      let maxErr = 0;
      got.forEach((poly, i) =>
        poly.forEach((ring, j) => {
          expect(ring.length).toBe(want[i][j].length);
          ring.forEach((p, k) => (maxErr = Math.max(maxErr, Math.abs(p[0] - want[i][j][k][0]), Math.abs(p[1] - want[i][j][k][1]))));
        }),
      );
      expect(maxErr).toBeLessThanOrEqual(1e-5);
    }
  });

  it('a single CA cell becomes a rounded blob centred on the cell', () => {
    const data = useCa();
    const x = data.byId['10,7'];
    const ring = smoothPolygon([x])!.coordinates[0][0];
    expect(ring.length).toBeGreaterThan(8);
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    expect(Math.abs(lon - x.lon)).toBeLessThan(0.24 * 0.1);
    expect(Math.abs(lat - x.lat)).toBeLessThan(0.18 * 0.1);
    const lons = ring.map((p) => p[0]);
    const width = (Math.max(...lons) - Math.min(...lons)) / 0.24;
    expect(width).toBeGreaterThan(0.8);
    expect(width).toBeLessThan(1.2);
  });
});

describe('answer and queue in Central Asia', () => {
  it('uses the region, the title and 20 km cells', () => {
    const data = useCa();
    const a = answer(selectZone(data, '5,5', 'trend')!, data);
    if (a.kind !== 'pasture') throw new Error('expected a pasture');
    expect(a.sub).toMatch(/^Jambyl Region, Kazakhstan · zone of [\d,]+ km²$/);
    expect(a.takeaway).toContain('relative to other pastures in Central Asia');
    expect(a.why.some(([, t]) => t.includes('pastures in Central Asia'))).toBe(true);
    for (const b of a.better) {
      expect(b.km).toBeLessThanOrEqual(100);
      expect(b.km % 1).toBe(0);
    }
  });

  it('builds a queue whose areas add up to the declining pasture', () => {
    const data = useCa();
    const rows = buildQueue(data, []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.reduce((s, r) => s + r.km2, 0)).toBe(data.past.filter((x) => x.trend === 'dec').length * 400);
    expect(rows[0].districtName).toMatch(/, (Kazakhstan|Kyrgyzstan)$/);
  });

  it('keeps queue items per dataset (old items are Naryn)', () => {
    const q: QueueItem[] = [
      { key: '3,4', type: 'zone', cellId: '3,4', name: 'a', addedAt: 1 },
      { key: '3,4', type: 'zone', cellId: '3,4', name: 'b', addedAt: 2, ds: 'ca' },
    ];
    expect(queueFor(q, 'naryn').map((x) => x.name)).toEqual(['a']);
    expect(queueFor(q, 'ca').map((x) => x.name)).toEqual(['b']);
  });
});

describe('meta fallbacks', () => {
  it('infers the grid from cells when meta.grid is missing', () => {
    const data = caData();
    const g = inferGrid(data.cells)!;
    expect(g).toMatchObject({ cols: 30, rows: 20, lon0: 70, lat0: 46, dlon: 0.24, dlat: 0.18 });
  });

  it('fills dataset fields an older export does not have', () => {
    const { data } = fixture();
    const m = normaliseMeta('naryn', { dataStatus: 'production' }, data.cells);
    expect(m).toMatchObject({ dataset: 'naryn', title: 'Naryn oblast', grid: NARYN_GRID, regionLabel: { en: 'District' }, dataStatus: 'production' });
    expect(m.regions.map((r) => r.code)).toEqual(DISTRICT_ORDER);
    const c = normaliseMeta('ca', {}, caData().cells);
    expect(c).toMatchObject({ dataset: 'ca', title: 'Central Asia', regionLabel: { en: 'Region' }, dataStatus: 'sample' });
    expect(c.regions.map((r) => r.code).sort()).toEqual(['KG-chuy-region', 'KZ-almaty-region', 'KZ-jambyl-region']);
  });
});
