// Trend statistics: a port of backend/trendex_core/stats/trend.py (pymannkendall Hamed-Rao + Gilbert CI).
// Parity with Python is checked by test_parity.ts.

export const Z975 = 1.959963984540054;

// Normal CDF via erfc (W. J. Cody-style rational approximation, |err| < 1.2e-7)
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

export function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mkScore(x: number[]): number {
  let s = 0;
  for (let i = 0; i < x.length - 1; i++) for (let j = i + 1; j < x.length; j++) s += Math.sign(x[j] - x[i]);
  return s;
}

function varianceS(x: number[]): number {
  const n = x.length;
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size === n) return (n * (n - 1) * (2 * n + 5)) / 18;
  let tie = 0;
  for (const tp of counts.values()) tie += tp * (tp - 1) * (2 * tp + 5);
  return (n * (n - 1) * (2 * n + 5) - tie) / 18;
}

function zScore(s: number, v: number): number {
  return s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
}

function rankdata(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function mkOriginal(x: number[]): { p: number; z: number; s: number } {
  const s = mkScore(x);
  const z = zScore(s, varianceS(x));
  return { p: 2 * (1 - normCdf(Math.abs(z))), z, s };
}

export function mkHamedRao(x: number[]): { p: number; z: number; s: number } {
  const n = x.length;
  const s = mkScore(x);
  let v = varianceS(x);
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sl.push((x[j] - x[i]) / (j - i));
  const med = median(sl);
  const xd = x.map((v2, i) => v2 - (i + 1) * med);
  const I = rankdata(xd);
  const mean = I.reduce((a, b) => a + b, 0) / n;
  const y = I.map((q) => q - mean);
  const acov: number[] = [];
  for (let k = 0; k < n; k++) {
    let a = 0;
    for (let t = 0; t + k < n; t++) a += y[t] * y[t + k];
    acov.push(a / n);
  }
  const interval = Z975 / Math.sqrt(n);
  let sni = 0;
  for (let i = 1; i < n; i++) {
    const r = acov[i] / acov[0];
    if (!(r <= interval && r >= -interval)) sni += (n - i) * (n - i - 1) * (n - i - 2) * r;
  }
  v = v * (1 + (2 / (n * (n - 1) * (n - 2))) * sni);
  const z = zScore(s, v);
  return { p: 2 * (1 - normCdf(Math.abs(z))), z, s };
}

export interface TrendResult {
  slope: number; intercept: number; ci_lo: number; ci_hi: number; p: number; z: number; n: number; method: string;
}

export function trend1d(yIn: ArrayLike<number>, years: number[], method = "hamed_rao", minN = 8): TrendResult {
  const y: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < yIn.length; i++) if (Number.isFinite(yIn[i])) { y.push(yIn[i]); t.push(years[i]); }
  const n = y.length;
  const out: TrendResult = { slope: NaN, intercept: NaN, ci_lo: NaN, ci_hi: NaN, p: NaN, z: NaN, n, method };
  if (n < minN) return out;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(y.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd === 0) return { ...out, slope: 0, intercept: median(y), ci_lo: 0, ci_hi: 0, p: 1, z: 0 };
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sl.push((y[j] - y[i]) / (t[j] - t[i]));
  sl.sort((a, b) => a - b);
  const m = sl.length;
  const slope = median(sl);
  const c = Z975 * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  const lo = Math.min(Math.max(Math.floor((m - c) / 2), 0), m - 1);
  const hi = Math.min(Math.max(Math.ceil((m + c) / 2), 0), m - 1);
  let r = method === "hamed_rao" ? mkHamedRao(y) : mkOriginal(y);
  if (!Number.isFinite(r.p)) r = mkOriginal(y);
  const intercept = median(y.map((v, i) => v - slope * t[i]));
  return { slope, intercept, ci_lo: sl[lo], ci_hi: sl[hi], p: r.p, z: r.z, n, method };
}

export function classify(slope: number, p: number, n: number, alpha = 0.05, minYears = 18): string {
  if (n < minYears || !Number.isFinite(slope)) return "insufficient";
  if (Number.isFinite(p) && p < alpha) return slope > 0 ? "growth" : slope < 0 ? "decline" : "unreliable";
  return "unreliable";
}
