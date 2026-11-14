import { buildQueue, filterQueue, EMPTY_FILTER, parseOutline, outlineParam, queueCsv, scoreOf } from './queue';
import { answer } from './answer';
import { selectZone } from './zones';
import { fixture } from '../test/fixtures';

const { data } = fixture();

describe('queue', () => {
  const rows = buildQueue(data, []);

  it('ranks decline zones by score, highest first', () => {
    expect(rows.length).toBeGreaterThan(5);
    for (let i = 1; i < rows.length; i++) expect(rows[i].score).toBeLessThanOrEqual(rows[i - 1].score);
    expect(rows.every((r) => r.trend === 'dec' && r.score > 0)).toBe(true);
  });

  it('uses the stated formula', () => {
    const a = answer(selectZone(data, '3,4', 'trend')!, data);
    if (a.kind !== 'pasture') throw new Error();
    // moderate (1.0) × high (1.0) × 1.1
    expect(scoreOf(a)).toBeCloseTo(-a.slope * 1.0 * 1.0, 6);
  });

  it('covers each decline cell once', () => {
    const ids = rows.map((r) => r.key);
    expect(new Set(ids).size).toBe(ids.length);
    const km = rows.reduce((s, r) => s + r.km2, 0);
    expect(km).toBe(data.past.filter((x) => x.trend === 'dec').length * 100);
  });

  it('marks areas added from the map', () => {
    const withAdded = buildQueue(data, [
      { key: '3,4', type: 'zone', cellId: '3,4' },
      { key: data.excl!, type: 'zone', cellId: data.excl!, flag: true },
    ]);
    expect(withAdded.filter((r) => r.fromMap)).toHaveLength(2);
    const ex = withAdded.find((r) => r.kind === 'excluded')!;
    expect(ex.reason).toMatch(/^Mask review/);
    expect(filterQueue(withAdded, { ...EMPTY_FILTER, addedOnly: true })).toHaveLength(2);
  });

  it('filters by district, level and confidence', () => {
    const ko = filterQueue(rows, { ...EMPTY_FILTER, district: 'KO' });
    expect(ko.every((r) => r.district === 'KO')).toBe(true);
    const low = filterQueue(rows, { ...EMPTY_FILTER, levels: ['low'] });
    expect(low.every((r) => r.level === 'low')).toBe(true);
    const hi = filterQueue(rows, { ...EMPTY_FILTER, highOnly: true });
    expect(hi.every((r) => r.conf === 'High')).toBe(true);
  });

  it('round-trips outlines and exports csv', () => {
    const p: [number, number][] = [[74, 42], [74.1, 42], [74.1, 41.9]];
    expect(parseOutline(outlineParam(p))).toEqual(p);
    expect(parseOutline('1,2;3')).toBeNull();
    expect(queueCsv(rows).split('\n')[1]).toMatch(/^rank,area,id/);
  });
});
