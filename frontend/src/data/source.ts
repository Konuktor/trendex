import { NARYN_GRID, setGrid, type Grid } from '../lib/geo';
import { approxMask, buildMask } from '../lib/mask';
import { buildData } from '../lib/mock';
import { NARYN_REGION_META, setRegionContext } from '../lib/regions';
import { series } from '../lib/series';
import type { BoundaryFeature, Cell, DataSet, DatasetId, DatasetMeta, District, Region, StudyMask } from '../lib/types';
import { API_URL, datasetBase } from './dataset';
import { setDataInfo } from './info';
import { loadPx } from './px';
import type { PxInfo } from '../lib/px';

export interface Loaded {
  data: DataSet;
  mask: StudyMask;
  meta: DatasetMeta;
  /** native 1 km layer (px/), null when the export has none (mock, or an export from before px) */
  px: PxInfo | null;
}

/**
 * The one data-access interface. The mock implementation builds sample data
 * from the bundled boundary files; a real API can replace it later.
 */
export interface DataSource {
  getCells(ds?: DatasetId): Promise<Loaded>;
  getSeries(cellIds: string[], ds?: DatasetId): Promise<Record<string, number[]>>;
}

/** Make a loaded dataset the active one: grid, regions and data status used by the logic and the copy. */
export function activate({ data, meta }: Loaded): void {
  setGrid(meta.grid);
  setRegionContext(meta, data.cells);
  setDataInfo({ ...meta, dataStatus: meta.dataStatus });
}

const MOCK_META: DatasetMeta = {
  ...NARYN_REGION_META,
  grid: { ...NARYN_GRID },
  bounds: null,
  dataStatus: 'sample',
  pipelineVersion: '0.1.0 (sample data)',
};

interface FC {
  features: BoundaryFeature[];
}

async function loadJson(url: string): Promise<FC | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as FC;
  } catch {
    return null;
  }
}

let cached: Promise<Loaded> | null = null;

export const mockSource: DataSource = {
  getCells() {
    if (!cached) {
      cached = Promise.all([loadJson('/data/kgz-adm1.geojson'), loadJson('/data/kgz-adm2.geojson')]).then(
        ([a1, a2]) => {
          setGrid(NARYN_GRID);
          const mask = (a1 && buildMask(a1, a2)) || approxMask();
          return { data: buildData(mask), mask, meta: MOCK_META, px: null };
        },
      );
    }
    return cached;
  },
  async getSeries(cellIds) {
    const { data } = await this.getCells();
    const out: Record<string, number[]> = {};
    for (const id of cellIds) {
      const c: Cell | undefined = data.byId[id];
      if (c) out[id] = series(c);
    }
    return out;
  },
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface ApiMeta {
  dataset?: string;
  title?: string;
  grid?: Partial<Grid>;
  view?: { bounds?: [[number, number], [number, number]] };
  regions?: Region[];
  regionLabel?: { en?: string; ru?: string };
  boundaryFile?: string;
  regionsFile?: string;
  dataStatus?: string;
  pipelineVersion?: string;
  generatedAt?: string;
  sources?: Record<string, string>;
  method?: Record<string, string>;
  defaultCellId?: string | null;
  lowCellId?: string | null;
  excludedCellId?: string | null;
}

/** Grid from two cells far apart, for an export whose meta.json has no `grid`. */
export function inferGrid(cells: readonly Cell[]): Grid | null {
  if (cells.length < 2) return null;
  let a = cells[0];
  let b = cells[0];
  let t = cells[0];
  let u = cells[0];
  for (const x of cells) {
    if (x.c < a.c) a = x;
    if (x.c > b.c) b = x;
    if (x.r < t.r) t = x;
    if (x.r > u.r) u = x;
  }
  if (b.c === a.c || u.r === t.r) return null;
  const dlon = (b.lon - a.lon) / (b.c - a.c);
  const dlat = (t.lat - u.lat) / (u.r - t.r);
  const lon0 = a.lon - (a.c + 0.5) * dlon;
  const lat0 = t.lat + (t.r + 0.5) * dlat;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { cols: b.c + 1, rows: u.r + 1, lon0: round(lon0), lat0: round(lat0), dlon: round(dlon), dlat: round(dlat), cellKm2: 0 };
}

const DEFAULT_FILES: Record<DatasetId, [string, string]> = {
  naryn: ['oblast.geojson', 'districts.geojson'],
  ca: ['boundary.geojson', 'regions.geojson'],
};

/** The dataset-level meta with every fallback applied (older exports lack the dataset fields). */
export function normaliseMeta(ds: DatasetId, m: ApiMeta, cells: readonly Cell[]): DatasetMeta {
  const dataset: DatasetId = m.dataset === 'ca' || m.dataset === 'naryn' ? m.dataset : ds;
  const grid = (m.grid && Number.isFinite(m.grid.lon0) ? (m.grid as Grid) : null) ?? (dataset === 'naryn' ? { ...NARYN_GRID } : inferGrid(cells) ?? { ...NARYN_GRID });
  let regions = (m.regions ?? []).filter((r) => r && typeof r.code === 'string');
  if (!regions.length) {
    if (dataset === 'naryn') regions = [...NARYN_REGION_META.regions];
    else regions = [...new Set(cells.map((x) => x.d))].sort().map((code) => ({ code, name: code }));
  }
  const b = m.view?.bounds;
  return {
    dataset,
    title: m.title || (dataset === 'ca' ? 'Central Asia' : 'Naryn oblast'),
    grid,
    bounds: Array.isArray(b) && b.length === 2 ? b : null,
    regions,
    regionLabel: {
      en: m.regionLabel?.en || (dataset === 'ca' ? 'Region' : 'District'),
      ru: m.regionLabel?.ru || (dataset === 'ca' ? 'Регион' : 'Район'),
    },
    dataStatus: m.dataStatus === 'production' ? 'production' : 'sample',
    pipelineVersion: m.pipelineVersion,
    generatedAt: m.generatedAt,
    sources: m.sources,
    method: m.method,
  };
}

const apiCached = new Map<DatasetId, Promise<Loaded>>();

/**
 * Real data: the backend export (static files, no server). cells.json carries every study cell with its
 * yearly series; the boundary and region GeoJSON files are named in meta.json (Naryn: the oblast and its
 * 5 official districts; Central Asia: the outline and the ADM1 regions).
 */
export const apiSource: DataSource = {
  getCells(ds = 'naryn') {
    let p = apiCached.get(ds);
    if (!p) {
      const base = datasetBase(ds, API_URL);
      p = (async () => {
        const [m, body] = await Promise.all([getJson<ApiMeta>(`${base}/meta.json`), getJson<{ cells: Cell[] }>(`${base}/cells.json`)]);
        const [bf, rf] = DEFAULT_FILES[m.dataset === 'ca' ? 'ca' : ds];
        const [obl, dis, px] = await Promise.all([
          loadJson(`${base}/${m.boundaryFile || bf}`),
          loadJson(`${base}/${m.regionsFile || rf}`),
          loadPx(base),
        ]);
        const cells = [...body.cells].sort((a, b) => a.r - b.r || a.c - b.c);
        const byId: Record<string, Cell> = {};
        const mm: Record<string, District> = {};
        for (const c of cells) {
          byId[c.id] = c;
          mm[c.id] = c.d;
        }
        const past = cells.filter((c) => c.kind === 'pasture');
        const pick = (id: string | null | undefined) => (id && byId[id] ? id : null);
        const data: DataSet = {
          cells,
          past,
          byId,
          demo: pick(m.defaultCellId) ?? past[0]?.id ?? null,
          low: pick(m.lowCellId),
          excl: pick(m.excludedCellId),
        };
        const mask: StudyMask = { m: mm, oblast: obl?.features?.[0] ?? null, districts: dis?.features ?? [] };
        return { data, mask, meta: normaliseMeta(ds, m, cells), px };
      })().catch((e) => {
        apiCached.delete(ds);
        throw e;
      });
      apiCached.set(ds, p);
    }
    return p;
  },
  async getSeries(cellIds, ds = 'naryn') {
    const { data } = await this.getCells(ds);
    const out: Record<string, number[]> = {};
    for (const id of cellIds) {
      const c = data.byId[id];
      if (c) out[id] = c.series ?? series(c);
    }
    return out;
  },
};

/** Real data when VITE_API_URL is set (production build: /data/v1), sample data otherwise (dev, unit and e2e tests). */
export const source: DataSource = API_URL ? apiSource : mockSource;
