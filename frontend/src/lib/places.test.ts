import { parseSearch, placeName, PLACES } from './places';

describe('parseSearch', () => {
  it('finds a place by Cyrillic prefix', () => {
    const r = parseSearch('Кочкор');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'place', label: 'Kochkor', sub: 'Кочкор', lat: 42.215, lon: 75.755 });
  });

  it('parses "lat, lon" with comma decimals and a semicolon', () => {
    const r = parseSearch('42,15; 74,02');
    expect(r[0]).toMatchObject({ kind: 'coords', label: '42.15°N, 74.02°E', lat: 42.15, lon: 74.02 });
  });

  it('parses dot decimals and Latin prefixes, case-insensitively', () => {
    expect(parseSearch('42.15, 74.02')[0]).toMatchObject({ lat: 42.15, lon: 74.02 });
    expect(parseSearch('ak').map((s) => s.label)).toEqual(['Ak-Sai', 'Ak-Shyirak']);
    expect(parseSearch('   ')).toEqual([]);
  });
});

describe('placeName', () => {
  it('says "Around X" near a place and gives a distance otherwise', () => {
    const s = PLACES[0];
    expect(placeName(s.c, s.r)).toBe('Around Suusamyr');
    expect(placeName(s.c, s.r, true)).toBe('Suusamyr, 5 km E');
    expect(placeName(s.c + 3, s.r)).toMatch(/^[A-Za-z-]+, \d+ km [NSEW]{1,2}$/);
  });
});
