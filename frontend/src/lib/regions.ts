import { DISTRICT_NAMES, DISTRICT_ORDER } from './mask';
import type { Cell, DatasetId, DatasetMeta, District, Region } from './types';

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
  /** ISO2 when known, else ISO3 or the country name */
  key: string;
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
  const keyOf = (r: Region) => r.iso2 || r.country || r.countryName || '';
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
    groups = [...m.entries()]
      .map(([key, rs]) => ({
        key,
        countryName: rs[0].countryName || key,
        codes: rs.sort((a, b) => a.name.localeCompare(b.name)).map((r) => r.code),
      }))
      .sort((a, b) => a.countryName.localeCompare(b.countryName));
    order = groups.flatMap((g) => g.codes);
  } else {
    order = regions.map((r) => r.code);
    groups = [{ key: keyOf(regions[0]), countryName: regions[0].countryName || '', codes: order }];
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
