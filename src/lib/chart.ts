import { YEARS } from './noise';

export interface ChartModel {
  values: readonly number[];
  base: number;
  /** %/yr */
  slope: number;
  /** interval half-width, %/yr */
  w: number;
  cov: number;
}

const MID = (YEARS - 1) / 2;

/** Fitted trend value for year index i. */
export function trendAt(m: ChartModel, i: number): number {
  return m.base + (m.slope / 100) * m.base * (i - MID);
}

/** Half-width of the 95 % band at year index i (as in the reference chart). */
export function bandAt(m: ChartModel, i: number): number {
  return 0.006 + 0.014 * (1 - m.cov) + ((m.w / 100) * m.base) * Math.abs(i - MID);
}

/** Y domain snapped to 0.05 steps that holds the series and the band. */
export function yDomain(m: ChartModel): [number, number] {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < YEARS; i++) {
    mn = Math.min(mn, m.values[i], trendAt(m, i) - bandAt(m, i));
    mx = Math.max(mx, m.values[i], trendAt(m, i) + bandAt(m, i));
  }
  return [Math.floor((mn - 0.005) * 20) / 20, Math.ceil((mx + 0.005) * 20) / 20];
}

export function unionDomain(ds: [number, number][]): [number, number] {
  return [Math.min(...ds.map((d) => d[0])), Math.max(...ds.map((d) => d[1]))];
}

export function ticks005(d: [number, number]): number[] {
  const out: number[] = [];
  for (let t = d[0]; t <= d[1] + 1e-9; t += 0.05) out.push(Math.round(t * 100) / 100);
  return out;
}
