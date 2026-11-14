import { dataInfo, isReal } from '../data/info';
import { answer, type Answer } from './answer';
import { selectDrawn, selectZone } from './zones';
import { DISTRICT_NAMES } from './mask';
import { maj, signed } from './format';
import type { Confidence, DataSet, District, Level, LonLat, Trend } from './types';

export const LEVEL_WEIGHT: Record<Level, number> = { low: 1.3, moderate: 1.0, good: 0.7 };
export const CONF_WEIGHT: Record<Confidence, number> = { High: 1.0, Medium: 0.8, Low: 0 };
export const SCORE_FORMULA =
  'Score = steepness of decline (%/yr) × level weight (low 1.3, moderate 1.0, good 0.7) × confidence weight (high 1.0, medium 0.8).';

export interface QueueRow {
  /** stable key: anchor cell id or drawn key */
  key: string;
  /** cell id or "drawn" */
  id: string;
  name: string;
  district: District | null;
  districtName: string;
  level: Level | null;
  trend: Trend | null;
  strong: boolean;
  slope: number | null;
  km2: number;
  conf: Confidence | null;
  reason: string;
  score: number;
  fromMap: boolean;
  /** map link target */
  href: string;
  kind: Answer['kind'];
}

export interface AddedItem {
  key: string;
  type: 'zone' | 'drawn';
  cellId?: string;
  poly?: LonLat[];
  flag?: boolean;
}

export function scoreOf(a: Answer): number {
  if (a.kind !== 'pasture' || a.trend !== 'dec' || a.slope >= 0) return 0;
  return Math.round(-a.slope * LEVEL_WEIGHT[a.level] * CONF_WEIGHT[a.conf] * 100) / 100;
}

export function outlineParam(poly: LonLat[]): string {
  return poly.map(([lon, lat]) => `${lon.toFixed(4)},${lat.toFixed(4)}`).join(';');
}

export function parseOutline(s: string | null): LonLat[] | null {
  if (!s) return null;
  const pts = s.split(';').map((p) => p.split(',').map(Number) as LonLat);
  return pts.length >= 3 && pts.every((p) => p.length === 2 && p.every(Number.isFinite)) ? pts : null;
}

function rowFrom(key: string, a: Answer, cells: { d: District }[], href: string, fromMap: boolean): QueueRow {
  const district = cells.length ? maj(cells, (x) => x.d) : null;
  const km2 = Number((a.sub.match(/([\d,]+) km²/)?.[1] ?? '0').replace(/,/g, ''));
  if (a.kind === 'pasture') {
    const reason =
      a.trend === 'dec'
        ? `Decline ${signed(a.slope)}% per year; ${a.why[1]?.[1].replace(/\.$/, '').toLowerCase() ?? ''}`
        : a.trend === 'inc'
          ? `Reliable growth (${signed(a.slope)}% per year); added for comparison`
          : 'No reliable trend; added for a field check';
    return {
      key, id: a.qid, name: a.name, district, districtName: district ? DISTRICT_NAMES[district] : 'Outside the study area',
      level: a.level, trend: a.trend, strong: a.strong, slope: a.slope, km2, conf: a.conf, reason,
      score: scoreOf(a), fromMap, href, kind: a.kind,
    };
  }
  return {
    key, id: a.qid, name: a.name, district, districtName: district ? DISTRICT_NAMES[district] : 'Outside the study area',
    level: null, trend: null, strong: false, slope: null, km2, conf: null,
    reason: a.kind === 'excluded' ? `Mask review: ${a.reason.toLowerCase()}` : a.reason,
    score: 0, fromMap, href, kind: a.kind,
  };
}

/**
 * Ranked field-check candidates: every zone with a reliable decline (zones grouped as on
 * the trend map), plus areas added from the map. Sorted by score, highest first.
 */
export function buildQueue(data: DataSet, added: readonly AddedItem[]): QueueRow[] {
  const taken = new Set<string>();
  const rows: QueueRow[] = [];
  const anchors = data.past.filter((x) => x.trend === 'dec').sort((a, b) => a.slope - b.slope || a.id.localeCompare(b.id));
  const cellToRow = new Map<string, QueueRow>();
  for (const x of anchors) {
    if (taken.has(x.id)) continue;
    const sel = selectZone(data, x.id, 'trend')!;
    const cells = sel.cells.filter((c) => !taken.has(c.id));
    cells.forEach((c) => taken.add(c.id));
    const a = answer({ ...sel, cells }, data);
    const row = rowFrom(x.id, a, cells, `/map?area=${encodeURIComponent(x.id)}`, false);
    rows.push(row);
    cells.forEach((c) => cellToRow.set(c.id, row));
  }
  for (const item of added) {
    if (item.type === 'zone' && item.cellId) {
      const hit = cellToRow.get(item.cellId);
      if (hit) {
        hit.fromMap = true;
        continue;
      }
      const sel = selectZone(data, item.cellId, 'trend');
      if (!sel) continue;
      rows.push(rowFrom(item.key, answer(sel, data), sel.cells, `/map?area=${encodeURIComponent(item.cellId)}`, true));
    } else if (item.type === 'drawn' && item.poly) {
      const sel = selectDrawn(data, item.poly);
      rows.push(rowFrom(item.key, answer(sel, data), sel.cells, `/map?outline=${encodeURIComponent(outlineParam(item.poly))}`, true));
    }
  }
  return rows.sort((a, b) => b.score - a.score || Number(b.fromMap) - Number(a.fromMap) || a.key.localeCompare(b.key));
}

export interface QueueFilter {
  district: District | null;
  levels: Level[];
  highOnly: boolean;
  /** show only rows added from the map */
  addedOnly: boolean;
}

export const EMPTY_FILTER: QueueFilter = { district: null, levels: [], highOnly: false, addedOnly: false };

export function filterQueue(rows: readonly QueueRow[], f: QueueFilter): QueueRow[] {
  return rows.filter(
    (r) =>
      (!f.district || r.district === f.district) &&
      (!f.levels.length || (r.level !== null && f.levels.includes(r.level))) &&
      (!f.highOnly || r.conf === 'High') &&
      (!f.addedOnly || r.fromMap),
  );
}

export function queueCsv(rows: readonly QueueRow[]): string {
  const head = ['rank', 'area', 'id', 'district', 'level', 'trend', 'slope_pct_per_year', 'pasture_km2', 'confidence', 'reason', 'score', 'added_from_map'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r, i) =>
    [i + 1, r.name, r.id, r.districtName, r.level, r.trend, r.slope?.toFixed(1), r.km2, r.conf, r.reason, r.score.toFixed(2), r.fromMap]
      .map(esc)
      .join(','),
  );
  const top = isReal() ? `# TrendeX inspection queue (NASA MODIS, pipeline ${dataInfo.pipelineVersion}). A prioritisation for field checks, not an instruction.` : '# TrendeX inspection queue, sample data. A prioritisation for field checks, not an instruction.';
  return [top, head.join(','), ...lines].join('\n') + '\n';
}
