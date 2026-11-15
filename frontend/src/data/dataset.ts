import type { DatasetId } from '../lib/types';

/** Base URL of the Naryn export (production build: /data/v1). Empty in dev and tests: the mock is used. */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * The dataset switch exists only on real data (the mock is Naryn only) and only when VITE_DATASETS lists "ca".
 * Production keeps Central Asia hidden until its real export replaces the sample (VITE_DATASETS=naryn).
 */
export const HAS_DATASETS = !!API_URL && (import.meta.env.VITE_DATASETS ?? 'naryn,ca').split(',').includes('ca');

export const DATASETS: readonly DatasetId[] = ['naryn', 'ca'];

export const DATASET_LABEL: Record<DatasetId, string> = {
  naryn: 'Naryn (1 km pilot)',
  ca: 'Central Asia',
};

/** Labels for the compact phone select. */
export const DATASET_SHORT: Record<DatasetId, string> = {
  naryn: 'Naryn pilot',
  ca: 'Central Asia',
};

/**
 * Folder of a dataset's static export. Naryn is the API URL itself; Central Asia is the sibling
 * `ca/v1` folder of its parent: "/data/v1" → "/data/ca/v1", "https://x/trendex/v1" → "https://x/trendex/ca/v1".
 */
export function datasetBase(ds: DatasetId, base: string = API_URL): string {
  const b = base.replace(/\/+$/, '');
  if (ds === 'naryn') return b;
  return `${b.replace(/\/[^/]*$/, '')}/ca/v1`;
}

/** Opening view: all of Central Asia when the switch exists (production), Naryn otherwise (mock, tests). */
export const DEFAULT_DATASET: DatasetId = HAS_DATASETS ? 'ca' : 'naryn';

export function parseDataset(v: string | null | undefined): DatasetId {
  return v === 'ca' ? 'ca' : v === 'naryn' ? 'naryn' : DEFAULT_DATASET;
}

/** Dataset from the page URL (?ds=naryn | ?ds=ca) at start-up; the default dataset when absent. */
export function initialDataset(): DatasetId {
  if (!HAS_DATASETS || typeof window === 'undefined') return 'naryn';
  return parseDataset(new URLSearchParams(window.location.search).get('ds'));
}

/** Country from the page URL (?ds=ca&country=KAZ) at start-up; validated once the data has loaded. */
export function initialCountry(): string | null {
  if (initialDataset() !== 'ca') return null;
  return new URLSearchParams(window.location.search).get('country') || null;
}
