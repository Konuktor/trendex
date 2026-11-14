import { H, V, YR } from './noise';
import { fit } from './series';
import { num, ord, signed } from './format';

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(H(1, 2, 3)).toBe(H(1, 2, 3));
    for (let i = 0; i < 200; i++) {
      const h = H(i, i * 7, 5);
      const v = V(i / 3, i / 5, 2, 4);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(YR).toHaveLength(26);
  });
});

describe('fit', () => {
  it('recovers a linear slope in % per year', () => {
    const v = Array.from({ length: 26 }, (_, i) => 0.5 * (1 - 0.01 * (i - 12.5)));
    const f = fit(v);
    expect(f.sp).toBeCloseTo(-1, 6);
    expect(f.ci).toBeCloseTo(0, 6);
    expect(f.dir).toBe('dec');
  });
});

describe('format', () => {
  it('formats signs, ordinals and thousands', () => {
    expect(signed(-1.1)).toBe('−1.1');
    expect(signed(0.4)).toBe('+0.4');
    expect(signed(0)).toBe('±0.0');
    expect(ord(1)).toBe('1st');
    expect(ord(12)).toBe('12th');
    expect(ord(23)).toBe('23rd');
    expect(num(12500)).toBe('12,500');
  });
});
