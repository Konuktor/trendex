import { create } from 'zustand';
import { activate, source } from './data/source';
import { HAS_DATASETS, initialCountry, initialDataset } from './data/dataset';
import { countryOf, countryOfRegion, resolveCountry } from './lib/regions';
import { isReal } from './data/info';
import type { DataSet, DatasetId, DatasetMeta, District, Layer, LonLat, MatrixFilter, StudyMask } from './lib/types';

export type SelectionRef = { type: 'zone'; id: string } | { type: 'drawn'; poly: LonLat[] } | null;

export interface QueueItem {
  /** cell id for zones, "drawn:<hash>" for outlines */
  key: string;
  type: 'zone' | 'drawn';
  cellId?: string;
  poly?: LonLat[];
  name: string;
  /** "Flag mask for review" rather than a field check */
  flag?: boolean;
  addedAt: number;
  /** dataset the item belongs to (items saved before the switch existed are Naryn) */
  ds?: DatasetId;
}

/** Queue items of one dataset (cell ids repeat across datasets). */
export function queueFor(queue: readonly QueueItem[], ds: DatasetId): QueueItem[] {
  return queue.filter((q) => (q.ds ?? 'naryn') === ds);
}

export interface FlyTarget {
  lon: number;
  lat: number;
  seq: number;
}

const QUEUE_KEY = 'trendex.queue.v1';

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueueItem[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function drawnKey(poly: LonLat[]): string {
  return 'drawn:' + poly.map((p) => p.map((v) => v.toFixed(4)).join(',')).join(';');
}

export function selectionKey(sel: SelectionRef): string | null {
  if (!sel) return null;
  return sel.type === 'zone' ? sel.id : drawnKey(sel.poly);
}

interface AppState {
  /** active dataset: the Naryn pilot or Central Asia */
  dataset: DatasetId;
  /** switch dataset: clears data, filters and selection, then loads (selection resets to meta.defaultCellId) */
  setDataset: (ds: DatasetId) => void;
  meta: DatasetMeta | null;
  /** Central Asia: the chosen country (ISO3), null = the whole dataset */
  country: string | null;
  /** choose a country: the map fits and outlines it, lists and shares are scoped to it */
  setCountry: (c: string | null) => void;
  data: DataSet | null;
  mask: StudyMask | null;
  /** true when running on the real (production) data, false on sample data */
  real: boolean;
  /** load error message, null when fine */
  loadError: string | null;
  load: () => Promise<void>;
  retry: () => void;

  layer: Layer;
  setLayer: (l: Layer) => void;
  matrix: MatrixFilter | null;
  toggleMatrix: (f: MatrixFilter) => void;
  district: District | null;
  toggleDistrict: (d: District) => void;
  setDistrict: (d: District | null) => void;
  clearFilters: () => void;

  sel: SelectionRef;
  selectZone: (id: string, fly?: boolean) => void;
  selectDrawn: (poly: LonLat[], fly?: boolean) => void;
  clearSelection: () => void;
  fly: FlyTarget | null;
  flyTo: (lon: number, lat: number) => void;

  drawing: boolean;
  drawCount: number;
  setDrawing: (on: boolean) => void;
  setDrawCount: (n: number) => void;

  queue: QueueItem[];
  toggleQueue: (item: Omit<QueueItem, 'addedAt' | 'ds'>) => void;
  removeFromQueue: (key: string) => void;

  tour: number;
  setTour: (n: number) => void;
}

export const useApp = create<AppState>((set, get) => ({
  dataset: initialDataset(),
  setDataset(ds) {
    if (ds === get().dataset || (!HAS_DATASETS && ds !== 'naryn')) return;
    set({
      dataset: ds,
      country: null,
      data: null,
      mask: null,
      meta: null,
      loadError: null,
      sel: null,
      matrix: null,
      district: null,
      drawing: false,
      drawCount: 0,
      tour: 0,
    });
    void get().load();
  },
  meta: null,
  country: initialCountry(),
  setCountry(c) {
    const s = get();
    const country = c ? resolveCountry(c) : null;
    if (country === s.country) return;
    // Keep a region filter and a selected zone only when they lie in the new country.
    const district = s.district && country && countryOfRegion(s.district) !== country ? null : s.district;
    let sel = s.sel;
    if (country && sel?.type === 'zone') {
      const x = s.data?.byId[sel.id];
      if (x && countryOf(x) !== country) sel = null;
    }
    set({ country, district, sel });
  },
  data: null,
  mask: null,
  real: false,
  loadError: null,
  async load() {
    if (get().data) return;
    const ds = get().dataset;
    try {
      const loaded = await source.getCells(ds);
      // A switch while loading: the newer load sets the state.
      if (get().dataset !== ds) return;
      if (get().data === loaded.data) return;
      activate(loaded);
      const { data, mask, meta } = loaded;
      set((s) => {
        // A country from the URL must exist in this dataset; the default area is kept only inside it.
        const country = ds === 'ca' ? resolveCountry(s.country) : null;
        const demo = data.demo && (!country || countryOf(data.byId[data.demo]) === country) ? data.demo : null;
        return {
          data,
          mask,
          meta,
          country,
          real: isReal(),
          loadError: null,
          sel: s.sel ?? (demo ? { type: 'zone', id: demo } : null),
        };
      });
    } catch (e) {
      if (get().dataset === ds) set({ loadError: e instanceof Error ? e.message : String(e) });
    }
  },
  retry() {
    set({ loadError: null });
    void get().load();
  },

  layer: 'trend',
  setLayer: (layer) => set({ layer }),
  matrix: null,
  toggleMatrix: (f) =>
    set((s) => ({
      matrix: s.matrix && s.matrix.level === f.level && s.matrix.trend === f.trend ? null : f,
    })),
  district: null,
  toggleDistrict: (d) => set((s) => ({ district: s.district === d ? null : d })),
  setDistrict: (district) => set({ district }),
  clearFilters: () => set({ matrix: null, district: null }),

  sel: null,
  selectZone: (id, fly = false) => {
    set({ sel: { type: 'zone', id }, drawing: false, drawCount: 0 });
    if (fly) {
      const c = get().data?.byId[id];
      if (c) get().flyTo(c.lon, c.lat);
    }
  },
  selectDrawn: (poly, fly = false) => {
    set({ sel: { type: 'drawn', poly }, drawing: false, drawCount: 0 });
    if (fly && poly.length) {
      const lon = poly.reduce((a, p) => a + p[0], 0) / poly.length;
      const lat = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      get().flyTo(lon, lat);
    }
  },
  clearSelection: () => set({ sel: null }),
  fly: null,
  flyTo: (lon, lat) => set((s) => ({ fly: { lon, lat, seq: (s.fly?.seq ?? 0) + 1 } })),

  drawing: false,
  drawCount: 0,
  setDrawing: (drawing) => set({ drawing, drawCount: 0 }),
  setDrawCount: (drawCount) => set({ drawCount }),

  queue: typeof localStorage === 'undefined' ? [] : loadQueue(),
  toggleQueue: (item) =>
    set((s) => {
      const ds = s.dataset;
      const mine = (q: QueueItem) => q.key === item.key && (q.ds ?? 'naryn') === ds;
      const has = s.queue.some(mine);
      // Naryn items keep the old shape (no `ds`), so a queue saved before the switch stays compatible.
      const add: QueueItem = ds === 'naryn' ? { ...item, addedAt: Date.now() } : { ...item, addedAt: Date.now(), ds };
      const queue = has ? s.queue.filter((q) => !mine(q)) : [...s.queue, add];
      saveQueue(queue);
      return { queue };
    }),
  removeFromQueue: (key) =>
    set((s) => {
      const queue = s.queue.filter((q) => !(q.key === key && (q.ds ?? 'naryn') === s.dataset));
      saveQueue(queue);
      return { queue };
    }),

  tour: 0,
  setTour: (tour) => set({ tour }),
}));
