import { cellsCsv, districtPanels, matrixTable, scopeTrend, trendShares } from './trends';
import { headline } from './stats';
import { fixture } from '../test/fixtures';

const { data } = fixture();

describe('trends', () => {
  it('trend shares match the map headline and sum to 100', () => {
    const s = trendShares(data.past);
    const h = headline(data.past);
    expect(s.map((x) => x.pct)).toEqual([h.dec, h.nr, h.inc]);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBe(100);
    expect(s.reduce((a, x) => a + x.km2, 0)).toBe(data.past.length * 100);
  });

  it('matrix km² adds up to the pasture area', () => {
    const m = matrixTable(data.past);
    expect(m.flat().reduce((a, x) => a + x.km2, 0)).toBe(data.past.length * 100);
  });

  it('scope trend has an interval around the slope', () => {
    const t = scopeTrend(data.past)!;
    expect(t.lo).toBeLessThan(t.slope);
    expect(t.hi).toBeGreaterThan(t.slope);
    expect(t.model.values).toHaveLength(26);
  });

  it('district panels are sorted by slope', () => {
    const p = districtPanels(data.past);
    expect(p.length).toBe(6);
    for (let i = 1; i < p.length; i++) expect(p[i].slope).toBeGreaterThanOrEqual(p[i - 1].slope);
  });

  it('csv has a header and one row per cell', () => {
    const ko = data.cells.filter((x) => x.d === 'KO');
    const csv = cellsCsv(ko).trim().split('\n');
    expect(csv[0]).toMatch(/sample data/i);
    expect(csv[1].startsWith('id,district,lon,lat,kind')).toBe(true);
    expect(csv.length).toBe(ko.length + 2);
  });
});
