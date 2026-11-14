import { avg, maj, num, ord, signed } from './format';
import { CELL_KM2, DLAT, DLON, LAT0, LON0, polyAreaKm, toCell } from './geo';
import { DISTRICT_NAMES } from './mask';
import { meanSeries, fit, series } from './series';
import { LEVEL_NAME } from './labels';
import { nearest, placeName } from './places';
import type { Cell, Confidence, DataSet, Level, Selection, Trend } from './types';

export interface BetterRow {
  id: string;
  name: string;
  km: number;
  level: Level;
  trend: Trend; // display trend (low coverage → nr)
  strong: boolean;
}

export type Sign = '+' | '−';

interface AnswerBase {
  mode: Selection['mode'];
  name: string;
  coord: string;
  sub: string;
  /** queue id: anchor cell id, "drawn", or "none" */
  qid: string;
  cx: number;
  cy: number;
  badge: string;
  next: string;
}

export interface PastureAnswer extends AnswerBase {
  kind: 'pasture';
  conf: Confidence;
  /** Text for the grey low-confidence banner (only shown when conf is Low). */
  lowTxt: string;
  level: Level;
  trend: Trend;
  strong: boolean;
  pct: number;
  slope: number;
  /** half-width of the slope interval, %/yr */
  w: number;
  lo: number;
  hi: number;
  trSub: string;
  takeaway: string;
  why: [Sign, string][];
  better: BetterRow[];
  actionLabel: 'Add to queue';
  cells: number;
  seasons: number;
  chart: { values: number[]; base: number; slope: number; w: number; cov: number };
  season: { iqL: number; iqW: number; cur: number; min: number; max: number; text: string };
}

export interface NonPastureAnswer extends AnswerBase {
  kind: 'excluded' | 'nodata' | 'outside';
  conf: 'none';
  reason: string;
  detail: string;
  head: string;
  expl: string;
  /** For excluded areas: "Water" swatch vs dark excluded swatch. */
  water: boolean;
  nearest: BetterRow[];
  actionLabel: 'Add to queue' | 'Flag mask for review';
}

export type Answer = PastureAnswer | NonPastureAnswer;

function betterNear(
  data: DataSet,
  cx: number,
  cy: number,
  Z: readonly Cell[],
  fn: (o: Cell) => boolean,
): BetterRow[] {
  const inZ = new Set(Z.map((x) => x.id));
  const seen = new Set<string>();
  const out: BetterRow[] = [];
  data.past
    .filter((o) => !inZ.has(o.id) && fn(o))
    .map((o) => {
      const dx = o.c + 0.5 - cx;
      const dy = o.r + 0.5 - cy;
      return { o, d: Math.sqrt(dx * dx + dy * dy) };
    })
    .filter((e) => e.d <= 5)
    .sort((a, b) => a.d - b.d || b.o.pct - a.o.pct)
    .forEach((e) => {
      if (out.length >= 3) return;
      const o = e.o;
      const nm = placeName(o.c + 0.5, o.r + 0.5, true);
      if (seen.has(nm)) return;
      seen.add(nm);
      out.push({
        id: o.id,
        name: nm,
        km: Math.max(5, Math.round(e.d * 10)),
        level: o.level,
        trend: o.cov < 0.6 ? 'nr' : o.trend,
        strong: o.strong,
      });
    });
  return out;
}

const COUNT_WORD = ['One area', 'Two areas', 'Three areas'];

/** The answer card for a zone or a drawn outline. Copy is identical to the reference. */
export function answer(sel: Selection, data: DataSet): Answer {
  const Z = sel.cells;
  const mode = sel.mode;
  let cx: number;
  let cy: number;
  if (sel.mode === 'drawn') {
    const cc = sel.poly.map((p) => toCell(p[0], p[1]));
    cx = avg(cc, (p) => p.c);
    cy = avg(cc, (p) => p.r);
  } else {
    cx = avg(Z, (x) => x.c + 0.5);
    cy = avg(Z, (x) => x.r + 0.5);
  }
  const km = sel.mode === 'drawn' ? Math.round(polyAreaKm(sel.poly)) : Z.length * CELL_KM2;
  const name = mode === 'drawn' ? 'Drawn area near ' + nearest(cx, cy).p.en : placeName(cx, cy, false);
  const coord = 'Centre ' + (LAT0 - cy * DLAT).toFixed(2) + '°N, ' + (LON0 + cx * DLON).toFixed(2) + '°E';
  const dn = Z.length ? DISTRICT_NAMES[maj(Z, (x) => x.d)] : 'Outside the study area';
  const sub = mode === 'drawn' ? 'Your outline · ' + num(km) + ' km² · ' + dn : dn + ' · zone of ' + num(km) + ' km²';
  const qid = mode === 'drawn' ? 'drawn' : Z.length ? Z[0].id : 'none';
  const base = { mode, name, coord, sub, qid, cx, cy };

  const P = Z.filter((x) => x.kind === 'pasture');
  if (!P.length) {
    const near = betterNear(data, cx, cy, Z, () => true);
    if (!Z.length) {
      return {
        ...base,
        kind: 'outside',
        conf: 'none',
        badge: 'No data',
        water: false,
        reason: 'Outside the study area',
        detail: 'TrendeX covers Naryn oblast and the Suusamyr valley',
        head: 'There is no data here, so there is no answer.',
        expl: 'Draw the outline inside the study-area border.',
        next: 'Redraw the area inside the border.',
        nearest: near,
        actionLabel: 'Add to queue',
      };
    }
    const why = maj(Z, (x) => x.why);
    const kind = maj(Z, (x) => x.kind);
    if (kind === 'excluded') {
      return {
        ...base,
        kind: 'excluded',
        conf: 'none',
        badge: 'Excluded',
        water: why.startsWith('Water'),
        reason: why,
        detail: why.startsWith('Water')
          ? 'Open water covers most of the zone (ESA WorldCover 2021)'
          : why.startsWith('Glacier')
            ? 'Snow, ice and bare rock cover 83% of the zone'
            : why.startsWith('Irrigated')
              ? 'Cropland 58%, settlement 21%, grassland 17% (ESA WorldCover 2021)'
              : 'Settlement 34%, cropland 41%, grassland 22% (ESA WorldCover 2021)',
        head: 'Not a pasture, so this area has no level or trend.',
        expl: 'Land where grassland covers less than half of the ground is left out of every comparison and every share on this map.',
        next: 'Nothing to check here. If this land is grazed in practice, flag the land-cover mask for review.',
        nearest: near,
        actionLabel: 'Flag mask for review',
      };
    }
    return {
      ...base,
      kind: 'nodata',
      conf: 'none',
      badge: 'Not enough data',
      water: false,
      reason: why,
      detail: 'Only ' + Math.round(avg(Z, (x) => x.seasons)) + ' of 26 seasons had clear June–August observations',
      head: 'Too few clear seasons to give a level or trend.',
      expl: 'A level needs at least 10 of 26 clear seasons and a trend at least 16. With fewer, one unusual year can set the answer.',
      next: 'Ask the district pasture committee for recent field notes; the satellite record is too thin here.',
      nearest: near,
      actionLabel: 'Add to queue',
    };
  }

  const n = P.length;
  const cov = avg(P, (x) => x.cov);
  const seasons = Math.round(cov * 26);
  const level = maj(P, (x) => x.level);
  const pcts = P.map((x) => x.pct).sort((a, b) => a - b);
  const pct = pcts[Math.floor((n - 1) / 2)];
  const Vv = meanSeries(P.map(series));
  const baseV = avg(Vv, (a) => a);

  let slope: number;
  let trend: Trend;
  let w: number;
  if (mode === 'drawn') {
    const f = fit(Vv);
    slope = Math.round(f.sp * 10) / 10;
    trend = cov < 0.6 ? 'nr' : f.dir;
    w = Math.max(0.1, Math.round(f.ci * 10) / 10);
  } else {
    trend = maj(P, (x) => (x.cov < 0.6 ? 'nr' : x.trend));
    slope = Math.round(avg(P, (x) => x.slope) * 10) / 10;
    if (trend === 'dec' && slope >= 0) trend = 'nr';
    if (trend === 'inc' && slope <= 0) trend = 'nr';
    w = trend === 'nr' ? Math.abs(slope) + 0.4 : Math.max(0.2, Math.round(Math.abs(slope) * 4.5) / 10);
  }
  const strong = trend !== 'nr' && Math.abs(slope) >= 1.1;
  let conf: Confidence = cov < 0.6 ? 'Low' : trend !== 'nr' && cov > 0.78 ? 'High' : 'Medium';
  const small = mode === 'drawn' && n < 3;
  if (small && conf !== 'Low') conf = conf === 'High' ? 'Medium' : 'Low';
  const lowTxt = small
    ? 'The outline covers only ' + n + ' cell' + (n === 1 ? '' : 's') +
      ' of data, so the interval is wide. Treat this answer as a hint and check on the ground before using it.'
    : 'Only ' + seasons +
      ' of 26 seasons had clear observations, most lost to snow and cloud. Treat this answer as a hint and check on the ground before using it.';
  const lo = slope - w;
  const hi = slope + w;
  const trSub = signed(slope) + '% per year' + (trend === 'nr' ? ', interval includes zero' : '');
  const better = betterNear(data, cx, cy, Z, (b) => b.pct >= pct + 10 && b.trend !== 'dec' && b.conf !== 'Low');
  const tp =
    trend === 'dec'
      ? 'and reliably declining since 2000 (' + signed(slope) + '% per year).'
      : trend === 'inc'
        ? 'and reliably rising since 2000 (' + signed(slope) + '% per year).'
        : 'with no reliable trend since 2000: year-to-year swings are larger than any direction.';
  const takeaway =
    LEVEL_NAME[level] + ' relative to other pastures in Naryn oblast, ' + tp +
    (better.length
      ? ' ' + COUNT_WORD[better.length - 1] + ' within ' + better[better.length - 1].km + ' km ' +
        (better.length === 1 ? 'scores' : 'score') + ' higher and ' + (better.length === 1 ? 'is' : 'are') +
        ' not declining.'
      : '');

  // This season: 2025 against the 2000–2024 range.
  const hist = Vv.slice(0, 25);
  const srt = hist.slice().sort((a, b) => a - b);
  const cur = Vv[25];
  const rl = Math.min(srt[0], cur);
  const rh = Math.max(srt[24], cur);
  const PP = (v: number) => ((v - rl) / (rh - rl)) * 100;
  const pc = Math.round((100 * hist.filter((h) => h < cur).length) / 25);
  const seasonText =
    '2025 is ' +
    (cur < srt[0]
      ? 'below anything seen in 2000–2024'
      : cur > srt[24]
        ? 'above anything seen in 2000–2024'
        : pc < 30
          ? 'in the lower part of its usual range'
          : pc > 70
            ? 'in the upper part of its usual range'
            : 'in the middle of its usual range') +
    ' (' + ord(pc) + ' percentile).';

  const m10 = avg(Vv.slice(0, 10), (a) => a);
  let kb = 0;
  let ka = 0;
  for (let i = 16; i < 26; i++) {
    if (Vv[i] < m10) kb++;
    else ka++;
  }
  const wy: [Sign, string][] = [];
  if (trend === 'dec') {
    wy.push(['−', 'Slope ' + signed(slope) + '% per year; the 95% interval (' + signed(lo) + ' to ' + signed(hi) + ') stays below zero.']);
    wy.push(['−', kb + ' of the last 10 seasons were below the 2000–2009 average.']);
  } else if (trend === 'inc') {
    wy.push(['+', 'Slope ' + signed(slope) + '% per year; the 95% interval (' + signed(lo) + ' to ' + signed(hi) + ') stays above zero.']);
    wy.push(['+', ka + ' of the last 10 seasons were above the 2000–2009 average.']);
  } else {
    wy.push(['−', 'The 95% interval for the slope (' + signed(lo) + ' to ' + signed(hi) + '% per year) includes zero.']);
  }
  wy.push(
    level === 'low'
      ? ['−', 'Level is in the lowest third of pastures in the oblast.']
      : ['+', 'Level is above the lowest third of pastures in the oblast (' + ord(pct) + ' percentile).'],
  );
  if (small) wy.push(['−', 'The outline covers only ' + n + ' cell' + (n === 1 ? '' : 's') + ' of data.']);
  else if (conf === 'Low') wy.push(['−', 'Only ' + seasons + ' of 26 seasons had clear observations.']);
  else wy.push(['+', seasons + ' of 26 seasons had clear observations' + (n > 1 ? ' across ' + n + ' cells.' : '.')]);

  const next =
    conf === 'Low'
      ? 'Check on the ground before using this answer. Ask the district pasture committee for recent field notes.'
      : trend === 'dec' && level === 'low'
        ? 'Prioritise for a field check this season and compare with the areas listed above before advising on grazing routes.'
        : trend === 'dec'
          ? 'Add to the field-check queue for the 2026 season' +
            (better.length ? ' and compare with ' + better[0].name + ' before advising on grazing routes.' : '.')
          : trend === 'inc'
            ? 'No field check needed. This area can serve as a reference for nearby comparisons.'
            : 'No action from the trend alone. Keep it on the regular monitoring cycle.';

  return {
    ...base,
    kind: 'pasture',
    conf,
    badge: conf + ' confidence',
    lowTxt,
    level,
    trend,
    strong,
    pct,
    slope,
    w,
    lo,
    hi,
    trSub,
    takeaway,
    why: wy.slice(0, 3),
    better,
    next,
    actionLabel: 'Add to queue',
    cells: n,
    seasons,
    chart: { values: Vv, base: baseV, slope, w, cov },
    season: {
      iqL: PP(srt[6]),
      iqW: PP(srt[18]) - PP(srt[6]),
      cur: PP(cur),
      min: srt[0],
      max: srt[24],
      text: seasonText,
    },
  };
}
