// Dynamic cards for the Edge Function: a port of backend/trendex_core/{selection,card}.py.
// Runtime-agnostic (Deno on Supabase, Node for tests). Parity with Python: test_parity.ts.
import { classify, trend1d } from "./stats.ts";

type Arr = Float32Array | Int32Array | Uint8Array | Int16Array | Float64Array | Uint16Array;
const CTORS: Record<string, any> = {
  float32: Float32Array, int32: Int32Array, uint8: Uint8Array, int16: Int16Array, float64: Float64Array, uint16: Uint16Array,
};
export const COMPONENTS = ["green", "stability", "season", "terrain"] as const;
const LEVEL_RANK: Record<string, number> = { suitable: 2, limited: 1, low: 0 };
const EXCL = ["water", "snow_ice", "urban", "cropland", "forest", "steep"];
const RAW: Record<string, [string, string]> = {
  green: ["green", "NDVI"], stability: ["cv", "CV"], season: ["season_len", "months"], terrain: ["slope_mean", "deg"],
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

export class Data {
  n: number; years: number[]; Y: number; h: any; f: Record<string, Arr> = {}; S: Float32Array | Int16Array;
  cfg: any; texts: any; matrix: any; blocks: any[]; meta: any;
  status: string[]; district: (string | null)[]; level: (string | null)[]; trend: (string | null)[];
  constructor(header: any, buf: ArrayBuffer) {
    this.h = header;
    this.n = header.n;
    this.years = [];
    for (let y = header.years[0]; y <= header.years[1]; y++) this.years.push(y);
    this.Y = this.years.length;
    for (const fd of header.fields) this.f[fd.name] = new CTORS[fd.dtype](buf, fd.offset, fd.length);
    this.S = this.f["S"] as Float32Array | Int16Array;
    this.cfg = header.cfg; this.texts = header.texts; this.matrix = header.matrix; this.blocks = header.blocks;
    this.meta = header.meta;
    this.status = header.codes.status; this.district = header.codes.district;
    this.level = header.codes.level; this.trend = header.codes.trend;
  }
  s(i: number, y: number): number {
    const v = this.S[i * this.Y + y];
    if (this.S instanceof Float32Array) return v;
    return v === this.h.S_nan ? NaN : v / this.h.S_scale;
  }
  isPasture(i: number) { return this.f.status[i] === 0; }
  districtOf(i: number): string | null { return this.district[this.f.district[i]]; }
}

// ---------- formatting (Python str.format subset) ----------
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
export function fmt(tpl: string, v: Record<string, any>): string {
  return tpl.replace(/\{(\w+)(?::([+]?)(?:\.(\d+))?f)?\}/g, (_m, k, sign, dec) => {
    const val = v[k];
    if (typeof val !== "number" || dec === undefined) return String(val);
    let s = val.toFixed(Number(dec));
    if (sign === "+" && val >= 0 && !s.startsWith("-")) s = "+" + s;
    if (s === "-0" || /^-0\.0*$/.test(s)) s = s.slice(1);
    return s;
  });
}

function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

// ---------- selection ----------
export interface Sel { type: string; id: string | null; name: string; idx: Int32Array; params: any }

export function districtName(d: Data, slug: string, lang: string): string {
  const names = d.cfg.district_names[slug] ?? {};
  const base = names[lang] ?? names.en ?? slug;
  return lang === "ru" ? `${base} район` : `${base} district`;
}

export function blockName(d: Data, bid: number, lang: string): string {
  const t = d.texts[lang].alternatives;
  const cnt = new Map<string, number>();
  const B = d.f.block_id;
  for (let i = 0; i < d.n; i++) if (B[i] === bid) { const ds = d.districtOf(i); if (ds) cnt.set(ds, (cnt.get(ds) ?? 0) + 1); }
  if (!cnt.size) return fmt(t.name_buffer, { id: bid });
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return fmt(t.name, { id: bid, district: districtName(d, best, lang) });
}

function collect(d: Data, pred: (i: number) => boolean): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < d.n; i++) if (pred(i)) out.push(i);
  return Int32Array.from(out);
}

export function parseSel(d: Data, sel: string, lang: string): Sel {
  if (!sel || !sel.includes(":")) throw new HttpError(422, "sel must look like district:<slug>, block:<id> or point:<lat>,<lon>[,<radius_km>]");
  const [kindRaw, val] = [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)];
  const kind = kindRaw.trim().toLowerCase();
  if (kind === "district") {
    const slug = val.trim().toLowerCase();
    const code = d.district.indexOf(slug);
    if (code <= 0) throw new HttpError(404, `unknown district '${slug}'`);
    return { type: "district", id: slug, name: districtName(d, slug, lang), idx: collect(d, (i) => d.f.district[i] === code), params: {} };
  }
  if (kind === "block") {
    const bid = Number(val);
    if (!Number.isInteger(bid)) throw new HttpError(422, "block id must be an integer");
    const idx = collect(d, (i) => d.f.block_id[i] === bid);
    if (!idx.length) throw new HttpError(404, `unknown block ${bid}`);
    return { type: "block", id: String(bid), name: blockName(d, bid, lang), idx, params: {} };
  }
  if (kind === "point") {
    const p = val.split(",").map(Number);
    if (p.length < 2 || p.some((x) => !Number.isFinite(x))) throw new HttpError(422, "point must be point:<lat>,<lon>[,<radius_km>]");
    return pointSel(d, p[0], p[1], p[2] ?? 5, lang);
  }
  throw new HttpError(422, `unknown selection type '${kind}'`);
}

export function pointSel(d: Data, lat: number, lon: number, r = 5, lang = "en"): Sel {
  if (!(r > 0 && r <= 50)) throw new HttpError(422, "radius must be in (0, 50] km");
  const la = d.f.lat, lo = d.f.lon;
  const out: number[] = [];
  let best = -1, bestD = Infinity;
  for (let i = 0; i < d.n; i++) {
    const dist = hav(la[i], lo[i], lat, lon);
    if (dist <= r) out.push(i);
    if (dist < bestD) { bestD = dist; best = i; }
  }
  if (!out.length && bestD <= 1) out.push(best);
  const name = lang === "ru" ? `Точка ${lat.toFixed(3)}, ${lon.toFixed(3)} (радиус ${r} км)` : `Point ${lat.toFixed(3)}, ${lon.toFixed(3)} (radius ${r} km)`;
  return { type: "point", id: `${lat.toFixed(5)},${lon.toFixed(5)},${r}`, name, idx: Int32Array.from(out), params: { lat, lon, radius_km: r } };
}

function ringContains(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringAreaKm2(ring: number[][]): number {
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.574;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  return Math.abs(a) / 2;
}

export function polygonSel(d: Data, geom: any, lang = "en"): Sel {
  if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) throw new HttpError(422, "geometry must be a Polygon or MultiPolygon in EPSG:4326");
  const polys: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let km2 = 0;
  for (const p of polys) { km2 += ringAreaKm2(p[0]); for (const h of p.slice(1)) km2 -= ringAreaKm2(h); }
  if (km2 > 5000) throw new HttpError(422, `polygon is ${km2.toFixed(0)} km²; max 5000 km²`);
  const la = d.f.lat, lo = d.f.lon;
  const idx = collect(d, (i) => polys.some((p) => ringContains(p[0], lo[i], la[i]) && !p.slice(1).some((h) => ringContains(h, lo[i], la[i]))));
  return { type: "polygon", id: null, name: lang === "ru" ? "Нарисованный участок" : "Drawn area", idx, params: { area_km2: km2 } };
}

export function filterSel(d: Data, f: any, lang = "en", name?: string): Sel {
  const code = f.district ? d.district.indexOf(f.district) : -1;
  const hasPt = f.lat != null && f.lon != null;
  const r = Math.min(Number(f.radius_km ?? 10), 50);
  const idx = collect(d, (i) => {
    if (f.district && d.f.district[i] !== code) return false;
    if (hasPt && hav(d.f.lat[i], d.f.lon[i], f.lat, f.lon) > r) return false;
    if (f.elev_min != null && d.f.elev_mean[i] < f.elev_min) return false;
    if (f.elev_max != null && d.f.elev_mean[i] > f.elev_max) return false;
    if (!f.district && !hasPt && d.f.district[i] === 0) return false;
    return true;
  });
  return { type: "filter", id: null, name: name ?? (lang === "ru" ? "Фильтр" : "Filter"), idx, params: { ...f } };
}

// ---------- card ----------
function nanmean(vals: number[]): number {
  let s = 0, c = 0;
  for (const v of vals) if (Number.isFinite(v)) { s += v; c++; }
  return c ? s / c : NaN;
}

export function scoreWithWeights(d: Data, i: number, w: Record<string, number>): number {
  let num = 0, den = 0;
  for (const k of COMPONENTS) {
    const wk = w[k] ?? 0;
    const p = d.f[`pct_${k}`][i];
    if (wk > 0 && Number.isFinite(p)) { num += wk * p; den += wk; }
  }
  return den ? (100 * num) / den : NaN;
}

export function classOfScore(s: number, thr: any): string | null {
  if (!Number.isFinite(s)) return null;
  return s >= thr.suitable ? "suitable" : s >= thr.limited ? "limited" : "low";
}

export function areaSeries(d: Data, cells: number[]): { vals: number[]; nValid: number[] } {
  const vals: number[] = [], nValid: number[] = [];
  for (let y = 0; y < d.Y; y++) {
    let s = 0, c = 0;
    for (const i of cells) { const v = d.s(i, y); if (Number.isFinite(v)) { s += v; c++; } }
    nValid.push(c);
    vals.push(c >= Math.max(1, 0.5 * cells.length) && c > 0 ? s / c : NaN);
  }
  return { vals, nValid };
}

function seriesTrend(d: Data, vals: number[]) {
  const r: any = trend1d(vals, d.years, d.cfg.trend.method);
  r.class = classify(r.slope, r.p, r.n, d.cfg.trend.alpha, d.cfg.min_valid_years);
  r.mean = nanmean(vals);
  r.pct_per_decade = Number.isFinite(r.slope) ? (r.slope * 10) / r.mean * 100 : NaN;
  return r;
}

function shares(vals: (string | null)[], keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = vals.length ? vals.filter((v) => v === k).length / vals.length : 0;
  return out;
}

export type ExtraHook = (d: Data, sel: Sel, ctx: any) => [string, any] | null;
export const EXTRA_HOOKS: ExtraHook[] = [];

export function buildCard(d: Data, sel: Sel, lang = "en", weights: Record<string, number> | null = null, season = "summer"): any {
  const cfg = d.cfg, t = d.texts[lang] ?? d.texts.en;
  const selOut: any = { type: sel.type, id: sel.id, sel: sel.id != null ? `${sel.type}:${sel.id}` : sel.type, name: sel.name, centroid: null, districts: [], params: sel.params };
  const card: any = {
    selection: selOut, status: "ok", area: null, level: null, dynamics: null, reasons: { pro: [], con: [] }, confidence: null,
    season: null, alternatives: null, action: null, not_considered: [...t.not_considered], extras: {},
    meta: { lang, data_mode: d.meta.data_mode, data_version: d.meta.data_version, config_hash: d.meta.config_hash,
            weights: weights ?? cfg.weights, season, computed_at: d.meta.computed_at, generated_at: new Date().toISOString().slice(0, 19) + "+00:00" },
  };
  const m = Array.from(sel.idx);
  if (!m.length) { card.status = "outside_aoi"; return card; }
  const F = d.f;
  selOut.centroid = { lat: nanmean(m.map((i) => F.lat[i])), lon: nanmean(m.map((i) => F.lon[i])) };
  selOut.districts = [...new Set(m.map((i) => d.districtOf(i)).filter((x) => x))].sort();
  let total = 0, insufficient = 0;
  const excl: Record<string, number> = Object.fromEntries(EXCL.map((k) => [k, 0]));
  const p: number[] = [];
  for (const i of m) {
    const a = F.area_km2[i];
    total += a;
    const st = d.status[F.status[i]];
    if (st === "pasture") p.push(i);
    else if (st === "insufficient") insufficient += a;
    else if (st in excl) excl[st] += a;
  }
  const pastureKm2 = p.reduce((a, i) => a + F.area_km2[i], 0);
  card.area = { total_km2: total, pasture_km2: pastureKm2, excluded_km2: excl, insufficient_km2: insufficient, n_cells: m.length };
  const exclSum = Object.values(excl).reduce((a, b) => a + b, 0);
  if (!p.length) {
    card.status = insufficient >= exclSum ? "insufficient" : "excluded";
    card.action = { key: card.status, text: t.actions[card.status], note: t.action_note, cell: null };
    runHooks(d, sel, card, { lang, idx: m, pasture: p, season });
    return card;
  }

  // block 1
  const scores = p.map((i) => weights ? scoreWithWeights(d, i, weights) : F.score[i]);
  const classes = weights ? scores.map((s) => classOfScore(s, cfg.level_thresholds)) : p.map((i) => d.level[F.level[i]]);
  const score = nanmean(scores);
  const lvl = classOfScore(score, cfg.level_thresholds)!;
  const compPct: Record<string, number> = {};
  const comps = COMPONENTS.map((k) => {
    const pv = nanmean(p.map((i) => F[`pct_${k}`][i]));
    compPct[k] = pv;
    const [rc, unit] = RAW[k];
    const rv = nanmean(p.map((i) => F[rc][i]));
    return { key: k, label: t.labels.component[k], percentile: Number.isFinite(pv) ? Math.round(1000 * pv) / 10 : null,
             raw: Number.isFinite(rv) ? rv : null, unit };
  });
  card.level = { class: lvl, label: t.labels.level[lvl], score: Math.round(score * 10) / 10,
                 class_shares: shares(classes, ["suitable", "limited", "low"]), components: comps, relative_note: t.relative_note };

  // block 2
  const { vals, nValid } = areaSeries(d, p);
  const tr = seriesTrend(d, vals);
  const dyn: string = tr.class;
  const cellCls = m.filter((i) => F.status[i] <= 1).map((i) => d.trend[F.trend[i]]);
  card.dynamics = {
    class: dyn, label: t.labels.dynamics[dyn], period: [d.years[0], d.years[d.Y - 1]],
    slope_per_decade: Number.isFinite(tr.slope) ? tr.slope * 10 : null,
    ci95: Number.isFinite(tr.ci_lo) ? [tr.ci_lo * 10, tr.ci_hi * 10] : null,
    pct_per_decade: tr.pct_per_decade, p_value: tr.p, method: `Sen slope + Mann-Kendall (${tr.method})`, n_years: tr.n, mean: tr.mean,
    series: d.years.map((y, k) => ({ year: y, value: Number.isFinite(vals[k]) ? vals[k] : null, n_valid_cells: nValid[k] })),
    fit: { intercept: tr.intercept, slope: tr.slope },
    cell_shares: shares(cellCls, ["growth", "decline", "unreliable", "insufficient"]),
  };

  // block 3
  const pro: any[] = [], con: any[] = [];
  const ranked = Object.entries(compPct).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  const slopeDeg = nanmean(p.map((i) => F.slope_mean[i]));
  const fv = (v: number) => ({ p: pyRound(100 * v), q: pyRound(100 * (1 - v)), slope: (Math.round(slopeDeg * 10) / 10).toFixed(1) });
  for (const [k, v] of ranked) if (v >= 0.6 && pro.length < 2) pro.push({ key: `${k}_pro`, text: fmt(t.reasons[`${k}_pro`], fv(v)) });
  for (const [k, v] of [...ranked].reverse()) if (v <= 0.4 && con.length < 2) con.push({ key: `${k}_con`, text: fmt(t.reasons[`${k}_con`], fv(v)) });
  if (dyn === "growth" || dyn === "decline") {
    const key = dyn === "growth" ? "trend_pro" : "trend_con";
    const item = { key, text: fmt(t.reasons[key], { y0: d.years[0], pct: tr.pct_per_decade, lo: tr.ci_lo * 10, hi: tr.ci_hi * 10 }) };
    (dyn === "growth" ? pro : con).unshift(item);
  }
  const exclShare = total ? exclSum / total : 0;
  if (exclShare > 0.3) con.push({ key: "excluded_con", text: fmt(t.reasons.excluded_con, { share: pyRound(100 * exclShare) }) });
  card.reasons = { pro: pro.slice(0, 3), con: con.slice(0, 3) };

  // block 4
  const cc = cfg.confidence;
  const factors: any[] = [];
  if (pastureKm2 < cc.min_pasture_km2) factors.push({ key: "small_area", text: fmt(t.confidence.small_area, { km2: (Math.round(pastureKm2 * 10) / 10).toFixed(1) }) });
  if (exclShare > cc.max_excluded_share) factors.push({ key: "excluded_share", text: t.confidence.excluded_share });
  const vf = nanmean(p.map((i) => F.valid_frac[i]));
  if (vf < cc.min_valid_frac) factors.push({ key: "valid_frac", text: fmt(t.confidence.valid_frac, { pct: pyRound(100 * vf) }) });
  const flipAny = p.filter((i) => F.flip_share[i] > 0).length / p.length;
  if (flipAny > cc.max_flip_share) factors.push({ key: "flip_share", text: fmt(t.confidence.flip_share, { pct: pyRound(100 * flipAny) }) });
  const conf = !factors.length ? "high" : factors.length === 1 ? "medium" : "low";
  card.confidence = { level: conf, label: t.labels.confidence[conf], factors: factors.length ? factors : [{ key: "none", text: t.confidence.none }] };

  // block 5
  const last = vals[d.Y - 1];
  const hist = vals.slice(0, -1).filter(Number.isFinite);
  if (Number.isFinite(last) && hist.length >= 5) {
    const pct = (100 * (hist.filter((h) => h < last).length + 0.5 * hist.filter((h) => h === last).length)) / hist.length;
    const [t0, t1] = cfg.season_terciles;
    const sc = pct < t0 ? "below" : pct > t1 ? "above" : "within";
    const label = t.labels.season[sc];
    const b0 = d.years[0], b1 = d.years[d.Y - 2];
    card.season = { year: d.years[d.Y - 1], value: last, percentile: pct, class: sc, label, baseline: [b0, b1], vs_expected: null,
                    text: fmt(t.season.text, { year: d.years[d.Y - 1], label_lc: label.toLowerCase(), p: pyRound(pct), b0, b1 }) };
  }

  // block 6
  card.alternatives = alternatives(d, sel, m, score, lvl, pastureKm2, selOut.centroid, lang);

  // block 7
  const dynKey = ["growth", "decline", "unreliable"].includes(dyn) ? dyn : "insufficient";
  const akey = d.matrix[lvl][dynKey];
  card.action = { key: akey, text: t.actions[akey], note: t.action_note, cell: { level: lvl, dynamics: dyn } };
  runHooks(d, sel, card, { lang, idx: m, pasture: p, series: vals, season });
  return card;
}

function runHooks(d: Data, sel: Sel, card: any, ctx: any) {
  for (const h of EXTRA_HOOKS) {
    try { const r = h(d, sel, { ...ctx, card }); if (r) card.extras[r[0]] = r[1]; } catch (_e) { /* extras are optional */ }
  }
  const sve = card.extras.season_vs_expected;  // ML (F9) fills block 5's vs_expected
  delete card.extras.season_vs_expected;
  if (sve && card.season) card.season.vs_expected = sve;
}

function alternatives(d: Data, sel: Sel, m: number[], score: number, lvl: string, pastureKm2: number, c: any, lang: string) {
  const cfg = d.cfg.alternatives, t = d.texts[lang].alternatives, lt = d.texts[lang].labels;
  const R = cfg.radius_km;
  const out: any = { radius_km: R, items: [], note: null };
  if (lvl === "suitable") { out.note = t.not_needed; return out; }
  const B = d.blocks;
  if (!B.length) { out.note = fmt(t.none, { r: R }); return out; }
  const pa = B.map((b) => b.pasture_km2).sort((x, y) => x - y);
  const p75 = quantile(pa, 0.75);
  const minArea = Math.min(pastureKm2, p75);
  const own = sel.type === "block" ? new Set(m.map((i) => d.f.block_id[i])) : new Set<number>();
  const cand = B.map((b) => ({ ...b, distance_km: hav(b.lat, b.lon, c.lat, c.lon) })).filter((b) =>
    (b.distance_km <= R || (sel.type === "district" && b.district === sel.id)) && b.in_region && b.score != null && b.score > score &&
    (LEVEL_RANK[b.level_class] ?? -1) > LEVEL_RANK[lvl] && b.pasture_km2 >= minArea && b.dyn_class !== "decline" && !own.has(b.block_id),
  ).sort((a, b) => b.score - a.score || a.distance_km - b.distance_km).slice(0, cfg.max_n);
  for (const b of cand) {
    const reasons = [fmt(t.score, { d: b.score - score })];
    if (b.pct_green != null) reasons.push(fmt(t.green, { p: pyRound(100 * b.pct_green) }));
    reasons.push(t.not_declining);
    out.items.push({ sel: `block:${b.block_id}`, name: blockName(d, b.block_id, lang), distance_km: Math.round(b.distance_km * 10) / 10,
                     score: Math.round(b.score * 10) / 10, level_class: b.level_class, level_label: lt.level[b.level_class],
                     dynamics_class: b.dyn_class, dynamics_label: lt.dynamics[b.dyn_class], centroid: { lat: b.lat, lon: b.lon },
                     pasture_km2: Math.round(b.pasture_km2 * 10) / 10, reasons });
  }
  if (!out.items.length) out.note = fmt(t.none, { r: R });
  return out;
}

function quantile(sorted: number[], q: number): number {  // numpy 'linear' percentile
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- weights recompute (F18) ----------
export function recompute(d: Data, w: Record<string, number>) {
  const thr = d.cfg.level_thresholds;
  const area: Record<string, number> = { suitable: 0, limited: 0, low: 0 };
  let tot = 0, changed = 0;
  const blk = new Map<number, [number, number]>();
  const dist: Record<string, { s: number; c: number; a: number; ch: number }> = {};
  for (let i = 0; i < d.n; i++) {
    if (!d.isPasture(i)) continue;
    const s = scoreWithWeights(d, i, w);
    const b = d.f.block_id[i];
    const e = blk.get(b) ?? [0, 0];
    if (Number.isFinite(s)) { e[0] += s; e[1] += 1; }
    blk.set(b, e);
    if (d.f.district[i] === 0) continue;
    const cls = classOfScore(s, thr);
    const a = d.f.area_km2[i];
    tot += a;
    if (cls) area[cls] += a;
    const ch = cls !== d.level[d.f.level[i]] ? a : 0;
    changed += ch;
    const ds = d.districtOf(i)!;
    dist[ds] ??= { s: 0, c: 0, a: 0, ch: 0 };
    if (Number.isFinite(s)) { dist[ds].s += s; dist[ds].c += 1; }
    dist[ds].a += a; dist[ds].ch += ch;
  }
  const blocks: Record<string, any> = {};
  for (const [b, [s, c]] of blk) if (c) blocks[b] = { score: Math.round((s / c) * 10) / 10, level_class: classOfScore(s / c, thr) };
  const districts: Record<string, any> = {};
  for (const [k, v] of Object.entries(dist)) districts[k] = { score: v.s / v.c, class: classOfScore(v.s / v.c, thr), changed_share: v.ch / v.a };
  return { weights: w, level_shares: Object.fromEntries(Object.entries(area).map(([k, v]) => [k, v / (tot || 1)])),
           changed_share_vs_default: changed / (tot || 1), districts, blocks, data_mode: d.meta.data_mode };
}

export function nearest(d: Data, lat: number, lon: number): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < d.n; i++) { const x = hav(d.f.lat[i], d.f.lon[i], lat, lon); if (x < bd) { bd = x; best = i; } }
  return bd <= 1.0 ? best : -1;
}
