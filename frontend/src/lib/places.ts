import { toCell } from './geo';

export interface Place {
  en: string;
  ru: string;
  lat: number;
  lon: number;
  /** continuous grid coordinates */
  c: number;
  r: number;
}

const RAW: [string, string, number, number][] = [
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

export const PLACES: readonly Place[] = RAW.map(([en, ru, lat, lon]) => {
  const k = toCell(lon, lat);
  return { en, ru, lat, lon, c: k.c, r: k.r };
});

const DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;

export function dirOf(dx: number, dy: number): string {
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return DIRS[((Math.round(a / 45) % 8) + 8) % 8];
}

export function nearest(cx: number, cy: number): { p: Place; d: number } {
  let best = PLACES[0];
  let bd = 1e9;
  for (const p of PLACES) {
    const d = Math.sqrt((p.c - cx) * (p.c - cx) + (p.r - cy) * (p.r - cy));
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return { p: best, d: bd };
}

/**
 * Human name for a point in grid units: "Around Suusamyr" when close to a place,
 * otherwise "Kochkor, 15 km SW". `always` forces the distance form.
 */
export function placeName(cx: number, cy: number, always = false): string {
  const n = nearest(cx, cy);
  if (!always && n.d < 1.6) return 'Around ' + n.p.en;
  return n.p.en + ', ' + Math.max(5, Math.round(n.d * 2) * 5) + ' km ' + dirOf(cx - n.p.c, cy - n.p.r);
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
 * and/or a place-name prefix in Latin or Cyrillic. Up to 5 places.
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
  PLACES.filter((p) => p.en.toLowerCase().startsWith(ql) || p.ru.toLowerCase().startsWith(ql))
    .slice(0, 5)
    .forEach((p) => items.push({ kind: 'place', label: p.en, sub: p.ru, lon: p.lon, lat: p.lat }));
  return items;
}

export const NO_MATCH_TEXT =
  'No matches. Try a village name, in Latin or Cyrillic, or coordinates like 42.15, 74.02.';
