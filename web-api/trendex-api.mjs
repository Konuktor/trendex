var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// stats.ts
var Z975 = 1.959963984540054;
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
function normCdf(x) {
  return 0.5 * erfc(-x / Math.SQRT2);
}
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mkScore(x) {
  let s = 0;
  for (let i = 0; i < x.length - 1; i++) for (let j = i + 1; j < x.length; j++) s += Math.sign(x[j] - x[i]);
  return s;
}
function varianceS(x) {
  const n = x.length;
  const counts = /* @__PURE__ */ new Map();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size === n) return n * (n - 1) * (2 * n + 5) / 18;
  let tie = 0;
  for (const tp of counts.values()) tie += tp * (tp - 1) * (2 * tp + 5);
  return (n * (n - 1) * (2 * n + 5) - tie) / 18;
}
function zScore(s, v) {
  return s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
}
function rankdata(a) {
  const idx = a.map((v, i2) => [v, i2]).sort((p, q) => p[0] - q[0]);
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
function mkOriginal(x) {
  const s = mkScore(x);
  const z = zScore(s, varianceS(x));
  return { p: 2 * (1 - normCdf(Math.abs(z))), z, s };
}
function mkHamedRao(x) {
  const n = x.length;
  const s = mkScore(x);
  let v = varianceS(x);
  const sl = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sl.push((x[j] - x[i]) / (j - i));
  const med = median(sl);
  const xd = x.map((v2, i) => v2 - (i + 1) * med);
  const I = rankdata(xd);
  const mean = I.reduce((a, b) => a + b, 0) / n;
  const y = I.map((q) => q - mean);
  const acov = [];
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
  v = v * (1 + 2 / (n * (n - 1) * (n - 2)) * sni);
  const z = zScore(s, v);
  return { p: 2 * (1 - normCdf(Math.abs(z))), z, s };
}
function trend1d(yIn, years, method = "hamed_rao", minN = 8) {
  const y = [];
  const t = [];
  for (let i = 0; i < yIn.length; i++) if (Number.isFinite(yIn[i])) {
    y.push(yIn[i]);
    t.push(years[i]);
  }
  const n = y.length;
  const out = { slope: NaN, intercept: NaN, ci_lo: NaN, ci_hi: NaN, p: NaN, z: NaN, n, method };
  if (n < minN) return out;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(y.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (sd === 0) return { ...out, slope: 0, intercept: median(y), ci_lo: 0, ci_hi: 0, p: 1, z: 0 };
  const sl = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) sl.push((y[j] - y[i]) / (t[j] - t[i]));
  sl.sort((a, b) => a - b);
  const m = sl.length;
  const slope = median(sl);
  const c = Z975 * Math.sqrt(n * (n - 1) * (2 * n + 5) / 18);
  const lo = Math.min(Math.max(Math.floor((m - c) / 2), 0), m - 1);
  const hi = Math.min(Math.max(Math.ceil((m + c) / 2), 0), m - 1);
  let r = method === "hamed_rao" ? mkHamedRao(y) : mkOriginal(y);
  if (!Number.isFinite(r.p)) r = mkOriginal(y);
  const intercept = median(y.map((v, i) => v - slope * t[i]));
  return { slope, intercept, ci_lo: sl[lo], ci_hi: sl[hi], p: r.p, z: r.z, n, method };
}
function classify(slope, p, n, alpha = 0.05, minYears = 18) {
  if (n < minYears || !Number.isFinite(slope)) return "insufficient";
  if (Number.isFinite(p) && p < alpha) return slope > 0 ? "growth" : slope < 0 ? "decline" : "unreliable";
  return "unreliable";
}

// core.ts
var CTORS = {
  float32: Float32Array,
  int32: Int32Array,
  uint8: Uint8Array,
  int16: Int16Array,
  float64: Float64Array,
  uint16: Uint16Array
};
var COMPONENTS = ["green", "stability", "season", "terrain"];
var LEVEL_RANK = { suitable: 2, limited: 1, low: 0 };
var EXCL = ["water", "snow_ice", "urban", "cropland", "forest", "steep"];
var RAW = {
  green: ["green", "NDVI"],
  stability: ["cv", "CV"],
  season: ["season_len", "months"],
  terrain: ["slope_mean", "deg"]
};
var HttpError = class extends Error {
  constructor(status, msg) {
    super(msg);
    __publicField(this, "status");
    this.status = status;
  }
};
var Data = class {
  constructor(header, buf) {
    __publicField(this, "n");
    __publicField(this, "years");
    __publicField(this, "Y");
    __publicField(this, "h");
    __publicField(this, "f", {});
    __publicField(this, "S");
    __publicField(this, "cfg");
    __publicField(this, "texts");
    __publicField(this, "matrix");
    __publicField(this, "blocks");
    __publicField(this, "meta");
    __publicField(this, "status");
    __publicField(this, "district");
    __publicField(this, "level");
    __publicField(this, "trend");
    this.h = header;
    this.n = header.n;
    this.years = [];
    for (let y = header.years[0]; y <= header.years[1]; y++) this.years.push(y);
    this.Y = this.years.length;
    for (const fd of header.fields) this.f[fd.name] = new CTORS[fd.dtype](buf, fd.offset, fd.length);
    this.S = this.f["S"];
    this.cfg = header.cfg;
    this.texts = header.texts;
    this.matrix = header.matrix;
    this.blocks = header.blocks;
    this.meta = header.meta;
    this.status = header.codes.status;
    this.district = header.codes.district;
    this.level = header.codes.level;
    this.trend = header.codes.trend;
  }
  s(i, y) {
    const v = this.S[i * this.Y + y];
    if (this.S instanceof Float32Array) return v;
    return v === this.h.S_nan ? NaN : v / this.h.S_scale;
  }
  isPasture(i) {
    return this.f.status[i] === 0;
  }
  districtOf(i) {
    return this.district[this.f.district[i]];
  }
};
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
function fmt(tpl, v) {
  return tpl.replace(/\{(\w+)(?::([+]?)(?:\.(\d+))?f)?\}/g, (_m, k, sign, dec) => {
    const val = v[k];
    if (typeof val !== "number" || dec === void 0) return String(val);
    let s = val.toFixed(Number(dec));
    if (sign === "+" && val >= 0 && !s.startsWith("-")) s = "+" + s;
    if (s === "-0" || /^-0\.0*$/.test(s)) s = s.slice(1);
    return s;
  });
}
function hav(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}
function districtName(d, slug, lang) {
  const names = d.cfg.district_names[slug] ?? {};
  const base = names[lang] ?? names.en ?? slug;
  return lang === "ru" ? `${base} \u0440\u0430\u0439\u043E\u043D` : `${base} district`;
}
function blockName(d, bid, lang) {
  const t = d.texts[lang].alternatives;
  const cnt = /* @__PURE__ */ new Map();
  const B = d.f.block_id;
  for (let i = 0; i < d.n; i++) if (B[i] === bid) {
    const ds = d.districtOf(i);
    if (ds) cnt.set(ds, (cnt.get(ds) ?? 0) + 1);
  }
  if (!cnt.size) return fmt(t.name_buffer, { id: bid });
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return fmt(t.name, { id: bid, district: districtName(d, best, lang) });
}
function collect(d, pred) {
  const out = [];
  for (let i = 0; i < d.n; i++) if (pred(i)) out.push(i);
  return Int32Array.from(out);
}
function parseSel(d, sel, lang) {
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
function pointSel(d, lat, lon, r = 5, lang = "en") {
  if (!(r > 0 && r <= 50)) throw new HttpError(422, "radius must be in (0, 50] km");
  const la = d.f.lat, lo = d.f.lon;
  const out = [];
  let best = -1, bestD = Infinity;
  for (let i = 0; i < d.n; i++) {
    const dist = hav(la[i], lo[i], lat, lon);
    if (dist <= r) out.push(i);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  if (!out.length && bestD <= 1) out.push(best);
  const name = lang === "ru" ? `\u0422\u043E\u0447\u043A\u0430 ${lat.toFixed(3)}, ${lon.toFixed(3)} (\u0440\u0430\u0434\u0438\u0443\u0441 ${r} \u043A\u043C)` : `Point ${lat.toFixed(3)}, ${lon.toFixed(3)} (radius ${r} km)`;
  return { type: "point", id: `${lat.toFixed(5)},${lon.toFixed(5)},${r}`, name, idx: Int32Array.from(out), params: { lat, lon, radius_km: r } };
}
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringAreaKm2(ring) {
  const lat0 = ring.reduce((a2, p) => a2 + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos(lat0 * Math.PI / 180), ky = 110.574;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  return Math.abs(a) / 2;
}
function polygonSel(d, geom, lang = "en") {
  if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) throw new HttpError(422, "geometry must be a Polygon or MultiPolygon in EPSG:4326");
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let km2 = 0;
  for (const p of polys) {
    km2 += ringAreaKm2(p[0]);
    for (const h of p.slice(1)) km2 -= ringAreaKm2(h);
  }
  if (km2 > 5e3) throw new HttpError(422, `polygon is ${km2.toFixed(0)} km\xB2; max 5000 km\xB2`);
  const la = d.f.lat, lo = d.f.lon;
  const idx = collect(d, (i) => polys.some((p) => ringContains(p[0], lo[i], la[i]) && !p.slice(1).some((h) => ringContains(h, lo[i], la[i]))));
  return { type: "polygon", id: null, name: lang === "ru" ? "\u041D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0443\u0447\u0430\u0441\u0442\u043E\u043A" : "Drawn area", idx, params: { area_km2: km2 } };
}
function filterSel(d, f, lang = "en", name) {
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
  return { type: "filter", id: null, name: name ?? (lang === "ru" ? "\u0424\u0438\u043B\u044C\u0442\u0440" : "Filter"), idx, params: { ...f } };
}
function nanmean(vals) {
  let s = 0, c = 0;
  for (const v of vals) if (Number.isFinite(v)) {
    s += v;
    c++;
  }
  return c ? s / c : NaN;
}
function scoreWithWeights(d, i, w) {
  let num = 0, den = 0;
  for (const k of COMPONENTS) {
    const wk = w[k] ?? 0;
    const p = d.f[`pct_${k}`][i];
    if (wk > 0 && Number.isFinite(p)) {
      num += wk * p;
      den += wk;
    }
  }
  return den ? 100 * num / den : NaN;
}
function classOfScore(s, thr) {
  if (!Number.isFinite(s)) return null;
  return s >= thr.suitable ? "suitable" : s >= thr.limited ? "limited" : "low";
}
function areaSeries(d, cells) {
  const vals = [], nValid = [];
  for (let y = 0; y < d.Y; y++) {
    let s = 0, c = 0;
    for (const i of cells) {
      const v = d.s(i, y);
      if (Number.isFinite(v)) {
        s += v;
        c++;
      }
    }
    nValid.push(c);
    vals.push(c >= Math.max(1, 0.5 * cells.length) && c > 0 ? s / c : NaN);
  }
  return { vals, nValid };
}
function seriesTrend(d, vals) {
  const r = trend1d(vals, d.years, d.cfg.trend.method);
  r.class = classify(r.slope, r.p, r.n, d.cfg.trend.alpha, d.cfg.min_valid_years);
  r.mean = nanmean(vals);
  r.pct_per_decade = Number.isFinite(r.slope) ? r.slope * 10 / r.mean * 100 : NaN;
  return r;
}
function shares(vals, keys) {
  const out = {};
  for (const k of keys) out[k] = vals.length ? vals.filter((v) => v === k).length / vals.length : 0;
  return out;
}
var EXTRA_HOOKS = [];
function buildCard(d, sel, lang = "en", weights = null, season = "summer") {
  const cfg = d.cfg, t = d.texts[lang] ?? d.texts.en;
  const selOut = { type: sel.type, id: sel.id, sel: sel.id != null ? `${sel.type}:${sel.id}` : sel.type, name: sel.name, centroid: null, districts: [], params: sel.params };
  const card = {
    selection: selOut,
    status: "ok",
    area: null,
    level: null,
    dynamics: null,
    reasons: { pro: [], con: [] },
    confidence: null,
    season: null,
    alternatives: null,
    action: null,
    not_considered: [...t.not_considered],
    extras: {},
    meta: {
      lang,
      data_mode: d.meta.data_mode,
      data_version: d.meta.data_version,
      config_hash: d.meta.config_hash,
      weights: weights ?? cfg.weights,
      season,
      computed_at: d.meta.computed_at,
      generated_at: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "+00:00"
    }
  };
  const m = Array.from(sel.idx);
  if (!m.length) {
    card.status = "outside_aoi";
    return card;
  }
  const F = d.f;
  selOut.centroid = { lat: nanmean(m.map((i) => F.lat[i])), lon: nanmean(m.map((i) => F.lon[i])) };
  selOut.districts = [...new Set(m.map((i) => d.districtOf(i)).filter((x) => x))].sort();
  let total = 0, insufficient = 0;
  const excl = Object.fromEntries(EXCL.map((k) => [k, 0]));
  const p = [];
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
  const scores = p.map((i) => weights ? scoreWithWeights(d, i, weights) : F.score[i]);
  const classes = weights ? scores.map((s) => classOfScore(s, cfg.level_thresholds)) : p.map((i) => d.level[F.level[i]]);
  const score = nanmean(scores);
  const lvl = classOfScore(score, cfg.level_thresholds);
  const compPct = {};
  const comps = COMPONENTS.map((k) => {
    const pv = nanmean(p.map((i) => F[`pct_${k}`][i]));
    compPct[k] = pv;
    const [rc, unit] = RAW[k];
    const rv = nanmean(p.map((i) => F[rc][i]));
    return {
      key: k,
      label: t.labels.component[k],
      percentile: Number.isFinite(pv) ? Math.round(1e3 * pv) / 10 : null,
      raw: Number.isFinite(rv) ? rv : null,
      unit
    };
  });
  card.level = {
    class: lvl,
    label: t.labels.level[lvl],
    score: Math.round(score * 10) / 10,
    class_shares: shares(classes, ["suitable", "limited", "low"]),
    components: comps,
    relative_note: t.relative_note
  };
  const { vals, nValid } = areaSeries(d, p);
  const tr = seriesTrend(d, vals);
  const dyn = tr.class;
  const cellCls = m.filter((i) => F.status[i] <= 1).map((i) => d.trend[F.trend[i]]);
  card.dynamics = {
    class: dyn,
    label: t.labels.dynamics[dyn],
    period: [d.years[0], d.years[d.Y - 1]],
    slope_per_decade: Number.isFinite(tr.slope) ? tr.slope * 10 : null,
    ci95: Number.isFinite(tr.ci_lo) ? [tr.ci_lo * 10, tr.ci_hi * 10] : null,
    pct_per_decade: tr.pct_per_decade,
    p_value: tr.p,
    method: `Sen slope + Mann-Kendall (${tr.method})`,
    n_years: tr.n,
    mean: tr.mean,
    series: d.years.map((y, k) => ({ year: y, value: Number.isFinite(vals[k]) ? vals[k] : null, n_valid_cells: nValid[k] })),
    fit: { intercept: tr.intercept, slope: tr.slope },
    cell_shares: shares(cellCls, ["growth", "decline", "unreliable", "insufficient"])
  };
  const pro = [], con = [];
  const ranked = Object.entries(compPct).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  const slopeDeg = nanmean(p.map((i) => F.slope_mean[i]));
  const fv = (v) => ({ p: pyRound(100 * v), q: pyRound(100 * (1 - v)), slope: (Math.round(slopeDeg * 10) / 10).toFixed(1) });
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
  const cc = cfg.confidence;
  const factors = [];
  if (pastureKm2 < cc.min_pasture_km2) factors.push({ key: "small_area", text: fmt(t.confidence.small_area, { km2: (Math.round(pastureKm2 * 10) / 10).toFixed(1) }) });
  if (exclShare > cc.max_excluded_share) factors.push({ key: "excluded_share", text: t.confidence.excluded_share });
  const vf = nanmean(p.map((i) => F.valid_frac[i]));
  if (vf < cc.min_valid_frac) factors.push({ key: "valid_frac", text: fmt(t.confidence.valid_frac, { pct: pyRound(100 * vf) }) });
  const flipAny = p.filter((i) => F.flip_share[i] > 0).length / p.length;
  if (flipAny > cc.max_flip_share) factors.push({ key: "flip_share", text: fmt(t.confidence.flip_share, { pct: pyRound(100 * flipAny) }) });
  const conf = !factors.length ? "high" : factors.length === 1 ? "medium" : "low";
  card.confidence = { level: conf, label: t.labels.confidence[conf], factors: factors.length ? factors : [{ key: "none", text: t.confidence.none }] };
  const last = vals[d.Y - 1];
  const hist = vals.slice(0, -1).filter(Number.isFinite);
  if (Number.isFinite(last) && hist.length >= 5) {
    const pct = 100 * (hist.filter((h) => h < last).length + 0.5 * hist.filter((h) => h === last).length) / hist.length;
    const [t0, t1] = cfg.season_terciles;
    const sc = pct < t0 ? "below" : pct > t1 ? "above" : "within";
    const label = t.labels.season[sc];
    const b0 = d.years[0], b1 = d.years[d.Y - 2];
    card.season = {
      year: d.years[d.Y - 1],
      value: last,
      percentile: pct,
      class: sc,
      label,
      baseline: [b0, b1],
      vs_expected: null,
      text: fmt(t.season.text, { year: d.years[d.Y - 1], label_lc: label.toLowerCase(), p: pyRound(pct), b0, b1 })
    };
  }
  card.alternatives = alternatives(d, sel, m, score, lvl, pastureKm2, selOut.centroid, lang);
  const dynKey = ["growth", "decline", "unreliable"].includes(dyn) ? dyn : "insufficient";
  const akey = d.matrix[lvl][dynKey];
  card.action = { key: akey, text: t.actions[akey], note: t.action_note, cell: { level: lvl, dynamics: dyn } };
  runHooks(d, sel, card, { lang, idx: m, pasture: p, series: vals, season });
  return card;
}
function runHooks(d, sel, card, ctx) {
  for (const h of EXTRA_HOOKS) {
    try {
      const r = h(d, sel, { ...ctx, card });
      if (r) card.extras[r[0]] = r[1];
    } catch (_e) {
    }
  }
  const sve = card.extras.season_vs_expected;
  delete card.extras.season_vs_expected;
  if (sve && card.season) card.season.vs_expected = sve;
}
function alternatives(d, sel, m, score, lvl, pastureKm2, c, lang) {
  const cfg = d.cfg.alternatives, t = d.texts[lang].alternatives, lt = d.texts[lang].labels;
  const R = cfg.radius_km;
  const out = { radius_km: R, items: [], note: null };
  if (lvl === "suitable") {
    out.note = t.not_needed;
    return out;
  }
  const B = d.blocks;
  if (!B.length) {
    out.note = fmt(t.none, { r: R });
    return out;
  }
  const pa = B.map((b) => b.pasture_km2).sort((x, y) => x - y);
  const p75 = quantile(pa, 0.75);
  const minArea = Math.min(pastureKm2, p75);
  const own = sel.type === "block" ? new Set(m.map((i) => d.f.block_id[i])) : /* @__PURE__ */ new Set();
  const cand = B.map((b) => ({ ...b, distance_km: hav(b.lat, b.lon, c.lat, c.lon) })).filter(
    (b) => (b.distance_km <= R || sel.type === "district" && b.district === sel.id) && b.in_region && b.score != null && b.score > score && (LEVEL_RANK[b.level_class] ?? -1) > LEVEL_RANK[lvl] && b.pasture_km2 >= minArea && b.dyn_class !== "decline" && !own.has(b.block_id)
  ).sort((a, b) => b.score - a.score || a.distance_km - b.distance_km).slice(0, cfg.max_n);
  for (const b of cand) {
    const reasons = [fmt(t.score, { d: b.score - score })];
    if (b.pct_green != null) reasons.push(fmt(t.green, { p: pyRound(100 * b.pct_green) }));
    reasons.push(t.not_declining);
    out.items.push({
      sel: `block:${b.block_id}`,
      name: blockName(d, b.block_id, lang),
      distance_km: Math.round(b.distance_km * 10) / 10,
      score: Math.round(b.score * 10) / 10,
      level_class: b.level_class,
      level_label: lt.level[b.level_class],
      dynamics_class: b.dyn_class,
      dynamics_label: lt.dynamics[b.dyn_class],
      centroid: { lat: b.lat, lon: b.lon },
      pasture_km2: Math.round(b.pasture_km2 * 10) / 10,
      reasons
    });
  }
  if (!out.items.length) out.note = fmt(t.none, { r: R });
  return out;
}
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function recompute(d, w) {
  const thr = d.cfg.level_thresholds;
  const area = { suitable: 0, limited: 0, low: 0 };
  let tot = 0, changed = 0;
  const blk = /* @__PURE__ */ new Map();
  const dist = {};
  for (let i = 0; i < d.n; i++) {
    if (!d.isPasture(i)) continue;
    const s = scoreWithWeights(d, i, w);
    const b = d.f.block_id[i];
    const e = blk.get(b) ?? [0, 0];
    if (Number.isFinite(s)) {
      e[0] += s;
      e[1] += 1;
    }
    blk.set(b, e);
    if (d.f.district[i] === 0) continue;
    const cls = classOfScore(s, thr);
    const a = d.f.area_km2[i];
    tot += a;
    if (cls) area[cls] += a;
    const ch = cls !== d.level[d.f.level[i]] ? a : 0;
    changed += ch;
    const ds = d.districtOf(i);
    dist[ds] ?? (dist[ds] = { s: 0, c: 0, a: 0, ch: 0 });
    if (Number.isFinite(s)) {
      dist[ds].s += s;
      dist[ds].c += 1;
    }
    dist[ds].a += a;
    dist[ds].ch += ch;
  }
  const blocks = {};
  for (const [b, [s, c]] of blk) if (c) blocks[b] = { score: Math.round(s / c * 10) / 10, level_class: classOfScore(s / c, thr) };
  const districts = {};
  for (const [k, v] of Object.entries(dist)) districts[k] = { score: v.s / v.c, class: classOfScore(v.s / v.c, thr), changed_share: v.ch / v.a };
  return {
    weights: w,
    level_shares: Object.fromEntries(Object.entries(area).map(([k, v]) => [k, v / (tot || 1)])),
    changed_share_vs_default: changed / (tot || 1),
    districts,
    blocks,
    data_mode: d.meta.data_mode
  };
}
function nearest(d, lat, lon) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < d.n; i++) {
    const x = hav(d.f.lat[i], d.f.lon[i], lat, lon);
    if (x < bd) {
      bd = x;
      best = i;
    }
  }
  return bd <= 1 ? best : -1;
}

// access.ts
var FIELDS = [["dist_road_km", "road_km"], ["dist_water_km", "water_km"], ["dist_settlement_km", "settlement_km"]];
var NOTE = {
  en: "straight-line distance, \xA9 OpenStreetMap contributors",
  ru: "\u0440\u0430\u0441\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043F\u043E \u043F\u0440\u044F\u043C\u043E\u0439, \xA9 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 OpenStreetMap"
};
var registered = false;
function accessExtra(d, pasture, lang) {
  if (!d.f.dist_road_km || !pasture?.length) return null;
  const out = {};
  for (const [f, key] of FIELDS) {
    const a = d.f[f];
    if (!a) {
      out[key] = null;
      continue;
    }
    let s = 0, c = 0;
    for (const i of pasture) {
      const v = a[i];
      if (Number.isFinite(v)) {
        s += v;
        c++;
      }
    }
    out[key] = c ? Math.round(s / c * 10) / 10 : null;
  }
  out.note = NOTE[lang] ?? NOTE.en;
  return out;
}
function registerAccess(d) {
  if (registered || !d.f.dist_road_km) return;
  registered = true;
  EXTRA_HOOKS.push((dd, _sel, ctx) => {
    const v = accessExtra(dd, ctx.pasture, ctx.lang);
    return v ? ["access", v] : null;
  });
}

// query.ts
var L = "\\p{L}";
var NUM = "(\\d{1,3}(?:[ \\u00a0,]\\d{3})+|\\d+)";
var UNIT_M = `(?:\\s*(?:\u043C|m|\u043C\u0435\u0442\u0440${L}*|meter${L}*|metre${L}*))?(?![${L}\\d])`;
var DEFAULT_NAMES = {
  "at-bashy": { en: "At-Bashy", ru: "\u0410\u0442-\u0411\u0430\u0448\u0438\u043D\u0441\u043A\u0438\u0439" },
  naryn: { en: "Naryn", ru: "\u041D\u0430\u0440\u044B\u043D\u0441\u043A\u0438\u0439" },
  "ak-talaa": { en: "Ak-Talaa", ru: "\u0410\u043A-\u0422\u0430\u043B\u0438\u043D\u0441\u043A\u0438\u0439" },
  jumgal: { en: "Jumgal", ru: "\u0416\u0443\u043C\u0433\u0430\u043B\u044C\u0441\u043A\u0438\u0439" },
  kochkor: { en: "Kochkor", ru: "\u041A\u043E\u0447\u043A\u043E\u0440\u0441\u043A\u0438\u0439" }
};
var DISTRICTS = [
  ["at-bashy", [`\u0430\u0442[\\s-]?\u0431\u0430\u0448${L}*`, `at[\\s-]?bash${L}*`]],
  ["ak-talaa", [`\u0430\u043A[\\s-]?\u0442\u0430\u043B${L}*`, `ak[\\s-]?tal${L}*`]],
  ["jumgal", [`\u0436\u0443\u043C\u0433\u0430\u043B${L}*`, `(?:dj|dzh|zh|j)umgal${L}*`]],
  ["kochkor", [`\u043A\u043E\u0447\u043A\u043E\u0440${L}*`, `kochkor${L}*`]],
  ["naryn", [`\u043D\u0430\u0440\u044B\u043D\u0441\u043A(?:\u0438\u0439|\u043E\u0433\u043E|\u043E\u043C\u0443|\u0438\u043C|\u043E\u043C)(?![${L}])`, `\u043D\u0430\u0440\u044B\u043D\\s+\u0440\u0430\u0439\u043E\u043D${L}*`, `naryn\\s+(?:district|rayon|raion)`]]
];
var OBLAST = [
  `\u043D\u0430\u0440\u044B\u043D\u0441\u043A(?:\u0430\u044F|\u043E\u0439|\u0443\u044E|\u043E\u044E)\\s+\u043E\u0431\u043B\u0430\u0441${L}*`,
  `\u043D\u0430\u0440\u044B\u043D\\s+\u043E\u0431\u043B\u0443\u0441${L}*`,
  `naryn\\s+(?:region|oblast|province)`,
  `(?:\u0432\u0441\u044F|\u0432\u0441\u0435\u0439|\u0432\u0441\u044E)\\s+\u043E\u0431\u043B\u0430\u0441${L}*`,
  `(?:whole|entire|all(?:\\s+of)?(?:\\s+the)?)\\s+(?:region|oblast)`
];
var LAKES = [
  {
    key: "son-kul",
    name: { en: "Son-Kul lake", ru: "\u043E\u0437\u0435\u0440\u043E \u0421\u043E\u043D-\u041A\u0443\u043B\u044C" },
    lat: 41.83,
    lon: 75.13,
    radius_km: 20,
    aliases: ["\u0441\u043E\u043D-\u043A\u0443\u043B\u044C", "\u0441\u043E\u043D-\u043A\u0443\u043B", "\u0441\u043E\u043D-\u043A\u043E\u043B\u044C", "\u0441\u043E\u043D-\u043A\u043E\u043B", "\u0441\u043E\u043D-\u043A\u0435\u043B\u044C", "son-kul", "son-kol", "song-kol", "song-kul", "song-kul"]
  },
  {
    key: "chatyr-kul",
    name: { en: "Chatyr-Kul lake", ru: "\u043E\u0437\u0435\u0440\u043E \u0427\u0430\u0442\u044B\u0440-\u041A\u0443\u043B\u044C" },
    lat: 40.61,
    lon: 75.3,
    radius_km: 15,
    aliases: ["\u0447\u0430\u0442\u044B\u0440-\u043A\u0443\u043B\u044C", "\u0447\u0430\u0442\u044B\u0440-\u043A\u0443\u043B", "\u0447\u0430\u0442\u044B\u0440-\u043A\u043E\u043B\u044C", "\u0447\u0430\u0442\u044B\u0440-\u043A\u043E\u043B", "chatyr-kul", "chatyr-kol", "chatir-kul", "chatyr-kel"]
  }
];
var NARYN_TOWN = { name: { en: "Naryn (town)", ru: "\u0433. \u041D\u0430\u0440\u044B\u043D" }, lat: 41.43, lon: 75.99 };
var PREP = `(?:\u043E\u043A\u043E\u043B\u043E|\u0432\u043E\u0437\u043B\u0435|\u0440\u044F\u0434\u043E\u043C\\s+\u0441|\u0431\u043B\u0438\u0437|\u043D\u0435\u0434\u0430\u043B\u0435\u043A\u043E\\s+\u043E\u0442|\u0432\u043E\u043A\u0440\u0443\u0433|near|around|close\\s+to|next\\s+to|in\\s+the\\s+village\\s+of|village|\u0441\u0435\u043B\u043E|\u0441\u0435\u043B\u0435|\u0441\u0435\u043B\u0430)`;
var STOP_AFTER_PREP = /^(дорог|вод|рек|озер|насел|сел|посел|город|деревн|road|water|river|lake|settle|villag|town|меня|нас|me|us|the|a|an|них|него|них)/u;
var STOP_CAPS = /* @__PURE__ */ new Set([
  "ndvi",
  "modis",
  "nasa",
  "trendex",
  "osm",
  "imerg",
  "openstreetmap",
  "kyrgyzstan",
  "kyrgyz",
  "\u043A\u044B\u0440\u0433\u044B\u0437\u0441\u0442\u0430\u043D",
  "\u043A\u044B\u0440\u0433\u044B\u0437\u0441\u0442\u0430\u043D\u0430",
  "\u043A\u0438\u0440\u0433\u0438\u0437\u0438\u044F",
  "\u043A\u0438\u0440\u0433\u0438\u0437\u0438\u0438",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "what",
  "where",
  "which",
  "how",
  "show",
  "find",
  "please",
  "\u043F\u043E\u043A\u0430\u0436\u0438",
  "\u043F\u043E\u043A\u0430\u0436\u0438\u0442\u0435",
  "\u043D\u0430\u0439\u0434\u0438",
  "\u043D\u0430\u0439\u0434\u0438\u0442\u0435",
  "\u0433\u0434\u0435",
  "\u043A\u0430\u043A\u0438\u0435",
  "\u043A\u0430\u043A\u043E\u0439",
  "\u043A\u0430\u043A",
  "\u0447\u0442\u043E"
]);
function norm(s) {
  let o = "";
  for (const ch of s) {
    const c = ch.toLowerCase();
    o += c.length === 1 ? c.replace("\u0451", "\u0435").replace(/[өӧ]/, "\u043E").replace(/[үӱ]/, "\u0443").replace("\u04A3", "\u043D").replace(/[‐-―−]/, "-") : ch;
  }
  return o;
}
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function aliasSrc(alias, stem = true) {
  return norm(alias).split(/[\s-]+/).filter(Boolean).map(esc).join("[\\s-]?") + (stem ? `${L}{0,4}` : "") + `(?![${L}])`;
}
var bounded = (src) => new RegExp(`(?<![${L}\\d])(?:${src})`, "u");
var Text = class {
  constructor(t) {
    __publicField(this, "low");
    __publicField(this, "orig");
    this.orig = t;
    this.low = norm(t);
  }
  take(re) {
    const m = re.exec(this.low);
    if (m) {
      const blank = " ".repeat(m[0].length);
      this.low = this.low.slice(0, m.index) + blank + this.low.slice(m.index + m[0].length);
      this.orig = this.orig.slice(0, m.index) + blank + this.orig.slice(m.index + m[0].length);
    }
    return m;
  }
};
var toNum = (s) => Number(s.replace(/[  ,]/g, ""));
function placeName(p, lang) {
  const n = p.names ?? {};
  return (lang === "ru" ? n["name:ru"] ?? n["name:ky"] ?? p.name : n["name:en"] ?? n.int_name ?? p.name) ?? p.name;
}
function stemOf(v) {
  const n = norm(v).trim();
  if (n.length < 4) return null;
  return n.length >= 6 ? n.replace(/[аяоеыиуюйь]$/u, "") : n;
}
function lakeRadius(p) {
  if (!p.bbox) return 15;
  const [s, w, n, e] = p.bbox;
  const dy = (n - s) * 111.2, dx = (e - w) * 111.2 * Math.cos((s + n) / 2 * Math.PI / 180);
  return Math.min(30, Math.max(8, Math.round(Math.hypot(dx, dy) / 2 + 5)));
}
var CANDS = /* @__PURE__ */ new WeakMap();
function candidates(gaz) {
  let c = CANDS.get(gaz);
  if (c) return c;
  const rank = { city: 0, town: 1, lake: 2, reservoir: 2, village: 3, hamlet: 4 };
  c = [];
  for (const g of gaz) {
    if (g.inside_aoi === false || g.kind === "lake" || g.kind === "reservoir") continue;
    const vars = new Set(Object.values(g.names ?? {}).concat([g.name]).map(String));
    for (const v of vars) {
      if (/[;/(]/.test(v)) continue;
      const st = stemOf(v);
      if (!st || !/\p{L}{4}/u.test(st)) continue;
      c.push({ re: bounded(st.split(/[\s-]+/).filter(Boolean).map(esc).join("[\\s-]?") + `${L}{0,3}(?![${L}])`), g, len: st.length });
    }
  }
  c.sort((a, b) => b.len - a.len || (rank[a.g.kind ?? ""] ?? 5) - (rank[b.g.kind ?? ""] ?? 5));
  CANDS.set(gaz, c);
  return c;
}
function parseQuery(text, lang, gaz = [], districtNames = DEFAULT_NAMES) {
  const T2 = new Text(text);
  const filter = {};
  const matched = [];
  const notes = [];
  const ru = lang === "ru";
  let scope = "oblast";
  let placeLabel = null;
  let defaultRadius = 10;
  const range = T2.take(new RegExp(`(?:\u043E\u0442|between|from)\\s*${NUM}${UNIT_M}\\s*(?:\u0434\u043E|and|to|-|\u2013)\\s*${NUM}${UNIT_M}`, "u")) ?? T2.take(new RegExp(`(?<![\\d])${NUM}\\s*(?:-|\u2013|\u2014)\\s*${NUM}\\s*(?:\u043C|m|\u043C\u0435\u0442\u0440${L}*|meter${L}*|metre${L}*)(?![${L}])`, "u"));
  if (range) {
    const a = toNum(range[1]), b = toNum(range[2]);
    filter.elev_min = Math.min(a, b);
    filter.elev_max = Math.max(a, b);
    matched.push({ kind: "elevation_range", text: range[0].trim(), value: [filter.elev_min, filter.elev_max] });
  }
  const above = T2.take(new RegExp(`(?:\u0432\u044B\u0448\u0435|\u043D\u0430\u0434|\u0431\u043E\u043B\u0435\u0435|\u0431\u043E\u043B\u044C\u0448\u0435|\u0441\u0432\u044B\u0448\u0435|above|over|higher\\s+than|>\\s*=?)\\s*${NUM}${UNIT_M}`, "u"));
  if (above) {
    filter.elev_min = toNum(above[1]);
    matched.push({ kind: "elev_min", text: above[0].trim(), value: filter.elev_min });
  }
  const below = T2.take(new RegExp(`(?:\u043D\u0438\u0436\u0435|\u043C\u0435\u043D\u0435\u0435|\u043C\u0435\u043D\u044C\u0448\u0435|below|under|lower\\s+than|<\\s*=?)\\s*${NUM}${UNIT_M}`, "u"));
  if (below) {
    filter.elev_max = toNum(below[1]);
    matched.push({ kind: "elev_max", text: below[0].trim(), value: filter.elev_max });
  }
  for (const k of ["elev_min", "elev_max"]) {
    const v = filter[k];
    if (v != null && (v < 500 || v > 7500)) {
      notes.push(ru ? `\u0432\u044B\u0441\u043E\u0442\u0430 ${v} \u043C \u0432\u043D\u0435 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u0430 \u043E\u0431\u043B\u0430\u0441\u0442\u0438, \u043D\u0435 \u0443\u0447\u0442\u0435\u043D\u0430` : `elevation ${v} m is outside the region's range; ignored`);
      delete filter[k];
    }
  }
  let radius = null;
  const rad = T2.take(new RegExp(`(?:\u0432\\s+\u0440\u0430\u0434\u0438\u0443\u0441\u0435|\u0440\u0430\u0434\u0438\u0443\u0441\u043E\u043C|\u0440\u0430\u0434\u0438\u0443\u0441|within|radius(?:\\s+of)?)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:\u043A\u043C|km|kilomet${L}*|\u043A\u0438\u043B\u043E\u043C\u0435\u0442\u0440${L}*)`, "u")) ?? T2.take(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:\u043A\u043C|km)\\s*(?:\u043E\u0442|\u0432\u043E\u043A\u0440\u0443\u0433|around|from|of)(?![${L}])`, "u"));
  if (rad) {
    radius = Number(rad[1].replace(",", "."));
    matched.push({ kind: "radius_km", text: rad[0].trim(), value: radius });
  }
  let season = "summer";
  const sa = T2.take(bounded(`\u0432\u0435\u0441\u043D${L}*|\u0432\u0435\u0441\u0435\u043D${L}*|\u043E\u0441\u0435\u043D${L}*|spring|autumn|fall\\s+season`));
  if (sa) {
    season = "spring_autumn";
    matched.push({ kind: "season", text: sa[0], value: season });
  }
  const su = T2.take(bounded(`\u043B\u0435\u0442\u043D${L}*|\u043B\u0435\u0442\u043E\u043C|\u043B\u0435\u0442\u043E|summer${L}*`));
  if (su && !sa) matched.push({ kind: "season", text: su[0], value: "summer" });
  let intent = "card";
  const intents = [
    ["queue", `\u043F\u0440\u043E\u0432\u0435\u0440${L}*|\u0438\u043D\u0441\u043F\u0435\u043A\u0446${L}*|\u043E\u0447\u0435\u0440\u0435\u0434${L}*|inspect${L}*|check${L}*|field\\s+visit${L}*|queue`],
    ["alternatives", `\u043B\u0443\u0447\u0448\u0435|\u0432\u043C\u0435\u0441\u0442\u043E|\u0430\u043B\u044C\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432${L}*|\u043A\u0443\u0434\u0430\\s+(?:\u043F\u0435\u0440\u0435\u0433\u043D\u0430\u0442\u044C|\u043F\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438)|better|instead|alternative${L}*|where\\s+else`],
    ["trend", `\u0442\u0440\u0435\u043D\u0434${L}*|\u0434\u0438\u043D\u0430\u043C\u0438\u043A${L}*|\u043C\u0435\u043D\u044F${L}*|\u0438\u0437\u043C\u0435\u043D\u0435\u043D${L}*|\u0441\u043D\u0438\u0436\u0430${L}*|\u0441\u043D\u0438\u0436\u0435\u043D${L}*|\u0440\u0430\u0441\u0442\u0435\u0442|\u0440\u043E\u0441\u0442${L}*|trend${L}*|chang${L}*|declin${L}*|grow${L}*|increas${L}*|decreas${L}*`]
  ];
  for (const [k, src] of intents) {
    const m = T2.take(bounded(src));
    if (m) {
      if (intent === "card") intent = k;
      matched.push({ kind: "intent", text: m[0], value: k });
    }
  }
  for (const src of OBLAST) {
    const m = T2.take(bounded(src));
    if (m) matched.push({ kind: "oblast", text: m[0], value: "naryn-oblast" });
  }
  for (const [slug, pats] of DISTRICTS) {
    for (const src of pats) {
      const m = T2.take(bounded(src));
      if (m) {
        if (!filter.district) {
          filter.district = slug;
          scope = "district";
        } else if (filter.district !== slug) notes.push(ru ? `\u0443\u043F\u043E\u043C\u044F\u043D\u0443\u0442\u043E \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0440\u0430\u0439\u043E\u043D\u043E\u0432; \u0432\u0437\u044F\u0442 \u043F\u0435\u0440\u0432\u044B\u0439` : `several districts mentioned; using the first`);
        matched.push({ kind: "district", text: m[0], value: slug });
        break;
      }
    }
  }
  let place = null;
  const gazLakes = gaz.filter((g) => g.kind === "lake" || g.kind === "reservoir" || g.class === "lake");
  for (const lk of LAKES) {
    const src = lk.aliases.map((a) => aliasSrc(a)).join("|");
    const m = T2.take(bounded(src));
    if (!m) continue;
    const re = bounded(src);
    const g = gazLakes.find((x) => Object.values(x.names ?? { name: x.name }).some((v) => re.test(norm(String(v)))));
    place = g ? { lat: g.lat, lon: g.lon, label: ru ? `\u043E\u0437\u0435\u0440\u043E ${placeName(g, "ru")}` : `${placeName(g, "en")} lake`, radius: lakeRadius(g) } : { lat: lk.lat, lon: lk.lon, label: lk.name[ru ? "ru" : "en"], radius: lk.radius_km };
    if (!g) notes.push(ru ? "\u043A\u043E\u043E\u0440\u0434\u0438\u043D\u0430\u0442\u044B \u043E\u0437\u0435\u0440\u0430 \u043F\u0440\u0438\u0431\u043B\u0438\u0437\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 (\u043D\u0435\u0442 \u0432 OSM-\u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A\u0435)" : "approximate lake coordinates (not in the OSM gazetteer)");
    matched.push({ kind: "lake", text: m[0], value: lk.key });
    break;
  }
  if (!place && gaz.length) {
    const cs = candidates(gaz);
    for (const c of cs) {
      const m = T2.take(c.re);
      if (!m) continue;
      const same = [...new Set(cs.filter((o) => o.re.source === c.re.source).map((o) => o.g))];
      let g = c.g;
      if (same.length > 1) {
        const inD = filter.district ? same.filter((o) => o.district === filter.district) : [];
        g = inD[0] ?? c.g;
        if (!inD.length) notes.push(ru ? `\u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043C\u0435\u0441\u0442 \u0441 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435\u043C \xAB${placeName(g, lang)}\xBB; \u0432\u0437\u044F\u0442\u043E \u043F\u0435\u0440\u0432\u043E\u0435 \u2014 \u0443\u0442\u043E\u0447\u043D\u0438\u0442\u0435 \u0440\u0430\u0439\u043E\u043D \u0438\u043B\u0438 \u043F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 \u043D\u0430 \u043A\u0430\u0440\u0442\u0435` : `several places are called "${placeName(g, lang)}"; using the first. Name the district or show it on the map`);
      }
      place = { lat: g.lat, lon: g.lon, label: placeName(g, lang), radius: 10 };
      matched.push({ kind: "place", text: m[0], value: g.name });
      break;
    }
  }
  if (!place) {
    const m = T2.take(bounded(`\u043D\u0430\u0440\u044B\u043D${L}{0,3}|naryn(?:\\s+(?:town|city))?`));
    if (m) {
      const g = gaz.find((x) => (x.kind === "town" || x.kind === "city") && /^(нарын|naryn)$/u.test(norm(x.name)));
      place = g ? { lat: g.lat, lon: g.lon, label: placeName(g, lang), radius: 10 } : { lat: NARYN_TOWN.lat, lon: NARYN_TOWN.lon, label: NARYN_TOWN.name[ru ? "ru" : "en"], radius: 10 };
      matched.push({ kind: "place", text: m[0], value: "naryn-town" });
    }
  }
  if (place) {
    defaultRadius = place.radius;
    filter.lat = Math.round(place.lat * 1e5) / 1e5;
    filter.lon = Math.round(place.lon * 1e5) / 1e5;
    filter.radius_km = Math.min(radius ?? defaultRadius, 50);
    if (radius != null && radius > 50) notes.push(ru ? "\u0440\u0430\u0434\u0438\u0443\u0441 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D 50 \u043A\u043C" : "radius capped at 50 km");
    filter.place = place.label;
    placeLabel = place.label;
    scope = filter.district ? "district+place" : "place";
  } else if (radius != null) {
    notes.push(ru ? "\u0440\u0430\u0434\u0438\u0443\u0441 \u0431\u0435\u0437 \u043C\u0435\u0441\u0442\u0430 \u043D\u0435 \u0443\u0447\u0442\u0451\u043D" : "radius without a place was ignored");
  }
  const unknown = [];
  const firstWord = /^\s*[\p{L}-]+/u.exec(T2.orig);
  const capsRe = /(?<![\p{L}\d])(\p{Lu}[\p{L}-]{2,})/gu;
  let cm;
  while (cm = capsRe.exec(T2.orig)) {
    if (firstWord && cm.index < firstWord[0].length) continue;
    if (STOP_CAPS.has(cm[1].toLowerCase())) continue;
    unknown.push(cm[1]);
  }
  const pm = new RegExp(`(?<![${L}])${PREP}\\s{1,2}([${L}][${L}-]{2,})`, "u").exec(T2.low);
  if (pm && !STOP_AFTER_PREP.test(pm[1])) unknown.push(pm[1]);
  if (unknown.length) {
    return {
      understood: false,
      parser: "rules",
      lang,
      filter,
      interpreted_as: "",
      intent,
      season,
      scope,
      matched,
      notes,
      message: ru ? "\u041F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 \u043C\u0435\u0441\u0442\u043E \u043D\u0430 \u043A\u0430\u0440\u0442\u0435" : "Show the place on the map",
      unknown: [...new Set(unknown)]
    };
  }
  if (!matched.length) {
    return {
      understood: false,
      parser: "rules",
      lang,
      filter,
      interpreted_as: "",
      intent,
      season,
      scope,
      matched,
      notes,
      message: ru ? "\u041D\u0435 \u043F\u043E\u043D\u044F\u043B \u0437\u0430\u043F\u0440\u043E\u0441. \u041F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 \u043C\u0435\u0441\u0442\u043E \u043D\u0430 \u043A\u0430\u0440\u0442\u0435 \u0438\u043B\u0438 \u043D\u0430\u0437\u043E\u0432\u0438\u0442\u0435 \u0440\u0430\u0439\u043E\u043D" : "Query not understood. Show the place on the map or name a district"
    };
  }
  const parts = [];
  if (filter.district) {
    const nm = districtNames[filter.district] ?? DEFAULT_NAMES[filter.district];
    parts.push(ru ? `${nm?.ru ?? filter.district} \u0440\u0430\u0439\u043E\u043D` : `${nm?.en ?? filter.district} district`);
  }
  if (placeLabel) parts.push(ru ? `\u0432 \u0440\u0430\u0434\u0438\u0443\u0441\u0435 ${filter.radius_km} \u043A\u043C \u043E\u0442: ${placeLabel}` : `within ${filter.radius_km} km of ${placeLabel}`);
  if (!filter.district && !placeLabel) parts.push(ru ? "\u0432\u0441\u044F \u041D\u0430\u0440\u044B\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C" : "all of Naryn region");
  const fmtM = (v) => ru ? String(v) : v.toLocaleString("en-US");
  if (filter.elev_min != null && filter.elev_max != null) parts.push(`${fmtM(filter.elev_min)}\u2013${fmtM(filter.elev_max)} ${ru ? "\u043C" : "m"}`);
  else if (filter.elev_min != null) parts.push(ru ? `\u0432\u044B\u0448\u0435 ${filter.elev_min} \u043C` : `above ${fmtM(filter.elev_min)} m`);
  else if (filter.elev_max != null) parts.push(ru ? `\u043D\u0438\u0436\u0435 ${filter.elev_max} \u043C` : `below ${fmtM(filter.elev_max)} m`);
  parts.push(season === "summer" ? ru ? "\u043B\u0435\u0442\u043E (\u043C\u0430\u0439\u2013\u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044C)" : "summer (May\u2013Sep)" : ru ? "\u0432\u0435\u0441\u043D\u0430 \u0438 \u043E\u0441\u0435\u043D\u044C" : "spring and autumn");
  const intentLabel = {
    queue: ["\u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438", "inspection queue"],
    alternatives: ["\u0430\u043B\u044C\u0442\u0435\u0440\u043D\u0430\u0442\u0438\u0432\u044B \u0440\u044F\u0434\u043E\u043C", "alternatives nearby"],
    trend: ["\u0434\u0438\u043D\u0430\u043C\u0438\u043A\u0430", "trend"]
  };
  if (intentLabel[intent]) parts.push(intentLabel[intent][ru ? 0 : 1]);
  return { understood: true, parser: "rules", lang, filter, interpreted_as: parts.join(" \xB7 "), intent, season, scope, matched, notes };
}
function topBlocks(d, sel, intent, lang, limit = 10) {
  const acc = /* @__PURE__ */ new Map();
  for (const i of sel.idx) {
    if (!d.isPasture(i)) continue;
    const b = d.f.block_id[i];
    const e = acc.get(b) ?? { s: 0, c: 0, a: 0 };
    const sc = d.f.score[i];
    if (Number.isFinite(sc)) {
      e.s += sc;
      e.c += 1;
    }
    e.a += d.f.area_km2[i];
    acc.set(b, e);
  }
  const meta = new Map(d.blocks.map((b) => [b.block_id, b]));
  const lt = d.texts[lang]?.labels ?? d.texts.en.labels;
  const thr = d.cfg.level_thresholds;
  let rows = [...acc.entries()].filter(([, e]) => e.c >= 3).map(([bid, e]) => {
    const b = meta.get(bid) ?? {};
    const score = e.s / e.c;
    const lvl = score >= thr.suitable ? "suitable" : score >= thr.limited ? "limited" : "low";
    return { bid, score, lvl, dyn: b.dyn_class ?? null, area: e.a, lat: b.lat, lon: b.lon };
  });
  if (intent === "queue") rows = rows.filter((r) => r.dyn === "decline");
  if (intent === "alternatives") rows = rows.filter((r) => r.dyn !== "decline");
  rows.sort((a, b) => b.score - a.score || b.area - a.area);
  return rows.slice(0, limit).map((r) => ({
    sel: `block:${r.bid}`,
    name: blockName(d, r.bid, lang),
    score: Math.round(r.score * 10) / 10,
    level_class: r.lvl,
    level_label: lt.level[r.lvl],
    dynamics_class: r.dyn,
    dynamics_label: r.dyn ? lt.dynamics[r.dyn] : null,
    pasture_km2_in_filter: Math.round(r.area * 10) / 10,
    centroid: r.lat != null ? { lat: r.lat, lon: r.lon } : null
  }));
}
var GAZ = null;
function gazetteer(base) {
  if (!GAZ) {
    GAZ = fetch(`${base}/gazetteer.json`).then((r) => r.ok ? r.json() : { places: [] }).then((g) => Array.isArray(g) ? g : g.places ?? []).catch(() => {
      GAZ = null;
      return [];
    });
  }
  return GAZ;
}
function runQuery(d, text, lang, gaz) {
  const q = parseQuery(text, lang, gaz, d.cfg.district_names);
  if (!q.understood) return { ...q, card: null, blocks: [] };
  if (q.filter.district && !d.district.includes(q.filter.district)) delete q.filter.district;
  const sel = filterSel(d, q.filter, lang, q.interpreted_as);
  const card = buildCard(d, sel, lang, null, q.season);
  if (q.season !== "summer" && !card.extras?.season_variant) {
    q.notes.push(lang === "ru" ? "\u0432\u0435\u0441\u0435\u043D\u043D\u0435-\u043E\u0441\u0435\u043D\u043D\u0438\u0439 \u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u0435\u0449\u0451 \u043D\u0435 \u0433\u043E\u0442\u043E\u0432; \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u043B\u0435\u0442\u043D\u0438\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F" : "the spring/autumn variant is not ready yet; summer values shown");
  }
  if (!sel.idx.length) q.notes.push(lang === "ru" ? "\u043F\u043E\u0434 \u0444\u0438\u043B\u044C\u0442\u0440 \u043D\u0435 \u043F\u043E\u043F\u0430\u043B\u0430 \u043D\u0438 \u043E\u0434\u043D\u0430 \u044F\u0447\u0435\u0439\u043A\u0430" : "no cells match this filter");
  return { ...q, card, blocks: topBlocks(d, sel, q.intent, lang) };
}
async function queryRoute(path, req, u, ctx) {
  if (path !== "/api/query") return null;
  let text, lang;
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    text = body?.text;
    lang = body?.lang;
  } else if (req.method === "GET") {
    text = u.searchParams.get("text");
    lang = u.searchParams.get("lang");
  } else return ctx.json({ detail: "use POST {text, lang}" }, 405);
  if (typeof text !== "string" || !text.trim()) return ctx.json({ detail: "text is required" }, 422);
  if (text.length > 500) return ctx.json({ detail: "text is too long (max 500 characters)" }, 422);
  const lg = lang === "ru" || lang === "en" ? lang : /[а-яёөүң]/i.test(text) ? "ru" : "en";
  const [d, gaz] = await Promise.all([ctx.data(), gazetteer(ctx.BASE)]);
  return ctx.json(runQuery(d, text, lg, gaz));
}

// a_ext.ts
var T = {
  en: {
    growth: "Apr\u2013Sep precipitation rose: {s} mm per decade (95% CI {lo} to {hi})",
    decline: "Apr\u2013Sep precipitation fell: {s} mm per decade (95% CI {lo} to {hi})",
    unreliable: "No reliable trend in Apr\u2013Sep precipitation ({s} mm per decade, 95% CI {lo} to {hi})",
    insufficient: "Not enough precipitation data",
    sa: "Spring\u2013autumn (Apr, May, Sep, Oct): {lvl}",
    snow: "May snow cover: {pct}% of 8-day periods on average (more than on {p}% of pastures)"
  },
  ru: {
    growth: "\u041E\u0441\u0430\u0434\u043A\u0438 \u0430\u043F\u0440\u0435\u043B\u044C\u2013\u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044C \u0432\u044B\u0440\u043E\u0441\u043B\u0438: {s} \u043C\u043C \u0437\u0430 \u0434\u0435\u0441\u044F\u0442\u0438\u043B\u0435\u0442\u0438\u0435 (95% \u0414\u0418 \u043E\u0442 {lo} \u0434\u043E {hi})",
    decline: "\u041E\u0441\u0430\u0434\u043A\u0438 \u0430\u043F\u0440\u0435\u043B\u044C\u2013\u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044C \u0441\u043D\u0438\u0437\u0438\u043B\u0438\u0441\u044C: {s} \u043C\u043C \u0437\u0430 \u0434\u0435\u0441\u044F\u0442\u0438\u043B\u0435\u0442\u0438\u0435 (95% \u0414\u0418 \u043E\u0442 {lo} \u0434\u043E {hi})",
    unreliable: "\u041D\u0430\u0434\u0451\u0436\u043D\u043E\u0433\u043E \u0442\u0440\u0435\u043D\u0434\u0430 \u043E\u0441\u0430\u0434\u043A\u043E\u0432 \u0430\u043F\u0440\u0435\u043B\u044C\u2013\u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044C \u043D\u0435\u0442 ({s} \u043C\u043C \u0437\u0430 \u0434\u0435\u0441\u044F\u0442\u0438\u043B\u0435\u0442\u0438\u0435, 95% \u0414\u0418 \u043E\u0442 {lo} \u0434\u043E {hi})",
    insufficient: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0434\u0430\u043D\u043D\u044B\u0445 \u043F\u043E \u043E\u0441\u0430\u0434\u043A\u0430\u043C",
    sa: "\u0412\u0435\u0441\u043D\u0430\u2013\u043E\u0441\u0435\u043D\u044C (\u0430\u043F\u0440, \u043C\u0430\u0439, \u0441\u0435\u043D, \u043E\u043A\u0442): {lvl}",
    snow: "\u0421\u043D\u0435\u0433 \u0432 \u043C\u0430\u0435: \u0432 \u0441\u0440\u0435\u0434\u043D\u0435\u043C {pct}% \u0432\u043E\u0441\u044C\u043C\u0438\u0434\u043D\u0435\u0432\u043D\u044B\u0445 \u043F\u0435\u0440\u0438\u043E\u0434\u043E\u0432 (\u0431\u043E\u043B\u044C\u0448\u0435, \u0447\u0435\u043C \u043D\u0430 {p}% \u043F\u0430\u0441\u0442\u0431\u0438\u0449)"
  }
};
var sg = (x) => (x >= 0 ? "+" : "") + x.toFixed(0);
var fill = (s, v) => s.replace(/\{(\w+)\}/g, (_m, k) => v[k] ?? "");
function registerAExtras(d) {
  const P = d.f["precip_S"];
  const meta = d.h.extra?.precip_S;
  if (P && meta) {
    EXTRA_HOOKS.push((d2, _sel, ctx) => {
      const p = ctx.pasture;
      if (!p.length) return null;
      const vals = [];
      for (let y = 0; y < d2.Y; y++) {
        let s2 = 0, c = 0;
        for (const i of p) {
          const v = P[i * d2.Y + y];
          if (v !== meta.nan) {
            s2 += v * meta.scale;
            c++;
          }
        }
        vals.push(c >= Math.max(1, 0.5 * p.length) && c > 0 ? s2 / c : NaN);
      }
      const r = trend1d(vals, d2.years, d2.cfg.trend.method);
      const cls = classify(r.slope, r.p, r.n, d2.cfg.trend.alpha, d2.cfg.min_valid_years);
      const lang = ctx.lang === "ru" ? "ru" : "en";
      const s = r.slope * 10, lo = r.ci_lo * 10, hi = r.ci_hi * 10;
      return ["precip", {
        slope_per_decade: s,
        ci95: [lo, hi],
        p_value: r.p,
        class: cls,
        unit: "mm per decade (Apr\u2013Sep total)",
        text: Number.isFinite(s) ? fill(T[lang][cls], { s: sg(s), lo: sg(lo), hi: sg(hi) }) : T[lang].insufficient,
        series: vals.map((v) => Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
      }];
    });
  }
  if (d.f["score_sa"]) {
    EXTRA_HOOKS.push((d2, _sel, ctx) => {
      const p = ctx.pasture;
      if (!p.length) return null;
      let s = 0, c = 0;
      for (const i of p) {
        const v = d2.f.score_sa[i];
        if (Number.isFinite(v)) {
          s += v;
          c++;
        }
      }
      const score = c ? s / c : NaN;
      const lvl = classOfScore(score, d2.cfg.level_thresholds);
      const lang = ctx.lang === "ru" ? "ru" : "en";
      const label = lvl ? d2.texts[lang].labels.level[lvl] : null;
      return ["season_variant", {
        season: "spring_autumn",
        months: d2.cfg.spring_autumn_months,
        score: Math.round(score * 10) / 10,
        level_class: lvl,
        level_label: label,
        text: fill(T[lang].sa, { lvl: (label ?? "\u2014").toLowerCase() })
      }];
    });
  }
  if (d.f["snow_may"]) {
    EXTRA_HOOKS.push((d2, _sel, ctx) => {
      const p = ctx.pasture;
      if (!p.length) return null;
      let s = 0, c = 0, sp = 0, cp = 0;
      for (const i of p) {
        const v = d2.f.snow_may[i], q = d2.f.snow_may_pct[i];
        if (Number.isFinite(v)) {
          s += v;
          c++;
        }
        if (Number.isFinite(q)) {
          sp += q;
          cp++;
        }
      }
      const may = c ? s / c : NaN, pp = cp ? sp / cp : NaN;
      const lang = ctx.lang === "ru" ? "ru" : "en";
      return ["snow", {
        may_share: may,
        percentile: Number.isFinite(pp) ? Math.round(1e3 * pp) / 10 : null,
        text: fill(T[lang].snow, { pct: (100 * may).toFixed(0), p: (100 * pp).toFixed(0) })
      }];
    });
  }
}

// capacity.ts
var PARAMS = ["a", "b", "u", "I", "D"];
function sig(x, n = 2) {
  if (!Number.isFinite(x)) return null;
  if (x === 0) return 0;
  const k = Math.floor(Math.log10(Math.abs(x))) - (n - 1);
  const f = 10 ** k;
  return k >= 0 ? Math.round(x / f) * f : Number((Math.round(x / f) * f).toFixed(-k));
}
function mergeAssumptions(cfg, a) {
  const out = {};
  const unsourced = [];
  for (const k of PARAMS) {
    const p = { ...cfg.parameters[k] };
    const o = a?.[k];
    if (typeof o === "number" && Number.isFinite(o)) Object.assign(p, { low: o, central: o, high: o, source: "user", placeholder: false });
    else if (o && typeof o === "object") {
      for (const e of ["low", "central", "high"]) if (typeof o[e] === "number" && Number.isFinite(o[e])) p[e] = o[e];
      Object.assign(p, { source: String(o.source || "user"), placeholder: false });
    } else if (o !== void 0) throw new HttpError(422, `assumptions.${k} must be a number or {low, central, high}`);
    if (p.placeholder || !p.source) unsourced.push(k);
    out[k] = p;
  }
  for (const k of Object.keys(a ?? {})) if (!PARAMS.includes(k)) throw new HttpError(422, `unknown assumption '${k}' (use ${PARAMS.join(", ")})`);
  if (["I", "D"].some((k) => Math.min(out[k].low, out[k].high, out[k].central) <= 0)) throw new HttpError(422, "I and D must be positive");
  return { P: out, unsourced };
}
function scenario(card, cfg, assumptions, lang = "en") {
  const { P, unsourced } = mergeAssumptions(cfg, assumptions);
  const pastureKm2 = card?.area?.pasture_km2 ?? 0;
  const ndvi = card?.dynamics?.mean;
  const A = pastureKm2 * 100;
  const end = (k, s) => {
    const p = P[k];
    if (s === "central") return p.central;
    const up = (p.heads_effect ?? "up") === "up";
    return s === "high" === up ? Math.max(p.low, p.high) : Math.min(p.low, p.high);
  };
  const heads = {}, biomass = {};
  for (const s of ["low", "central", "high"]) {
    if (!Number.isFinite(ndvi) || !(A > 0)) {
      heads[s] = biomass[s] = null;
      continue;
    }
    const B = Math.max(0, end("a", s) + end("b", s) * ndvi);
    biomass[s] = Math.round(B);
    heads[s] = sig(A * B * end("u", s) / (end("I", s) * end("D", s)));
  }
  const L2 = lang === "ru" ? "ru" : "en";
  return {
    label: cfg.label[L2],
    formula: cfg.formula,
    head_unit: cfg.head_unit[L2],
    low: heads.low,
    central: heads.central,
    high: heads.high,
    biomass_kg_dm_ha: biomass,
    inputs: {
      sel: card?.selection?.sel ?? null,
      name: card?.selection?.name ?? null,
      status: card?.status ?? null,
      pasture_km2: pastureKm2,
      A_ha: A,
      ndvi_peak: Number.isFinite(ndvi) ? ndvi : null,
      ndvi_peak_source: cfg.ndvi_peak_source
    },
    assumptions: P,
    unsourced,
    caveats: cfg.caveats[L2],
    data_mode: card?.meta?.data_mode ?? null,
    ...heads.central == null ? { message: L2 === "ru" ? "\u0432 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0439 \u043E\u0431\u043B\u0430\u0441\u0442\u0438 \u043D\u0435\u0442 \u043F\u0430\u0441\u0442\u0431\u0438\u0449 \u0441 \u0434\u0430\u043D\u043D\u044B\u043C\u0438" : "no pasture with data in this selection" } : {}
  };
}
var CFG = null;
function capacityCfg(base) {
  if (!CFG) {
    CFG = fetch(`${base}/capacity.json`).then((r) => {
      if (!r.ok) throw new Error(`capacity.json ${r.status}`);
      return r.json();
    }).catch((e) => {
      CFG = null;
      throw e;
    });
  }
  return CFG;
}
async function capacityRoute(path, req, _u, ctx) {
  if (path !== "/api/capacity") return null;
  if (req.method !== "POST") return ctx.json({ detail: "use POST {sel, assumptions?, lang?}" }, 405);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return ctx.json({ detail: "invalid JSON body" }, 422);
  const lang = body.lang === "ru" ? "ru" : body.lang === "en" ? "en" : ctx.lang;
  let cfg;
  try {
    cfg = await capacityCfg(ctx.BASE);
  } catch (_e) {
    return ctx.json({ detail: "capacity config not exported yet" }, 503);
  }
  let card;
  if (typeof body.sel === "string" && body.sel) card = await ctx.cardFor(body.sel, lang, null, "summer");
  else if (body.geometry) card = buildCard(await ctx.data(), polygonSel(await ctx.data(), body.geometry, lang), lang);
  else if (body.filter) card = buildCard(await ctx.data(), filterSel(await ctx.data(), body.filter, lang), lang);
  else return ctx.json({ detail: "sel (or geometry / filter) is required" }, 422);
  return ctx.json(scenario(card, cfg, body.assumptions, lang));
}

// extras.ts
var ROUTES = [];
var REGISTRARS = [];
function addRoute(r) {
  ROUTES.push(r);
}
function addRegistrar(f) {
  REGISTRARS.push(f);
}
function registerExtras(d) {
  for (const f of REGISTRARS) {
    try {
      f(d);
    } catch (e) {
      console.error("extra registrar failed", e);
    }
  }
}
async function routeExtras(path, req, u, ctx) {
  for (const r of ROUTES) {
    const res = await r(path, req, u, ctx);
    if (res) return res;
  }
  const m = path.match(/^\/api\/(ml\/expected|forecast)$/);
  if (m) {
    const sel = u.searchParams.get("sel") ?? "district:naryn";
    const [kind, val] = [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)];
    return ctx.staticFile(`${m[1].replace("/", "_")}/${kind}/${val}_${ctx.lang}.json`);
  }
  const p = path.match(/^\/api\/passport\.(pdf|csv)$/);
  if (p) {
    const sel = u.searchParams.get("sel") ?? "";
    const [kind, val] = [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)];
    if (kind !== "district" && kind !== "block") {
      return ctx.json({ detail: "passports are precomputed for districts and blocks; use the browser's print for drawn areas" }, 422);
    }
    return ctx.staticFile(`passport/${kind}/${val}_${ctx.lang}.${p[1]}`, p[1] === "pdf" ? "application/pdf" : "text/csv; charset=utf-8");
  }
  return null;
}
addRegistrar(registerAccess);
addRoute(queryRoute);
addRegistrar(registerAExtras);
addRoute(capacityRoute);

// router.ts
var BASE = "";
function setBase(base) {
  BASE = base.replace(/\/$/, "");
  DATA = null;
}
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var DATA = null;
function data() {
  if (!DATA) {
    DATA = (async () => {
      const [h, b] = await Promise.all([
        fetch(`${BASE}/cells.json`).then((r) => {
          if (!r.ok) throw new Error(`cells.json ${r.status}`);
          return r.json();
        }),
        fetch(`${BASE}/cells.bin`).then((r) => {
          if (!r.ok) throw new Error(`cells.bin ${r.status}`);
          return r.arrayBuffer();
        })
      ]);
      const d = new Data(h, b);
      registerExtras(d);
      return d;
    })().catch((e) => {
      DATA = null;
      throw e;
    });
  }
  return DATA;
}
var json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra } });
async function staticFile(path, type = "application/json; charset=utf-8", status404 = "not built yet") {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) return json({ detail: `${path}: ${status404}` }, r.status === 400 || r.status === 404 ? 503 : r.status);
  return new Response(r.body, { status: 200, headers: { ...CORS, "Content-Type": type, "Cache-Control": "public, max-age=300" } });
}
var redirect = (path) => new Response(null, { status: 302, headers: { ...CORS, Location: `${BASE}/${path}` } });
function parseWeights(w) {
  if (!w) return null;
  const keys = ["green", "stability", "season", "terrain"];
  const out = { green: 0, stability: 0, season: 0, terrain: 0 };
  const parts = w.split(",");
  parts.forEach((p, i) => {
    const [k, v] = p.includes(":") ? p.split(":") : [keys[i], p];
    if (!keys.includes(k) || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(422, "weights must be 'g,s,se,t' or 'green:0.4,...'");
    out[k] = Number(v);
  });
  if (Object.values(out).reduce((a, b) => a + b, 0) <= 0) throw new HttpError(422, "weights must not all be zero");
  return out;
}
var langOf = (u) => u.searchParams.get("lang") === "ru" ? "ru" : "en";
async function cardFor(sel, lang, weights, season) {
  const [kind, val] = [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)];
  if (!weights && season === "summer" && (kind === "district" || kind === "block") && /^[\w-]+$/.test(val)) {
    const r = await fetch(`${BASE}/cards/${kind}/${val}_${lang}.json`);
    if (r.ok) return await r.json();
  }
  const d = await data();
  return buildCard(d, parseSel(d, sel, lang), lang, weights, season);
}
async function handle(req) {
  const u = new URL(req.url);
  let path = u.pathname.replace(/^\/(functions\/v1\/)?trendex-api/, "");
  if (!path.startsWith("/api")) path = "/api" + (path === "/" ? "" : path);
  const lang = langOf(u);
  const q = (k) => u.searchParams.get(k);
  if (path === "/api" || path === "/api/") return json({ name: "TrendeX API", docs: "see /api/meta, /api/overview, /api/card?sel=district:naryn" });
  if (path === "/api/health") return staticFile("health.json");
  if (["/api/meta", "/api/overview", "/api/methods"].includes(path)) return staticFile(`${path.slice(5)}_${lang}.json`);
  if (path === "/api/layers") {
    const r = await fetch(`${BASE}/layers.json`);
    if (!r.ok) return json({ detail: "layers not built" }, 503);
    const L2 = await r.json();
    for (const l of L2.layers ?? []) l.url = `${BASE}/layers/${l.key}.png`;
    return json(L2);
  }
  let m = path.match(/^\/api\/layers\/([\w-]+)\.png$/);
  if (m) return redirect(`layers/${m[1]}.png`);
  m = path.match(/^\/api\/zones\/(districts|blocks)\.geojson$/);
  if (m) return staticFile(`zones/${m[1]}.geojson`, "application/geo+json");
  if (path === "/api/trends") {
    const variable = q("variable") === "precip" ? "precip_trends" : "trends";
    const r = await fetch(`${BASE}/${variable}_${lang}.json`);
    if (!r.ok) return json({ detail: `variable '${q("variable") ?? "ndvi"}' not available yet` }, 503);
    const T2 = await r.json();
    const scope = q("scope") ?? "all";
    if (scope === "oblast") return json(T2.oblast);
    if (scope === "district") {
      const e = (T2.districts ?? []).find((x) => x.id === q("id"));
      return e ? json(e) : json({ detail: `unknown district ${q("id")}` }, 404);
    }
    return json(T2);
  }
  if (path === "/api/queue" || path === "/api/queue.csv") {
    const district = q("district"), level = q("level"), limit = Number(q("limit") ?? 0);
    if (path === "/api/queue.csv" && !district && !level && !limit) return staticFile(`queue_${lang}.csv`, "text/csv; charset=utf-8");
    const r = await fetch(`${BASE}/queue_${lang}.json`);
    if (!r.ok) return json({ detail: "queue not built" }, 503);
    let Z = (await r.json()).filter((z) => (!district || z.district === district) && (!level || z.level === level));
    if (limit) Z = Z.slice(0, limit);
    if (path === "/api/queue") return json(Z);
    const cols = ["rank", "zone_id", "district_name", "lat", "lon", "area_km2", "level", "score", "dynamics", "slope_per_decade", "ci_lo", "ci_hi", "confidence", "action"];
    const esc2 = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "\uFEFF" + [cols.join(","), ...Z.map((z) => cols.map((c) => esc2(z[c])).join(","))].join("\n");
    return new Response(csv, { headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trendex_inspection_queue_${lang}.csv"` } });
  }
  if (path === "/api/card" && req.method === "GET") {
    const sel = q("sel");
    if (!sel) throw new HttpError(422, "sel is required");
    return json(await cardFor(sel, lang, parseWeights(q("weights")), q("season") ?? "summer"));
  }
  if (path === "/api/card" && req.method === "POST") {
    const body = await req.json().catch(() => {
      throw new HttpError(422, "invalid JSON body");
    });
    const bl = body.lang === "ru" ? "ru" : "en";
    const w = body.weights ? parseWeights(Object.entries(body.weights).map(([k, v]) => `${k}:${v}`).join(",")) : null;
    const d = await data();
    const type = body.type ?? "polygon";
    if (type === "polygon") return json(buildCard(d, polygonSel(d, body.geometry, bl), bl, w, body.season ?? "summer"));
    if (type === "filter") return json(buildCard(d, filterSel(d, body.filter ?? {}, bl), bl, w, body.season ?? "summer"));
    return json(await cardFor(body.sel ?? `${type}:`, bl, w, body.season ?? "summer"));
  }
  if (path === "/api/compare") {
    const a = q("a"), b = q("b");
    if (!a || !b) throw new HttpError(422, "a and b are required");
    const w = parseWeights(q("weights"));
    const [ca, cb] = await Promise.all([cardFor(a, lang, w, "summer"), cardFor(b, lang, w, "summer")]);
    const better_on = (ca.level?.components ?? []).map((x, i) => {
      const y = cb.level?.components?.[i];
      return x.percentile != null && y?.percentile != null ? { key: x.key, winner: x.percentile > y.percentile ? "a" : "b", delta: x.percentile - y.percentile } : null;
    }).filter(Boolean);
    return json({ a: ca, b: cb, diff: {
      score_delta: ca.level && cb.level ? ca.level.score - cb.level.score : null,
      pct_per_decade_delta: ca.dynamics?.pct_per_decade != null && cb.dynamics?.pct_per_decade != null ? ca.dynamics.pct_per_decade - cb.dynamics.pct_per_decade : null,
      better_on
    } });
  }
  if (path === "/api/level/recompute" && req.method === "POST") {
    const body = await req.json();
    const w = parseWeights(Object.entries(body.weights ?? {}).map(([k, v]) => `${k}:${v}`).join(","));
    return json(recompute(await data(), w));
  }
  if (path === "/api/locate" || path === "/api/point") {
    const lat = Number(q("lat")), lon = Number(q("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(422, "lat and lon are required");
    const d = await data();
    const i = nearest(d, lat, lon);
    if (i < 0) return json({ inside_aoi: false, lat, lon });
    const dist = d.districtOf(i), bid = d.f.block_id[i];
    if (path === "/api/locate") {
      return json({
        inside_aoi: true,
        in_region: !!dist,
        block_id: bid,
        district: dist,
        sel_block: `block:${bid}`,
        sel_district: dist ? `district:${dist}` : null,
        sel_point: `point:${lat.toFixed(5)},${lon.toFixed(5)},5`
      });
    }
    const series = d.years.map((_, y) => {
      const v = d.s(i, y);
      return Number.isFinite(v) ? v : null;
    });
    return json({
      inside_aoi: true,
      district: dist,
      block_id: bid,
      status: d.status[d.f.status[i]],
      elev_mean: d.f.elev_mean[i],
      slope_mean: d.f.slope_mean[i],
      score: d.f.score[i],
      level_class: d.level[d.f.level[i]],
      trend_class: d.trend[d.f.trend[i]],
      green: d.f.green[i],
      valid_frac: d.f.valid_frac[i],
      series,
      years: [d.years[0], d.years[d.Y - 1]]
    });
  }
  const ext = await routeExtras(path, req, u, { data, cardFor, json, staticFile, BASE, lang });
  if (ext) return ext;
  return json({ detail: `not found: ${path}` }, 404);
}
async function route(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return await handle(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ detail: e.message }, status);
  }
}

// client.ts
function createTrendexApi(base) {
  const abs = new URL(base, globalThis.location?.href ?? "http://localhost/").href.replace(/\/$/, "");
  setBase(abs);
  const origin = "https://trendex.local";
  const call = (path, init) => route(new Request(origin + (path.startsWith("/") ? path : "/" + path), init));
  const asJson = async (r) => {
    const body = await r.json();
    if (!r.ok) throw Object.assign(new Error(body?.detail ?? `HTTP ${r.status}`), { status: r.status, body });
    return body;
  };
  return {
    base: abs,
    fetch: call,
    get: (path) => call(path).then(asJson),
    post: (path, body) => call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }).then(asJson)
  };
}
if (typeof window !== "undefined") window.createTrendexApi = createTrendexApi;
export {
  createTrendexApi
};
