import { CELL_KM2 } from './geo';
import type { Cell, District, Level, Trend } from './types';

export function share(scope: readonly Cell[], fn: (x: Cell) => boolean): number {
  return Math.round((100 * scope.filter(fn).length) / (scope.length || 1));
}

export function scopeCells(past: readonly Cell[], district: District | null): Cell[] {
  return past.filter((x) => !district || x.d === district);
}

export interface Headline {
  dec: number;
  inc: number;
  nr: number;
  km2: number;
}

/** Shares of pasture area by trend class, as in the reference strip (nr = remainder). */
export function headline(scope: readonly Cell[]): Headline {
  const dec = share(scope, (x) => x.trend === 'dec');
  const inc = share(scope, (x) => x.trend === 'inc');
  return { dec, inc, nr: 100 - dec - inc, km2: scope.length * CELL_KM2 };
}

export function matrixShare(scope: readonly Cell[], level: Level, trend: Trend): number {
  return share(scope, (x) => x.level === level && x.trend === trend);
}

export function matrixCount(scope: readonly Cell[], level: Level, trend: Trend): number {
  return scope.filter((x) => x.level === level && x.trend === trend).length;
}

export interface DistrictRow {
  d: District;
  km2: number;
  dec: number;
  inc: number;
  nr: number;
  /** cell counts (pasture, decline, growth) when built by districtRows */
  n?: number;
  nDec?: number;
  nInc?: number;
}

export function districtRow(past: readonly Cell[], d: District): DistrictRow | null {
  const ps = past.filter((x) => x.d === d);
  if (!ps.length) return null;
  const m = ps.length;
  const dec = Math.round((100 * ps.filter((x) => x.trend === 'dec').length) / m);
  const inc = Math.round((100 * ps.filter((x) => x.trend === 'inc').length) / m);
  return { d, km2: m * CELL_KM2, dec, inc, nr: 100 - dec - inc };
}

/** Rows for every region with pasture, in one pass over the cells (keyed by region code). */
export function districtRows(past: readonly Cell[]): Map<District, DistrictRow> {
  const acc = new Map<District, { n: number; dec: number; inc: number }>();
  for (const x of past) {
    let a = acc.get(x.d);
    if (!a) {
      a = { n: 0, dec: 0, inc: 0 };
      acc.set(x.d, a);
    }
    a.n++;
    if (x.trend === 'dec') a.dec++;
    else if (x.trend === 'inc') a.inc++;
  }
  const out = new Map<District, DistrictRow>();
  for (const [d, a] of acc) {
    const dec = Math.round((100 * a.dec) / a.n);
    const inc = Math.round((100 * a.inc) / a.n);
    out.set(d, { d, km2: a.n * CELL_KM2, dec, inc, nr: 100 - dec - inc, n: a.n, nDec: a.dec, nInc: a.inc });
  }
  return out;
}

/** Summary of several region rows (a country in Central Asia); exact when the rows carry counts. */
export function countryRow(rows: readonly DistrictRow[]): { km2: number; dec: number; inc: number; nr: number } {
  const km2 = rows.reduce((a, r) => a + r.km2, 0);
  const n = rows.reduce((a, r) => a + (r.n ?? r.km2), 0) || 1;
  const nDec = rows.reduce((a, r) => a + (r.nDec ?? (r.dec * (r.n ?? r.km2)) / 100), 0);
  const nInc = rows.reduce((a, r) => a + (r.nInc ?? (r.inc * (r.n ?? r.km2)) / 100), 0);
  const dec = Math.round((100 * nDec) / n);
  const inc = Math.round((100 * nInc) / n);
  return { km2, dec, inc, nr: 100 - dec - inc };
}
