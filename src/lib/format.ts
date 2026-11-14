export function avg<T>(a: readonly T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of a) s += f(x);
  return a.length ? s / a.length : 0;
}

/** Most frequent key; on ties the key that reached the top count first wins (as in the reference). */
export function maj<T, K extends string>(a: readonly T[], f: (x: T) => K): K {
  const m: Record<string, number> = {};
  let best: K | null = null;
  let bn = -1;
  for (const x of a) {
    const k = f(x);
    m[k] = (m[k] || 0) + 1;
    if (m[k] > bn) {
      bn = m[k];
      best = k;
    }
  }
  return best as K;
}

export function num(v: number | string): string {
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "+1.2", "−1.1" (U+2212), "±0.0". */
export function signed(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(1);
}

export function ord(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function norm(s: string | null | undefined): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
