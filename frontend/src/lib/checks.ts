import { answer } from './answer';
import { cellAt, selectZone } from './zones';
import { LEVEL_NAME, TREND_NAME } from './labels';
import type { DataSet } from './types';

export interface CheckDef {
  place: string;
  lon: number;
  lat: number;
  /** cell id when the check is tied to a specific cell rather than a point */
  cellId?: string;
  expected: string;
  /** what the expectation looks for in the answer */
  test: { kind: 'excluded' } | { trend: 'dec' | 'inc' | 'nr' } | { level: 'low' | 'moderate' | 'good' } | { conf: 'Low' };
}

export const CHECKS: CheckDef[] = [
  { place: 'Kochkor village', lon: 75.755, lat: 42.215, expected: 'Excluded: cropland and settlement', test: { kind: 'excluded' } },
  { place: 'Naryn town', lon: 75.991, lat: 41.428, expected: 'Excluded: settlement', test: { kind: 'excluded' } },
  { place: 'At-Bashy village', lon: 75.807, lat: 41.17, expected: 'Excluded: settlement', test: { kind: 'excluded' } },
  { place: 'Lake Son-Kul', lon: 75.13, lat: 41.83, expected: 'Excluded: open water', test: { kind: 'excluded' } },
  { place: 'Suusamyr valley floor', lon: 74.02, lat: 42.145, cellId: '3,4', expected: 'Reliable decline', test: { trend: 'dec' } },
  { place: 'Suusamyr village surroundings', lon: 73.96, lat: 42.18, expected: 'Reliable decline', test: { trend: 'dec' } },
  { place: 'Ak-Sai valley', lon: 75.75, lat: 40.95, expected: 'Low confidence (long snow cover)', test: { conf: 'Low' } },
  { place: 'Tash-Rabat', lon: 75.29, lat: 40.82, expected: 'Good level', test: { level: 'good' } },
  { place: 'Ming-Kush', lon: 74.47, lat: 41.68, expected: 'Low level', test: { level: 'low' } },
];

export interface CheckResult extends CheckDef {
  observed: string;
  match: boolean;
}

export function runChecks(data: DataSet, checks: CheckDef[] = CHECKS): CheckResult[] {
  return checks.map((ck) => {
    const cell = ck.cellId ? data.byId[ck.cellId] : cellAt(data, ck.lon, ck.lat);
    if (!cell) return { ...ck, observed: 'Outside the study area', match: false };
    const a = answer(selectZone(data, cell.id, 'trend')!, data);
    let observed: string;
    if (a.kind === 'pasture') observed = `${LEVEL_NAME[a.level]} level · ${TREND_NAME[a.trend]} · ${a.conf} confidence`;
    else if (a.kind === 'excluded')
      observed = a.reason.startsWith('Water: ')
        ? `Excluded: open water (${a.reason.slice(7)})`
        : `Excluded: ${a.reason.charAt(0).toLowerCase()}${a.reason.slice(1)}`;
    else observed = a.badge;
    const t = ck.test;
    const match =
      'kind' in t
        ? a.kind === t.kind
        : a.kind === 'pasture' &&
          ('trend' in t ? a.trend === t.trend : 'level' in t ? a.level === t.level : a.conf === t.conf);
    return { ...ck, observed, match };
  });
}
