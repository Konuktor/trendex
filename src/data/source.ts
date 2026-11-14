import { approxMask, buildMask } from '../lib/mask';
import { buildData } from '../lib/mock';
import { series } from '../lib/series';
import type { BoundaryFeature, Cell, DataSet, District, StudyMask } from '../lib/types';
import { setDataInfo } from './info';

/**
 * The one data-access interface. The mock implementation builds sample data
 * from the bundled boundary files; a real API can replace it later.
 */
export interface DataSource {
  getCells(): Promise<{ data: DataSet; mask: StudyMask }>;
  getSeries(cellIds: string[]): Promise<Record<string, number[]>>;
}

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

let cached: Promise<{ data: DataSet; mask: StudyMask }> | null = null;

export const mockSource: DataSource = {
  getCells() {
    if (!cached) {
      cached = Promise.all([loadJson('/data/kgz-adm1.geojson'), loadJson('/data/kgz-adm2.geojson')]).then(
        ([a1, a2]) => {
          const mask = (a1 && buildMask(a1, a2)) || approxMask();
          return { data: buildData(mask), mask };
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
  dataStatus?: string;
  pipelineVersion?: string;
  generatedAt?: string;
  sources?: Record<string, string>;
  method?: Record<string, string>;
  defaultCellId?: string | null;
  lowCellId?: string | null;
  excludedCellId?: string | null;
}

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
let apiCached: Promise<{ data: DataSet; mask: StudyMask }> | null = null;

/**
 * Real data: the backend export (static files, no server). cells.json carries every study cell with its
 * yearly series; oblast/districts GeoJSON are the 5 official Naryn districts (geoBoundaries ADM2).
 */
export const apiSource: DataSource = {
  getCells() {
    if (!apiCached) {
      apiCached = (async () => {
        const [meta, body, obl, dis] = await Promise.all([
          getJson<ApiMeta>(`${API_URL}/meta.json`),
          getJson<{ cells: Cell[] }>(`${API_URL}/cells.json`),
          loadJson(`${API_URL}/oblast.geojson`),
          loadJson(`${API_URL}/districts.geojson`),
        ]);
        setDataInfo(meta);
        const cells = [...body.cells].sort((a, b) => a.r - b.r || a.c - b.c);
        const byId: Record<string, Cell> = {};
        const m: Record<string, District> = {};
        for (const c of cells) {
          byId[c.id] = c;
          m[c.id] = c.d;
        }
        const past = cells.filter((c) => c.kind === 'pasture');
        const pick = (id: string | null | undefined) => (id && byId[id] ? id : null);
        const data: DataSet = {
          cells,
          past,
          byId,
          demo: pick(meta.defaultCellId) ?? past[0]?.id ?? null,
          low: pick(meta.lowCellId),
          excl: pick(meta.excludedCellId),
        };
        const mask: StudyMask = { m, oblast: obl?.features?.[0] ?? null, districts: dis?.features ?? [] };
        return { data, mask };
      })().catch((e) => {
        apiCached = null;
        throw e;
      });
    }
    return apiCached;
  },
  async getSeries(cellIds) {
    const { data } = await this.getCells();
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
