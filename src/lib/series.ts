import { avg } from './format';
import { H, V, YEARS, YR } from './noise';
import type { Cell, Trend } from './types';

/** Sample peak-season NDVI series 2000–2025 for one cell. */
export function series(x: Pick<Cell, 'c' | 'r' | 'd' | 'pct' | 'slope' | 'cov'>): number[] {
  const base = 0.3 + (0.3 * x.pct) / 100;
  const sl = (x.slope / 100) * base;
  const amp = 0.014 + 0.04 * (1 - x.cov);
  const dk = x.d.charCodeAt(0) + x.d.charCodeAt(1);
  const v: number[] = [];
  for (let i = 0; i < YEARS; i++) {
    v.push(
      base +
        sl * (i - 12.5) +
        (H(x.c * 31 + i, x.r * 17 + i, 21) - 0.5) * 2 * amp +
        (V(i, x.c * 3 + x.r, 22, 3) - 0.5) * amp +
        base * 0.06 * YR[i] +
        base * 0.04 * (H(i, dk, 23) - 0.5),
    );
  }
  return v;
}

export interface Fit {
  /** slope in % of the mean per year */
  sp: number;
  /** half-width of the 95 % interval, same units */
  ci: number;
  dir: Trend;
}

/** OLS slope in %/yr with a 95 % interval (1.96 · SE). */
export function fit(v: readonly number[]): Fit {
  const n = v.length;
  const mid = (n - 1) / 2;
  const mv = avg(v, (a) => a);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mid) * (v[i] - mv);
    sxx += (i - mid) * (i - mid);
  }
  const b = sxy / sxx;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const e = v[i] - (mv + b * (i - mid));
    ss += e * e;
  }
  const se = Math.sqrt(ss / (n - 2) / sxx);
  const sp = (b / mv) * 100;
  const ci = ((1.96 * se) / mv) * 100;
  return { sp, ci, dir: sp + ci < 0 ? 'dec' : sp - ci > 0 ? 'inc' : 'nr' };
}

/** Year-by-year mean of several series. */
export function meanSeries(list: readonly number[][]): number[] {
  const out: number[] = [];
  for (let i = 0; i < YEARS; i++) out.push(avg(list, (s) => s[i]));
  return out;
}
