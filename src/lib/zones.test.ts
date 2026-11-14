import { buildZoneGeoJSON, classOf, selectZone, smoothPolygon, zoneKey, zoneOf } from './zones';
import { cellCenter } from './geo';
import { fixture } from '../test/fixtures';

const { data } = fixture();

describe('zoneOf', () => {
  it('stays within 2.3 cells of the anchor, same key and 4-connected', () => {
    for (const layer of ['trend', 'level'] as const) {
      for (const a of data.cells) {
        const Z = zoneOf(a, layer, data.byId);
        expect(Z[0]).toBe(a);
        const ids = new Set(Z.map((x) => x.id));
        for (const x of Z) {
          expect(Math.hypot(x.c - a.c, x.r - a.r)).toBeLessThanOrEqual(2.3);
          expect(zoneKey(x, layer)).toBe(zoneKey(a, layer));
          if (x !== a) {
            const linked = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => ids.has(`${x.c + dc},${x.r + dr}`));
            expect(linked).toBe(true);
          }
        }
      }
    }
  });

  it('separates low-coverage pastures on the trend layer only', () => {
    const low = data.byId[data.low!];
    expect(zoneKey(low, 'trend')).toBe('lowc');
    expect(zoneKey(low, 'level')).toBe(`L${low.level}`);
    expect(classOf(low, 'trend')).toBe('nr');
  });

  it('selects the demo zone around (3,4)', () => {
    const s = selectZone(data, '3,4', 'trend')!;
    expect(s.mode).toBe('zone');
    expect(s.cells.every((x) => x.trend === 'dec')).toBe(true);
  });
});

describe('smoothed zone polygons', () => {
  it('a single cell becomes a rounded blob centred on the cell, not a square', () => {
    const x = data.byId['3,4'];
    const g = smoothPolygon([x])!;
    expect(g.coordinates).toHaveLength(1);
    const ring = g.coordinates[0][0];
    expect(ring.length).toBeGreaterThan(12);
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const [clon, clat] = cellCenter(x.c, x.r);
    expect(Math.abs(lon - clon)).toBeLessThan(0.12 * 0.1);
    expect(Math.abs(lat - clat)).toBeLessThan(0.09 * 0.1);
    const lons = ring.map((p) => p[0]);
    const width = (Math.max(...lons) - Math.min(...lons)) / 0.12;
    expect(width).toBeGreaterThan(0.8);
    expect(width).toBeLessThan(1.2);
  });

  it('builds one feature per present class in draw order, plus dim under a filter', () => {
    const all = buildZoneGeoJSON(data.cells, 'trend', { matrix: null, district: null });
    const order = ['decS', 'dec', 'nr', 'inc', 'incS', 'excl', 'nodata'];
    const got = all.features.map((f) => f.properties.cls);
    expect(got).toEqual(order.filter((c) => got.includes(c as never)));
    expect(got).not.toContain('dim');

    const f = buildZoneGeoJSON(data.cells, 'trend', { matrix: { level: 'moderate', trend: 'dec' }, district: null });
    expect(f.features.at(-1)!.properties.cls).toBe('dim');
    const kept = f.features.filter((x) => x.properties.cls !== 'dim');
    expect(kept.every((x) => x.properties.cls === 'dec' || x.properties.cls === 'decS')).toBe(true);

    const lv = buildZoneGeoJSON(data.cells, 'level', { matrix: null, district: 'KO' });
    expect(lv.features.map((x) => x.properties.cls)).toContain('dim');
    expect(lv.features.some((x) => x.properties.cls.startsWith('L'))).toBe(true);
  });
});
