import { CELL_KM, getGrid, LAT0, DLAT, DLON, LON0, toCell, type Grid } from './geo';
import { currentDataset, regionCentroid, regionCountry, regionName, regionOrder } from './regions';
import type { District } from './types';

export interface Place {
  en: string;
  ru: string;
  lat: number;
  lon: number;
  /** continuous grid coordinates */
  c: number;
  r: number;
}

type Raw = [string, string, number, number];

/** Naryn pilot villages (the reference's PLACES). */
const RAW: Raw[] = [
  ['Suusamyr', 'Суусамыр', 42.18, 73.96],
  ['Kyzyl-Oi', 'Кызыл-Ой', 41.95, 74.17],
  ['Chaek', 'Чаек', 41.93, 74.5],
  ['Ming-Kush', 'Мин-Куш', 41.68, 74.47],
  ['Son-Kul', 'Сон-Куль', 41.83, 75.13],
  ['Kochkor', 'Кочкор', 42.215, 75.755],
  ['Baetov', 'Баетов', 41.26, 74.95],
  ['Naryn', 'Нарын', 41.428, 75.991],
  ['Eki-Naryn', 'Эки-Нарын', 41.66, 76.4],
  ['At-Bashy', 'Ат-Башы', 41.17, 75.807],
  ['Ak-Sai', 'Ак-Сай', 40.95, 75.75],
  ['Tash-Rabat', 'Таш-Рабат', 40.82, 75.29],
  ['Kara-Suu', 'Кара-Суу', 41.55, 76.9],
  ['Ak-Shyirak', 'Ак-Шыйрак', 41.8, 78.1],
];

/** Central Asia: capitals and regional centres (approximate city-centre coordinates). */
const CA_RAW: Raw[] = [
  // Kazakhstan
  ['Astana', 'Астана', 51.169, 71.449],
  ['Almaty', 'Алматы', 43.238, 76.946],
  ['Shymkent', 'Шымкент', 42.317, 69.59],
  ['Aktobe', 'Актобе', 50.283, 57.167],
  ['Karaganda', 'Караганда', 49.806, 73.085],
  ['Taraz', 'Тараз', 42.9, 71.367],
  ['Pavlodar', 'Павлодар', 52.287, 76.967],
  ['Oskemen', 'Усть-Каменогорск', 49.948, 82.628],
  ['Semey', 'Семей', 50.411, 80.227],
  ['Atyrau', 'Атырау', 47.117, 51.883],
  ['Kostanay', 'Костанай', 53.214, 63.624],
  ['Kyzylorda', 'Кызылорда', 44.853, 65.509],
  ['Oral', 'Уральск', 51.233, 51.367],
  ['Petropavl', 'Петропавловск', 54.875, 69.162],
  ['Aktau', 'Актау', 43.65, 51.16],
  ['Kokshetau', 'Кокшетау', 53.283, 69.383],
  ['Taldykorgan', 'Талдыкорган', 45.017, 78.383],
  ['Turkistan', 'Туркестан', 43.297, 68.252],
  ['Konaev', 'Конаев', 43.867, 77.067],
  ['Zhezkazgan', 'Жезказган', 47.783, 67.767],
  // Kyrgyzstan
  ['Bishkek', 'Бишкек', 42.875, 74.59],
  ['Osh', 'Ош', 40.513, 72.816],
  ['Jalal-Abad', 'Джалал-Абад', 40.933, 73.0],
  ['Karakol', 'Каракол', 42.491, 78.393],
  ['Naryn', 'Нарын', 41.428, 75.991],
  ['Talas', 'Талас', 42.522, 72.243],
  ['Batken', 'Баткен', 40.063, 70.819],
  ['Cholpon-Ata', 'Чолпон-Ата', 42.65, 77.083],
  // Tajikistan
  ['Dushanbe', 'Душанбе', 38.56, 68.774],
  ['Khujand', 'Худжанд', 40.283, 69.633],
  ['Bokhtar', 'Бохтар', 37.836, 68.781],
  ['Kulob', 'Куляб', 37.914, 69.784],
  ['Khorog', 'Хорог', 37.489, 71.553],
  // Turkmenistan
  ['Ashgabat', 'Ашхабад', 37.96, 58.326],
  ['Turkmenabat', 'Туркменабад', 39.073, 63.579],
  ['Dashoguz', 'Дашогуз', 41.836, 59.967],
  ['Mary', 'Мары', 37.6, 61.833],
  ['Balkanabat', 'Балканабад', 39.51, 54.367],
  ['Turkmenbashy', 'Туркменбаши', 40.022, 52.955],
  // Uzbekistan
  ['Tashkent', 'Ташкент', 41.311, 69.279],
  ['Samarkand', 'Самарканд', 39.654, 66.976],
  ['Bukhara', 'Бухара', 39.768, 64.421],
  ['Andijan', 'Андижан', 40.783, 72.344],
  ['Namangan', 'Наманган', 40.998, 71.672],
  ['Fergana', 'Фергана', 40.384, 71.786],
  ['Nukus', 'Нукус', 42.46, 59.603],
  ['Urgench', 'Ургенч', 41.55, 60.633],
  ['Qarshi', 'Карши', 38.861, 65.789],
  ['Termez', 'Термез', 37.224, 67.278],
  ['Jizzakh', 'Джизак', 40.116, 67.842],
  ['Navoiy', 'Навои', 40.084, 65.379],
  ['Gulistan', 'Гулистан', 40.489, 68.784],
];

function project(raw: readonly Raw[]): Place[] {
  return raw.map(([en, ru, lat, lon]) => {
    const k = toCell(lon, lat);
    return { en, ru, lat, lon, c: k.c, r: k.r };
  });
}

/** Naryn villages in Naryn grid coordinates (the default grid at load). */
export const PLACES: readonly Place[] = project(RAW);

let caMemo: { grid: Readonly<Grid>; list: Place[] } | null = null;

/** Places for the active dataset, in the active grid's coordinates. */
export function activePlaces(): readonly Place[] {
  if (currentDataset() !== 'ca') return PLACES;
  const grid = getGrid();
  if (!caMemo || caMemo.grid !== grid) caMemo = { grid, list: project(CA_RAW) };
  return caMemo.list;
}

/** Central Asia city list (for tests and search). */
export const CA_CITIES: readonly { en: string; ru: string; lat: number; lon: number }[] = CA_RAW.map(([en, ru, lat, lon]) => ({
  en,
  ru,
  lat,
  lon,
}));

const DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;

export function dirOf(dx: number, dy: number): string {
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return DIRS[((Math.round(a / 45) % 8) + 8) % 8];
}

export function nearest(cx: number, cy: number): { p: Place; d: number } {
  const list = activePlaces();
  let best = list[0];
  let bd = 1e9;
  for (const p of list) {
    const d = Math.sqrt((p.c - cx) * (p.c - cx) + (p.r - cy) * (p.r - cy));
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return { p: best, d: bd };
}

/** Distance in km rounded to 5 (at least 5) for a distance in grid cells. */
const roundKm = (cells: number) => Math.max(5, Math.round(cells * (CELL_KM / 5)) * 5);

/** Planar km offset between two lon/lat points: [east, south] like grid coordinates. */
function kmOffset(lon: number, lat: number, lon0: number, lat0: number): [number, number] {
  const k = 111.32 * Math.cos((((lat + lat0) / 2) * Math.PI) / 180);
  return [(lon - lon0) * k, (lat0 - lat) * 110.57];
}

/** The region whose centroid is closest to a lon/lat point (fallback when the region is not known). */
function nearestRegion(lon: number, lat: number): District | null {
  let best: District | null = null;
  let bd = Infinity;
  for (const code of regionOrder()) {
    const c = regionCentroid(code);
    if (!c) continue;
    const [dx, dy] = kmOffset(lon, lat, c.lon, c.lat);
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = code;
    }
  }
  return best;
}

/**
 * Central Asia naming: "Around Taraz" close to a listed city, otherwise the region and the distance and
 * direction from its centre: "Jambyl Region, 60 km NW of centre". `always` forces the region form.
 */
function caName(cx: number, cy: number, always: boolean, region?: District | null): string {
  const n = nearest(cx, cy);
  if (!always && n.d < 1.6) return 'Around ' + n.p.en;
  const lon = LON0 + cx * DLON;
  const lat = LAT0 - cy * DLAT;
  const code = region ?? nearestRegion(lon, lat);
  if (!code) return n.p.en + ', ' + roundKm(n.d) + ' km ' + dirOf(cx - n.p.c, cy - n.p.r);
  const c = regionCentroid(code);
  if (!c) return regionName(code) + (regionCountry(code) ? ', ' + regionCountry(code) : '');
  const [dx, dy] = kmOffset(lon, lat, c.lon, c.lat);
  const km = Math.sqrt(dx * dx + dy * dy);
  if (km < CELL_KM * 1.5) return 'Centre of ' + regionName(code);
  return regionName(code) + ', ' + Math.max(5, Math.round(km / 5) * 5) + ' km ' + dirOf(dx, dy) + ' of centre';
}

/**
 * Human name for a point in grid units: "Around Suusamyr" when close to a place,
 * otherwise "Kochkor, 15 km SW". `always` forces the distance form. In Central Asia the
 * far-from-a-city form names the region instead (pass its code when known).
 */
export function placeName(cx: number, cy: number, always = false, region?: District | null): string {
  if (currentDataset() === 'ca') return caName(cx, cy, always, region);
  const n = nearest(cx, cy);
  if (!always && n.d < 1.6) return 'Around ' + n.p.en;
  return n.p.en + ', ' + roundKm(n.d) + ' km ' + dirOf(cx - n.p.c, cy - n.p.r);
}

export interface Suggestion {
  kind: 'coords' | 'place';
  label: string;
  sub: string;
  lon: number;
  lat: number;
}

/**
 * Search: "lat, lon" (comma, semicolon or space between; dot or comma decimals)
 * and/or a place-name prefix in Latin or Cyrillic. Up to 5 places. In Central Asia,
 * region names match too (they fly to the region's centre).
 */
export function parseSearch(input: string): Suggestion[] {
  const items: Suggestion[] = [];
  const q = input.trim();
  if (!q) return items;
  const m = q.match(/(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)/);
  if (m) {
    const lat = parseFloat(m[1].replace(',', '.'));
    const lon = parseFloat(m[2].replace(',', '.'));
    items.push({ kind: 'coords', label: lat.toFixed(2) + '°N, ' + lon.toFixed(2) + '°E', sub: 'Coordinates', lon, lat });
  }
  const ql = q.toLowerCase();
  const places = activePlaces()
    .filter((p) => p.en.toLowerCase().startsWith(ql) || p.ru.toLowerCase().startsWith(ql))
    .map((p) => ({ kind: 'place' as const, label: p.en, sub: p.ru, lon: p.lon, lat: p.lat }));
  if (currentDataset() === 'ca' && !m) {
    for (const code of regionOrder()) {
      const name = regionName(code);
      const c = regionCentroid(code);
      if (!c || !name.toLowerCase().startsWith(ql)) continue;
      places.push({ kind: 'place', label: name, sub: regionCountry(code) ?? 'Region', lon: c.lon, lat: c.lat });
    }
  }
  places.slice(0, 5).forEach((p) => items.push(p));
  return items;
}

export const NO_MATCH_TEXT =
  'No matches. Try a village name, in Latin or Cyrillic, or coordinates like 42.15, 74.02.';

export function noMatchText(): string {
  return currentDataset() === 'ca'
    ? 'No matches. Try a city or region name, in Latin or Cyrillic, or coordinates like 43.24, 76.95.'
    : NO_MATCH_TEXT;
}

export function searchPlaceholder(): string {
  return currentDataset() === 'ca' ? 'Search a city, region or 43.24, 76.95' : 'Search a place or 42.15, 74.02';
}
