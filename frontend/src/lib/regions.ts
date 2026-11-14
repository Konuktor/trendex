import { DISTRICT_NAMES, DISTRICT_ORDER } from './mask';
import { bboxOf } from './geo';
import type { MultiLineString } from 'geojson';
import type { BoundaryFeature, Cell, DatasetId, DatasetMeta, District, Region } from './types';

/**
 * Region context of the active dataset: names, display order, country grouping and the copy that
 * depends on them. Set once per dataset switch (see `activate` in data/source.ts); it defaults to the
 * Naryn pilot, which is also what the mock uses.
 */
export type RegionMeta = Pick<DatasetMeta, 'dataset' | 'title' | 'regions' | 'regionLabel'>;

export const NARYN_REGIONS: readonly Region[] = DISTRICT_ORDER.map((code) => ({
  code,
  name: DISTRICT_NAMES[code],
  country: 'KGZ',
  iso2: 'KG',
  countryName: 'Kyrgyzstan',
}));

export const NARYN_REGION_META: RegionMeta = {
  dataset: 'naryn',
  title: 'Naryn oblast',
  regions: [...NARYN_REGIONS],
  regionLabel: { en: 'District', ru: 'Район' },
};

export interface CountryGroup {
  /** country code: ISO3 when known (meta.regions[].country, cells[].country), else ISO2 or the name */
  key: string;
  iso2?: string;
  countryName: string;
  codes: District[];
}

interface Ctx {
  meta: RegionMeta;
  byCode: Map<District, Region>;
  order: District[];
  groups: CountryGroup[];
  centroids: Map<District, { lon: number; lat: number }>;
}

function build(meta: RegionMeta, cells?: readonly Cell[]): Ctx {
  const regions = meta.regions.length ? meta.regions : [...NARYN_REGIONS];
  const byCode = new Map(regions.map((r) => [r.code, r] as const));
  const keyOf = (r: Region) => r.country || r.iso2 || r.countryName || '';
  const countries = new Set(regions.map(keyOf));
  let order: District[];
  let groups: CountryGroup[];
  if (countries.size > 1) {
    // Several countries: group by country (alphabetical), regions alphabetical inside each.
    const m = new Map<string, Region[]>();
    for (const r of regions) {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    if (cells?.length) {
      // Countries that only the cells name (a region missing from meta.regions) still get a group.
      for (const x of cells) {
        if (!x.country || byCode.has(x.d) || [...m.keys()].includes(x.country)) continue;
        m.set(x.country, []);
      }
    }
    groups = [...m.entries()]
      .map(([key, rs]) => ({
        key,
        iso2: rs[0]?.iso2,
        countryName: rs[0]?.countryName || key,
        codes: rs.sort((a, b) => a.name.localeCompare(b.name)).map((r) => r.code),
      }))
      .sort((a, b) => a.countryName.localeCompare(b.countryName));
    order = groups.flatMap((g) => g.codes);
  } else {
    order = regions.map((r) => r.code);
    groups = [{ key: keyOf(regions[0]), iso2: regions[0].iso2, countryName: regions[0].countryName || '', codes: order }];
  }
  const centroids = new Map<District, { lon: number; lat: number }>();
  if (cells?.length) {
    const acc = new Map<District, [number, number, number]>();
    for (const x of cells) {
      const a = acc.get(x.d) ?? [0, 0, 0];
      a[0] += x.lon;
      a[1] += x.lat;
      a[2] += 1;
      acc.set(x.d, a);
    }
    for (const [d, [lon, lat, n]] of acc) centroids.set(d, { lon: lon / n, lat: lat / n });
  }
  return { meta: { ...meta, regions }, byCode, order, groups, centroids };
}

let ctx: Ctx = build(NARYN_REGION_META);

export function setRegionContext(meta: RegionMeta, cells?: readonly Cell[]): void {
  ctx = build(meta, cells);
}

export const currentDataset = (): DatasetId => ctx.meta.dataset;
/** "Naryn oblast" | "Central Asia" */
export const studyTitle = (): string => ctx.meta.title;
/** True when the regions span several countries (Central Asia). */
export const multiCountry = (): boolean => ctx.groups.length > 1;

export function regionName(code: District): string {
  return ctx.byCode.get(code)?.name ?? DISTRICT_NAMES[code] ?? code;
}

/** Region name, with the country when the dataset spans several countries: "Jambyl Region, Kazakhstan". */
export function regionFull(code: District): string {
  const r = ctx.byCode.get(code);
  return multiCountry() && r?.countryName ? `${r.name}, ${r.countryName}` : regionName(code);
}

export function regionCountry(code: District): string | null {
  return ctx.byCode.get(code)?.countryName ?? null;
}

/** Display order for lists (grouped by country when there are several). */
export const regionOrder = (): readonly District[] => ctx.order;
export const regionGroups = (): readonly CountryGroup[] => ctx.groups;
export const isRegion = (v: string | null | undefined): v is District => !!v && ctx.byCode.has(v);

export function regionCentroid(code: District): { lon: number; lat: number } | null {
  return ctx.centroids.get(code) ?? null;
}

/** "District" | "Region" */
export const regionLabel = (): string => ctx.meta.regionLabel.en || 'District';
export const regionLabelPlural = (): string => regionLabel() + 's';

/** "Relative to other pastures in Naryn oblast" */
export const relativeNote = (): string => `Relative to other pastures in ${studyTitle()}`;

/** How copy refers to the whole study area: "the oblast" for Naryn, else the title ("Central Asia"). */
export const areaNoun = (): string => (currentDataset() === 'naryn' ? 'the oblast' : studyTitle());

/** What the study area covers, for "outside the study area" answers. */
export function coverageText(): string {
  if (currentDataset() === 'naryn') return 'TrendeX covers Naryn oblast and the Suusamyr valley';
  const names = ctx.groups.map((g) => g.countryName).filter(Boolean);
  if (names.length < 2) return `TrendeX covers ${studyTitle()}`;
  return `TrendeX covers ${studyTitle()}: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* ---------- countries (Central Asia) ---------- */

/** Countries of the active dataset, alphabetical (one entry for Naryn). */
export const countries = (): readonly CountryGroup[] => ctx.groups;

/** A country code from the URL or a cell: ISO3, ISO2 or the name, any case → the dataset's country key. */
export function resolveCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toLowerCase();
  const g = ctx.groups.find((x) => x.key.toLowerCase() === c || x.iso2?.toLowerCase() === c || x.countryName.toLowerCase() === c);
  return g?.key ?? null;
}

export const isCountry = (code: string | null | undefined): boolean => resolveCountry(code) !== null;

export function countryName(code: string | null | undefined): string {
  return ctx.groups.find((g) => g.key === code)?.countryName ?? code ?? '';
}

/** Country key of a region (ISO3 in Central Asia). */
export function countryOfRegion(code: District): string | null {
  const r = ctx.byCode.get(code);
  return r ? r.country || r.iso2 || r.countryName || null : null;
}

/** Country key of a cell: from its region, else from the cell's own `country`. */
export function countryOf(x: Pick<Cell, 'd' | 'country'>): string | null {
  return countryOfRegion(x.d) ?? resolveCountry(x.country);
}

/** Region codes of a country, in display order (all regions when `country` is null). */
export function regionsOf(country: string | null): readonly District[] {
  if (!country) return ctx.order;
  return ctx.groups.find((g) => g.key === country)?.codes ?? [];
}

export interface CountryShape {
  /** [[south, west], [north, east]] */
  bounds: [[number, number], [number, number]] | null;
  /** outer border: the region edges that no other region of the same country shares */
  border: MultiLineString | null;
}

const shapes = new WeakMap<object, Map<string, CountryShape>>();

/**
 * Bounds and outer border of a country from its region polygons (features with `properties.country`).
 * Neighbouring regions share their edges exactly, so the border is every edge used once.
 */
export function countryShape(features: readonly BoundaryFeature[], country: string): CountryShape {
  let memo = shapes.get(features);
  if (!memo) {
    memo = new Map();
    shapes.set(features, memo);
  }
  const hit = memo.get(country);
  if (hit) return hit;
  const mine = features.filter((f) => {
    const p = f.properties as Record<string, unknown>;
    const code = typeof p.code === 'string' ? p.code : null;
    return (code && countryOfRegion(code) === country) || resolveCountry(p.country as string | undefined) === country;
  });
  let out: CountryShape = { bounds: null, border: null };
  if (mine.length) {
    const b: [number, number, number, number] = [180, 90, -180, -90];
    const rings: number[][][] = [];
    for (const f of mine) {
      const [w, s, e, n] = bboxOf(f.geometry);
      b[0] = Math.min(b[0], w);
      b[1] = Math.min(b[1], s);
      b[2] = Math.max(b[2], e);
      b[3] = Math.max(b[3], n);
      const g = f.geometry;
      if (g.type === 'Polygon') rings.push(...g.coordinates);
      else for (const poly of g.coordinates) rings.push(...poly);
    }
    const key = (a: number[], c: number[]) => {
      const p = `${a[0].toFixed(6)},${a[1].toFixed(6)}`;
      const q = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
      return p < q ? `${p};${q}` : `${q};${p}`;
    };
    const count = new Map<string, number>();
    for (const ring of rings) for (let i = 1; i < ring.length; i++) count.set(key(ring[i - 1], ring[i]), (count.get(key(ring[i - 1], ring[i])) ?? 0) + 1);
    // Walk each ring and keep runs of unshared edges as polylines.
    const lines: number[][][] = [];
    for (const ring of rings) {
      let run: number[][] = [];
      for (let i = 1; i < ring.length; i++) {
        if (count.get(key(ring[i - 1], ring[i])) === 1) {
          if (!run.length) run.push(ring[i - 1]);
          run.push(ring[i]);
        } else if (run.length) {
          lines.push(run);
          run = [];
        }
      }
      if (run.length) lines.push(run);
    }
    out = {
      bounds: [
        [b[1], b[0]],
        [b[3], b[2]],
      ],
      border: lines.length ? { type: 'MultiLineString', coordinates: lines } : null,
    };
  }
  memo.set(country, out);
  return out;
}

/** Bounds of a country from its cells (fallback when there are no region polygons). */
export function countryCellBounds(cells: readonly Cell[], country: string, dlon: number, dlat: number): [[number, number], [number, number]] | null {
  let s = 90;
  let w = 180;
  let n = -90;
  let e = -180;
  let any = false;
  for (const x of cells) {
    if (countryOf(x) !== country) continue;
    any = true;
    s = Math.min(s, x.lat - dlat / 2);
    n = Math.max(n, x.lat + dlat / 2);
    w = Math.min(w, x.lon - dlon / 2);
    e = Math.max(e, x.lon + dlon / 2);
  }
  return any ? [[s, w], [n, e]] : null;
}

