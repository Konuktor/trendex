/**
 * Parity with the reference prototype: the reference's own functions are
 * evaluated from reference/trendex-map-prototype.html and compared with the port.
 */
import { answer } from './answer';
import { buildMask } from './mask';
import { fit, series } from './series';
import { parseSearch, placeName } from './places';
import { selectDrawn, selectZone } from './zones';
import type { Layer, LonLat } from './types';
import { ADM1, ADM2, fixture, loadReference } from '../test/fixtures';

const ref = loadReference();
const refMask = ref.realMask(ADM1, ADM2);
const refData = ref.buildData(refMask);
ref.setD(refData);
const { mask, data } = fixture();

describe('mask', () => {
  it('matches the reference cell → district map', () => {
    expect(buildMask(ADM1, ADM2)!.m).toEqual(refMask.m);
    expect(Object.keys(mask.m).length).toBeGreaterThan(300);
  });
  it('uses the same ADM2 district outlines', () => {
    expect(mask.districts.map((f) => f.properties.shapeName).sort()).toEqual(
      refMask.districts.map((f: { properties: { shapeName: string } }) => f.properties.shapeName).sort(),
    );
  });
});

describe('buildData', () => {
  it('produces identical cells', () => {
    expect(data.cells.length).toBe(refData.cells.length);
    for (const x of data.cells) {
      const y = refData.byKey[x.id];
      expect({ ...x }).toEqual({
        id: y.k, c: y.c, r: y.r, lon: y.lon, lat: y.lat, d: y.d, kind: y.kind, why: y.why, water: y.water,
        pct: y.pct, level: y.level, slope: y.slope, trend: y.trend, strong: y.strong, cov: y.cov,
        seasons: y.seasons, conf: y.conf,
      });
    }
    expect(data.past.map((x) => x.id)).toEqual(refData.past.map((x: { k: string }) => x.k));
    expect([data.demo, data.low, data.excl]).toEqual([refData.demo, refData.low, refData.excl]);
  });

  it('produces identical series and fits', () => {
    for (const x of data.past.slice(0, 40)) {
      const a = series(x);
      expect(a).toEqual(ref.series(refData.byKey[x.id]));
      expect(fit(a)).toEqual(ref.fit(a));
    }
  });
});

function compare(mine: ReturnType<typeof answer>, o: Record<string, any>) { // eslint-disable-line
  expect(mine.name).toBe(o.name);
  expect(mine.sub).toBe(o.sub);
  expect(mine.coord).toBe(o.coord);
  expect(mine.badge).toBe(o.badge);
  expect(mine.next).toBe(o.next);
  expect(mine.qid).toBe(o.qid);
  if (mine.kind === 'pasture') {
    expect(o.isPasture).toBe(true);
    expect([mine.level, mine.trend, mine.strong, mine.pct, mine.slope, mine.conf]).toEqual([
      o.level, o.trend, o.strong, o.pct, o.slope, o.conf,
    ]);
    expect(mine.takeaway).toBe(o.takeaway);
    expect(mine.trSub).toBe(o.trSub);
    expect(mine.why).toEqual(o.why);
    expect(mine.season.text).toBe(o.seasonTxt);
    expect(mine.season.iqL.toFixed(1)).toBe(o.rIqL);
    expect(mine.season.cur.toFixed(1)).toBe(o.rCur);
    expect(mine.better.map((b) => [b.id, b.name, b.km])).toEqual(o.better.map((b: any) => [b.k, b.name, b.km])); // eslint-disable-line
    if (mine.conf === 'Low') expect(mine.lowTxt).toBe(o.lowTxt);
  } else {
    expect(o.isPasture).toBe(false);
    expect([mine.reason, mine.detail, mine.head, mine.expl]).toEqual([o.reason, o.detail, o.head, o.expl]);
    expect(mine.nearest.map((b) => b.name)).toEqual(o.better.map((b: { name: string }) => b.name));
    expect(mine.actionLabel).toBe(o.qLabel);
  }
}

describe('answer', () => {
  for (const layer of ['trend', 'level'] as Layer[]) {
    it(`matches the reference for every zone (${layer} layer)`, () => {
      ref.S.layer = layer;
      ref.S.poly = null;
      for (const x of data.cells) {
        ref.S.sel = x.id;
        const o = ref.answer(ref.selection());
        compare(answer(selectZone(data, x.id, layer)!, data), o);
      }
    });
  }

  it('matches the reference for drawn outlines', () => {
    const polys: LonLat[][] = [
      [[73.9, 42.2], [74.15, 42.2], [74.15, 42.05], [73.9, 42.05]],
      [[75.6, 42.3], [75.9, 42.3], [75.9, 42.1], [75.6, 42.1]],
      [[75.0, 41.0], [75.5, 41.1], [75.4, 40.7]],
      [[74.0, 42.16], [74.05, 42.16], [74.05, 42.13]],
      [[70.0, 40.0], [70.2, 40.0], [70.1, 39.9]],
      [[76.2, 41.6], [76.9, 41.7], [76.8, 41.2], [76.1, 41.25]],
    ];
    ref.S.layer = 'trend';
    ref.S.sel = null;
    for (const poly of polys) {
      ref.S.poly = poly;
      compare(answer(selectDrawn(data, poly), data), ref.answer(ref.selection()));
    }
  });
});

describe('places', () => {
  it('names match the reference on a lattice of points', () => {
    for (let cy = 0; cy < 22; cy += 0.7)
      for (let cx = 0; cx < 40; cx += 0.9) {
        expect(placeName(cx, cy)).toBe(ref.placeName(cx, cy, false));
        expect(placeName(cx, cy, true)).toBe(ref.placeName(cx, cy, true));
      }
  });
  it('search matches the reference', () => {
    for (const q of ['Кочкор', 'ko', 'Ak', '42,15; 74,02', '42.15, 74.02', 'Нар', 'x', '', '41 75']) {
      expect(parseSearch(q).map(({ label, sub, lon, lat }) => ({ label, sub, lon, lat }))).toEqual(ref.suggestions(q));
    }
  });
});
