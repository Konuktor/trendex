import type { FeatureCollection } from 'geojson';
import { bboxOf, cellCenter, cellId, cellIdOf, COLS, geomHas, ROWS } from './geo';
import { norm } from './format';
import type { BoundaryFeature, District, StudyMask } from './types';

export const DISTRICT_NAMES: Record<District, string> = {
  SU: 'Suusamyr valley',
  JU: 'Jumgal',
  KO: 'Kochkor',
  AK: 'Ak-Talaa',
  NA: 'Naryn',
  AT: 'At-Bashy',
};

/** Display order used by the rail and the Trends page. */
export const DISTRICT_ORDER: District[] = ['NA', 'AT', 'JU', 'KO', 'AK', 'SU'];

/** Lakes excluded from the data (semi-axes in km). */
export const LAKES = [
  { name: 'Lake Son-Kul', lat: 41.83, lon: 75.13, a: 15, b: 9.5 },
  { name: 'Lake Chatyr-Kul', lat: 40.615, lon: 75.3, a: 12, b: 5.5 },
] as const;

export function inLake(lon: number, lat: number): boolean {
  return LAKES.some((L) => {
    const dx = (lon - L.lon) * 111.32 * Math.cos((L.lat * Math.PI) / 180);
    const dy = (lat - L.lat) * 110.57;
    return (dx / L.a) * (dx / L.a) + (dy / L.b) * (dy / L.b) <= 1;
  });
}

/** Settlement / cropland cells that are excluded from the pasture mask. */
export const SETTLEMENTS: readonly [number, number, string][] = [
  [42.215, 75.755, 'Irrigated cropland and settlement'],
  [42.215, 75.875, 'Irrigated cropland and settlement'],
  [41.428, 75.991, 'Settlement and cropland'],
  [41.17, 75.807, 'Settlement and cropland'],
];

export function settlementCells(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [lat, lon, why] of SETTLEMENTS) out[cellIdOf(lat, lon)] = why;
  return out;
}

type FC = FeatureCollection | { features: BoundaryFeature[] };

function districtCode(n: string): District {
  if (n.includes('bash')) return 'AT';
  if (n.includes('jumgal') || n.includes('dzhumgal') || n.includes('djumgal')) return 'JU';
  if (n.includes('kochkor')) return 'KO';
  if (n.includes('tala')) return 'AK';
  return 'NA';
}

/**
 * Study-area mask from geoBoundaries: cells whose centre lies in Naryn oblast
 * (district from ADM2), plus Suusamyr valley cells in Chüy oblast
 * (lon < 74.7, 41.95 < lat < 42.32). Returns null if Naryn is missing.
 */
export function buildMask(adm1: FC, adm2: FC | null): StudyMask | null {
  const f1 = adm1.features as BoundaryFeature[];
  const naryn = f1.find((f) => norm(f.properties.shapeName).includes('naryn'));
  if (!naryn) return null;
  const chuy = f1.find((f) => {
    const n = norm(f.properties.shapeName);
    return (n.includes('chu') && n.includes('chuy')) || n.includes('chui') || n.includes('chuy');
  });
  const d2 = ((adm2?.features ?? []) as BoundaryFeature[]).map((f) => ({
    f,
    n: norm(f.properties.shapeName),
    bb: bboxOf(f.geometry),
  }));
  const m: Record<string, District> = {};
  const used = new Set<number>();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const [lon, lat] = cellCenter(c, r);
      if (geomHas(naryn.geometry, lon, lat)) {
        let d: District = 'NA';
        for (let i = 0; i < d2.length; i++) {
          const x = d2[i];
          if (lon < x.bb[0] || lon > x.bb[2] || lat < x.bb[1] || lat > x.bb[3]) continue;
          if (!geomHas(x.f.geometry, lon, lat)) continue;
          used.add(i);
          d = districtCode(x.n);
          break;
        }
        m[cellId(c, r)] = d;
      } else if (lon < 74.7 && lat > 41.95 && lat < 42.32 && (!chuy || geomHas(chuy.geometry, lon, lat))) {
        m[cellId(c, r)] = 'SU';
      }
    }
  return { m, oblast: naryn, districts: [...used].sort((a, b) => a - b).map((i) => d2[i].f) };
}

/** Coarse fallback used only if the boundary files are missing. */
export function approxMask(): StudyMask {
  const TOP = [3, 2, 2, 2, 2, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
  const BOT = [7, 7, 8, 8, 8, 7, 13, 14, 15, 16, 17, 17, 18, 18, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 21, 20, 20, 20, 20, 19, 19, 19, 18, 18, 17, 17, 16, 15, 14, 13];
  const m: Record<string, District> = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (r < TOP[c] || r > BOT[c]) continue;
      m[cellId(c, r)] =
        c <= 5 ? 'SU' : r <= 8 && c <= 13 ? 'JU' : r <= 7 && c <= 24 ? 'KO' : c <= 15 && r >= 9 ? 'AK' : r >= 14 ? 'AT' : 'NA';
    }
  return { m, oblast: null, districts: [] };
}
