import { cellCenter, cellIdOf, toCell } from './geo';
import { H, V } from './noise';
import { inLake, settlementCells } from './mask';
import type { Cell, DataSet, District, Kind, StudyMask } from './types';

export const DEMO_ID = '3,4';
export const LOW_COORD = [40.95, 75.75] as const; // Ak-Sai
export const EXCL_COORD = [42.215, 75.755] as const; // Kochkor

const LEVEL_BIAS: Record<District, number> = { SU: 0.1, KO: -0.12, AK: -0.08, AT: 0.05, JU: 0, NA: 0.02 };
const TREND_BIAS: Record<District, number> = { SU: -0.42, KO: -0.22, AK: -0.15, AT: 0.05, JU: 0, NA: 0.08 };

interface Raw {
  c: number;
  r: number;
  id: string;
  d: District;
  kind: Kind;
  why: string;
  L: number;
  T: number;
  cov: number;
  water: boolean;
  lon: number;
  lat: number;
}

/** Sample pasture data. Same formulas and forced cells as the reference `buildData`. */
export function buildData(M: StudyMask): DataSet {
  const keys = Object.keys(M.m);
  const bot: Record<number, number> = {};
  for (const k of keys) {
    const [c, r] = k.split(',').map(Number);
    bot[c] = Math.max(bot[c] === undefined ? -1 : bot[c], r);
  }
  const settle = settlementCells();
  const low = cellIdOf(LOW_COORD[0], LOW_COORD[1]);
  const demo = DEMO_ID;
  const sc = toCell(75.13, 41.83);

  const raw: Raw[] = keys.map((k) => {
    const [c, r] = k.split(',').map(Number);
    const d = M.m[k];
    const [lon, lat] = cellCenter(c, r);
    const water = inLake(lon, lat);
    let kind: Kind = 'pasture';
    let why = '';
    if (water) {
      kind = 'excluded';
      why = 'Water: ' + (lat > 41.2 ? 'Lake Son-Kul' : 'Lake Chatyr-Kul');
    } else if (settle[k]) {
      kind = 'excluded';
      why = settle[k];
    } else if (V(c, r, 7, 4) > 0.72 && (r >= bot[c] - 1 || c >= 35)) {
      kind = 'excluded';
      why = 'Glacier and bare rock';
    } else if (H(c, r, 11) < 0.03 && k !== demo && k !== low) {
      kind = 'nodata';
      why = 'Snow or cloud in most seasons';
    }
    let L = 0.55 * V(c, r, 1, 5) + 0.25 * V(c, r, 2, 2.5) + 0.2 * H(c, r, 3);
    L += LEVEL_BIAS[d];
    const dl = Math.sqrt((c + 0.5 - sc.c) * (c + 0.5 - sc.c) + (r + 0.5 - sc.r) * (r + 0.5 - sc.r));
    if (dl < 4) L += 0.1;
    let T = (V(c, r, 4, 6) - 0.5) * 1.9 + (H(c, r, 5) - 0.5) * 0.55;
    T += TREND_BIAS[d];
    let cov = 0.56 + 0.44 * V(c, r, 8, 3);
    if (k === demo) {
      T = -0.7;
      cov = 0.9;
    }
    if (k === low) cov = 0.5;
    return { c, r, id: k, d, kind, why, L, T, cov, water, lon, lat };
  });

  const pastRaw = raw.filter((x) => x.kind === 'pasture');
  const Ls = pastRaw.map((x) => x.L).sort((a, b) => a - b);
  const q1 = Ls[Math.floor(Ls.length / 3)];
  const q2 = Ls[Math.floor((Ls.length * 2) / 3)];
  raw.sort((a, b) => a.r - b.r || a.c - b.c);

  const byId: Record<string, Cell> = {};
  const cells: Cell[] = raw.map((x) => {
    if (x.id === demo) x.L = (q1 + q2) / 2;
    const pct = Math.round((100 * Ls.filter((v) => v < x.L).length) / Ls.length);
    const level = x.L < q1 ? 'low' : x.L < q2 ? 'moderate' : 'good';
    const slope = Math.round(x.T * 16) / 10;
    let seasons = Math.round(x.cov * 26);
    const rel = x.cov >= 0.6;
    const trend = rel && x.T < -0.4 ? 'dec' : rel && x.T > 0.42 ? 'inc' : 'nr';
    const strong = (trend === 'dec' && x.T < -0.66) || (trend === 'inc' && x.T > 0.66);
    const conf = x.cov < 0.6 ? 'Low' : trend !== 'nr' && x.cov > 0.78 ? 'High' : 'Medium';
    if (x.kind === 'nodata') seasons = 5 + Math.floor(H(x.c, x.r, 12) * 4);
    const cell: Cell = {
      id: x.id,
      c: x.c,
      r: x.r,
      lon: x.lon,
      lat: x.lat,
      d: x.d,
      kind: x.kind,
      why: x.why,
      water: x.water,
      pct,
      level,
      slope,
      trend,
      strong,
      cov: x.cov,
      seasons,
      conf,
    };
    byId[cell.id] = cell;
    return cell;
  });
  // `past` keeps the reference's pre-sort (key) order; it matters for "better nearby" tie-breaks.
  const past = pastRaw.map((x) => byId[x.id]);
  const exclId = cellIdOf(EXCL_COORD[0], EXCL_COORD[1]);
  return {
    cells,
    past,
    byId,
    demo: byId[demo] ? demo : (past[0]?.id ?? null),
    low: byId[low] ? low : null,
    excl: byId[exclId] ? exclId : null,
  };
}
