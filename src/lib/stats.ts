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
}

export function districtRow(past: readonly Cell[], d: District): DistrictRow | null {
  const ps = past.filter((x) => x.d === d);
  if (!ps.length) return null;
  const m = ps.length;
  const dec = Math.round((100 * ps.filter((x) => x.trend === 'dec').length) / m);
  const inc = Math.round((100 * ps.filter((x) => x.trend === 'inc').length) / m);
  return { d, km2: m * CELL_KM2, dec, inc, nr: 100 - dec - inc };
}
