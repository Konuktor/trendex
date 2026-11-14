import { answer } from './answer';
import { selectDrawn, selectZone } from './zones';
import { cellCenter } from './geo';
import type { LonLat } from './types';
import { fixture } from '../test/fixtures';

const { data } = fixture();

describe('demo cell (Suusamyr, 3,4)', () => {
  it('is a moderate, reliable decline of −1.1 %/yr with high confidence', () => {
    const x = data.byId['3,4'];
    expect(data.demo).toBe('3,4');
    expect(x).toMatchObject({ d: 'SU', kind: 'pasture', level: 'moderate', trend: 'dec', slope: -1.1, conf: 'High' });
  });

  it('answers the demo zone as the reference does', () => {
    const a = answer(selectZone(data, '3,4', 'trend')!, data);
    if (a.kind !== 'pasture') throw new Error('expected pasture');
    expect(a.name).toBe('Around Suusamyr');
    expect(a.level).toBe('moderate');
    expect(a.trend).toBe('dec');
    expect(a.conf).toBe('High');
    expect(a.takeaway.startsWith('Moderate relative to other pastures in Naryn oblast, and reliably declining since 2000')).toBe(true);
    expect(a.why[0][0]).toBe('−');
    expect(a.why.length).toBeGreaterThanOrEqual(2);
    expect(a.why.length).toBeLessThanOrEqual(3);
    expect(a.actionLabel).toBe('Add to queue');
  });
});

describe('excluded Kochkor zone', () => {
  it('is not a pasture and offers a mask review', () => {
    expect(data.excl).not.toBeNull();
    const a = answer(selectZone(data, data.excl!, 'trend')!, data);
    expect(a.kind).toBe('excluded');
    if (a.kind === 'pasture') return;
    expect(a.badge).toBe('Excluded');
    expect(a.reason).toBe('Irrigated cropland and settlement');
    expect(a.detail).toBe('Cropland 58%, settlement 21%, grassland 17% (ESA WorldCover 2021)');
    expect(a.head).toBe('Not a pasture, so this area has no level or trend.');
    expect(a.actionLabel).toBe('Flag mask for review');
    expect(a.nearest.length).toBeGreaterThan(0);
    expect(a.sub.startsWith('Kochkor')).toBe(true);
  });
});

describe('Ak-Sai low-confidence zone', () => {
  it('has coverage 0.5 and low confidence', () => {
    const x = data.byId[data.low!];
    expect(x.cov).toBe(0.5);
    expect(x.conf).toBe('Low');
    const a = answer(selectZone(data, data.low!, 'trend')!, data);
    if (a.kind !== 'pasture') throw new Error('expected pasture');
    expect(a.conf).toBe('Low');
    expect(a.badge).toBe('Low confidence');
    expect(a.lowTxt).toMatch(/^Only \d+ of 26 seasons had clear observations, most lost to snow and cloud\./);
    expect(a.next).toBe('Check on the ground before using this answer. Ask the district pasture committee for recent field notes.');
  });
});

describe('drawn outlines', () => {
  const box = (lon: number, lat: number, e: number): LonLat[] => [
    [lon - e, lat + e * 0.75],
    [lon + e, lat + e * 0.75],
    [lon + e, lat - e * 0.75],
    [lon - e, lat - e * 0.75],
  ];

  it('an outline of fewer than 3 cells gets lower confidence', () => {
    const [lon, lat] = cellCenter(3, 4);
    const tiny = selectDrawn(data, box(lon, lat, 0.03));
    expect(tiny.cells.length).toBe(1);
    const a = answer(tiny, data);
    if (a.kind !== 'pasture') throw new Error('expected pasture');
    // The same area as a zone-level answer is High; the tiny outline is capped one step lower.
    expect(['Medium', 'Low']).toContain(a.conf);
    expect(a.conf).not.toBe('High');
    // "Why" keeps the first three factors, so the cell-count factor can drop off; the banner text always says it.
    expect(a.lowTxt.startsWith('The outline covers only 1 cell of data, so the interval is wide.')).toBe(true);
    expect(a.cells).toBe(1);
  });

  it('an outline outside the study area gets the outside card', () => {
    const a = answer(selectDrawn(data, box(70, 40, 0.1)), data);
    expect(a.kind).toBe('outside');
    expect(a.badge).toBe('No data');
    expect(a.name.startsWith('Drawn area near')).toBe(true);
  });
});

describe('copy rules', () => {
  it('never uses banned words in any answer', () => {
    const banned = /\b(degradation|cause|safe|allowed)\b/i;
    for (const x of data.cells) {
      const a = answer(selectZone(data, x.id, 'trend')!, data);
      const text = JSON.stringify(a);
      expect(text).not.toMatch(banned);
      if (/suitable/i.test(text)) expect(text).toMatch(/relative/i);
    }
  });
});
