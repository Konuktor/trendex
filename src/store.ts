import { create } from 'zustand';
import { source } from './data/source';
import type { DataSet, District, Layer, LonLat, MatrixFilter, StudyMask } from './lib/types';

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
  data: DataSet | null;
  mask: StudyMask | null;
  load: () => Promise<void>;

  layer: Layer;
  setLayer: (l: Layer) => void;
  matrix: MatrixFilter | null;
  toggleMatrix: (f: MatrixFilter) => void;
  district: District | null;
  toggleDistrict: (d: District) => void;
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
  toggleQueue: (item: Omit<QueueItem, 'addedAt'>) => void;
  removeFromQueue: (key: string) => void;

  tour: number;
  setTour: (n: number) => void;
}

export const useApp = create<AppState>((set, get) => ({
  data: null,
  mask: null,
  async load() {
    if (get().data) return;
    const { data, mask } = await source.getCells();
    set((s) => ({ data, mask, sel: s.sel ?? (data.demo ? { type: 'zone', id: data.demo } : null) }));
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
      const has = s.queue.some((q) => q.key === item.key);
      const queue = has ? s.queue.filter((q) => q.key !== item.key) : [...s.queue, { ...item, addedAt: Date.now() }];
      saveQueue(queue);
      return { queue };
    }),
  removeFromQueue: (key) =>
    set((s) => {
      const queue = s.queue.filter((q) => q.key !== key);
      saveQueue(queue);
      return { queue };
    }),

  tour: 0,
  setTour: (tour) => set({ tour }),
}));
