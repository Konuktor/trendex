import type { Level, Trend } from './types';

export const LEVEL_NAME: Record<Level, string> = { low: 'Low', moderate: 'Moderate', good: 'Good' };

export const TREND_NAME: Record<Trend, string> = {
  dec: 'Reliable decline',
  inc: 'Reliable growth',
  nr: 'Not reliable',
};

export const TREND_SHORT: Record<Trend, string> = {
  dec: 'reliable decline',
  nr: 'not reliable',
  inc: 'reliable growth',
};

export const RELATIVE_NOTE = 'Relative to other pastures in Naryn oblast';
export const NOT_ACCOUNTED = 'Not accounted for: livestock load, land rights, water, roads, forage quality';
export const QUEUE_BANNER = 'A prioritisation for field checks, not an instruction.';
export const NO_TREND_RESULT = 'No reliable trend is also a result.';
