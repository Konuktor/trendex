import { approxMask, buildMask } from '../lib/mask';
import { buildData } from '../lib/mock';
import { series } from '../lib/series';
import type { BoundaryFeature, Cell, DataSet, StudyMask } from '../lib/types';

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

export const source: DataSource = mockSource;
