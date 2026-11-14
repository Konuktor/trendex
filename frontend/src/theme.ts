/** Colour values for places where a Tailwind class cannot be used (SVG, Leaflet styles). Mirrors tailwind.config.ts. */
import type { Level, Trend } from './lib/types';
import type { ZoneFeatureClass } from './lib/zones';

export const C = {
  bg: '#FFFFFF',
  surface: '#FAFAFA',
  panel: '#F5F5F5',
  grid: '#EDEDED',
  hairline: '#E5E5E5',
  dim: '#E2E2E2',
  borderStrong: '#D4D4D4',
  text: '#171717',
  text2: '#525252',
  text3: '#8A8A8A',
  boundary: '#404040',
  district: '#737373',
  decStrong: '#C2410C',
  dec: '#FDBA74',
  nr: '#D4D4D8',
  nrHatch: '#A1A1AA',
  inc: '#99D5E0',
  incStrong: '#0E7490',
  low: '#DCEBD3',
  moderate: '#86C07F',
  good: '#2F7D3E',
  excluded: '#52525B',
  water: '#D9D9D9',
} as const;

export const LEVEL_BG: Record<Level, string> = { low: C.low, moderate: C.moderate, good: C.good };
export const LEVEL_FG: Record<Level, string> = { low: C.text, moderate: C.text, good: '#FFFFFF' };

export function trendColor(t: Trend, strong: boolean): string {
  if (t === 'dec') return strong ? C.decStrong : C.dec;
  if (t === 'inc') return strong ? C.incStrong : C.inc;
  return C.nr;
}

/** Stroke for chart lines and dots in the class colour. */
export const TREND_STROKE: Record<Trend, string> = { dec: C.decStrong, inc: C.incStrong, nr: '#71717A' };
export const TREND_TEXT: Record<Trend, string> = { dec: C.decStrong, inc: C.incStrong, nr: C.text2 };
export const TREND_BAND: Record<Trend, string> = { dec: C.dec, inc: C.inc, nr: C.nr };

export const HATCH_ID = 'tx-hatch';
export const DOTS_ID = 'tx-dots';

export function zoneFill(cls: ZoneFeatureClass): { fill: string; opacity: number } {
  switch (cls) {
    case 'decS': return { fill: C.decStrong, opacity: 0.9 };
    case 'dec': return { fill: C.dec, opacity: 0.9 };
    case 'nr': return { fill: `url(#${HATCH_ID})`, opacity: 0.9 };
    case 'inc': return { fill: C.inc, opacity: 0.9 };
    case 'incS': return { fill: C.incStrong, opacity: 0.9 };
    case 'Llow': return { fill: C.low, opacity: 0.9 };
    case 'Lmoderate': return { fill: C.moderate, opacity: 0.9 };
    case 'Lgood': return { fill: C.good, opacity: 0.9 };
    case 'excl': return { fill: C.excluded, opacity: 0.9 };
    case 'nodata': return { fill: `url(#${DOTS_ID})`, opacity: 0.95 };
    case 'dim': return { fill: C.dim, opacity: 0.85 };
  }
}
