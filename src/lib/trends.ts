import { avg } from './format';
import { CELL_KM2 } from './geo';
import { DISTRICT_NAMES, DISTRICT_ORDER } from './mask';
import { fit, meanSeries, series } from './series';
import type { ChartModel } from './chart';
import type { Cell, District, Level, Trend } from './types';

export interface ScopeTrend {
  model: ChartModel;
  trend: Trend;
  /** slope rounded to 0.1 %/yr */
  slope: number;
  lo: number;
  hi: number;
  cells: number;
}

/** Average series of a set of pasture cells and its OLS trend with a 95 % interval. */
export function scopeTrend(cells: readonly Cell[]): ScopeTrend | null {
  if (!cells.length) return null;
  const values = meanSeries(cells.map(series));
  const f = fit(values);
  const slope = Math.round(f.sp * 10) / 10;
  const w = Math.max(0.1, Math.round(f.ci * 10) / 10);
  return {
    model: { values, base: avg(values, (v) => v), slope, w, cov: avg(cells, (x) => x.cov) },
    trend: f.dir,
    slope,
    lo: slope - w,
    hi: slope + w,
    cells: cells.length,
  };
}

export interface ClassShare {
  trend: Trend;
  pct: number;
  km2: number;
}

/** Share of pasture area by trend class (percentages sum to 100). */
export function trendShares(cells: readonly Cell[]): ClassShare[] {
  const n = cells.length || 1;
  const count = (t: Trend) => cells.filter((x) => x.trend === t).length;
  const dec = Math.round((100 * count('dec')) / n);
  const inc = Math.round((100 * count('inc')) / n);
  return [
    { trend: 'dec', pct: dec, km2: count('dec') * CELL_KM2 },
    { trend: 'nr', pct: 100 - dec - inc, km2: count('nr') * CELL_KM2 },
    { trend: 'inc', pct: inc, km2: count('inc') * CELL_KM2 },
  ];
}

export interface MatrixCell {
  level: Level;
  trend: Trend;
  pct: number;
  km2: number;
}

export function matrixTable(cells: readonly Cell[]): MatrixCell[][] {
  const n = cells.length || 1;
  return (['good', 'moderate', 'low'] as Level[]).map((level) =>
    (['dec', 'nr', 'inc'] as Trend[]).map((trend) => {
      const k = cells.filter((x) => x.level === level && x.trend === trend).length;
      return { level, trend, pct: Math.round((100 * k) / n), km2: k * CELL_KM2 };
    }),
  );
}

export interface DistrictPanel extends ScopeTrend {
  d: District;
  name: string;
  km2: number;
  reliable: boolean;
}

/** One panel per district with pasture, sorted by slope (steepest decline first). */
export function districtPanels(past: readonly Cell[]): DistrictPanel[] {
  const out: DistrictPanel[] = [];
  for (const d of DISTRICT_ORDER) {
    const cells = past.filter((x) => x.d === d);
    const t = scopeTrend(cells);
    if (!t) continue;
    out.push({ ...t, d, name: DISTRICT_NAMES[d], km2: cells.length * CELL_KM2, reliable: t.trend !== 'nr' });
  }
  return out.sort((a, b) => a.slope - b.slope || a.d.localeCompare(b.d));
}

const CSV_COLS = [
  'id', 'district', 'lon', 'lat', 'kind', 'reason', 'level', 'level_percentile', 'trend', 'slope_pct_per_year',
  'steeper', 'coverage', 'clear_seasons', 'confidence',
] as const;

function esc(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Per-cell table for a scope. Level/trend are blank for cells that are not pasture. */
export function cellsCsv(cells: readonly Cell[]): string {
  const rows = cells.map((x) => {
    const p = x.kind === 'pasture';
    return [
      x.id, DISTRICT_NAMES[x.d], x.lon.toFixed(3), x.lat.toFixed(3), x.kind, x.why,
      p ? x.level : '', p ? x.pct : '', p ? x.trend : '', p ? x.slope.toFixed(1) : '', p ? x.strong : '',
      x.cov.toFixed(2), x.seasons, p ? x.conf : '',
    ].map(esc).join(',');
  });
  return ['# TrendeX sample data, not real measurements', CSV_COLS.join(','), ...rows].join('\n') + '\n';
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
