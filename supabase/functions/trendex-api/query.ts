// F13 text query, rules only (no LLM): POST /api/query {text, lang} (also GET /api/query?text=&lang=).
// text -> filter {district?, lat/lon/radius_km?, elev_min?, elev_max?} -> filterSel -> buildCard + top blocks.
// Places come from gazetteer.json (OSM, written by backend/trendex_core/ext/access.py), plus district aliases.
// Golden test: node --experimental-strip-types test_query.ts
import { blockName, buildCard, type Data, districtName, filterSel, type Sel } from "./core.ts";

export interface GazPlace { name: string; names?: Record<string, string>; lat: number; lon: number; kind?: string; bbox?: number[]; inside_aoi?: boolean; district?: string | null }
export interface QueryFilter { district?: string; lat?: number; lon?: number; radius_km?: number; elev_min?: number; elev_max?: number; place?: string }
export interface Parsed {
  understood: boolean; parser: "rules"; lang: string; filter: QueryFilter; interpreted_as: string; intent: string; season: string;
  scope: string; matched: { kind: string; text: string; value: any }[]; notes: string[]; message?: string;
}

const L = "\\p{L}";
const NUM = "(\\d{1,3}(?:[ \\u00a0,]\\d{3})+|\\d+)";
const UNIT_M = `(?:\\s*(?:м|m|метр${L}*|meter${L}*|metre${L}*))?(?![${L}\\d])`;
const DEFAULT_NAMES: Record<string, { en: string; ru: string }> = {
  "at-bashy": { en: "At-Bashy", ru: "Ат-Башинский" }, naryn: { en: "Naryn", ru: "Нарынский" },
  "ak-talaa": { en: "Ak-Talaa", ru: "Ак-Талинский" }, jumgal: { en: "Jumgal", ru: "Жумгальский" },
  kochkor: { en: "Kochkor", ru: "Кочкорский" },
};
// [slug, patterns] on normalized text. Kyrgyz forms are covered after ө→о, ү→у, ң→н.
const DISTRICTS: [string, string[]][] = [
  ["at-bashy", [`ат[\\s-]?баш${L}*`, `at[\\s-]?bash${L}*`]],
  ["ak-talaa", [`ак[\\s-]?тал${L}*`, `ak[\\s-]?tal${L}*`]],
  ["jumgal", [`жумгал${L}*`, `(?:dj|dzh|zh|j)umgal${L}*`]],
  ["kochkor", [`кочкор${L}*`, `kochkor${L}*`]],
  ["naryn", [`нарынск(?:ий|ого|ому|им|ом)(?![${L}])`, `нарын\\s+район${L}*`, `naryn\\s+(?:district|rayon|raion)`]],
];
const OBLAST = [`нарынск(?:ая|ой|ую|ою)\\s+облас${L}*`, `нарын\\s+облус${L}*`, `naryn\\s+(?:region|oblast|province)`,
  `(?:вся|всей|всю)\\s+облас${L}*`, `(?:whole|entire|all(?:\\s+of)?(?:\\s+the)?)\\s+(?:region|oblast)`];
// Lakes: used when the gazetteer (OSM) has no entry; coordinates from configs/known_places.yaml (approximate).
const LAKES: { name: { en: string; ru: string }; aliases: string[]; lat: number; lon: number; radius_km: number; key: string }[] = [
  { key: "son-kul", name: { en: "Son-Kul lake", ru: "озеро Сон-Куль" }, lat: 41.83, lon: 75.13, radius_km: 20,
    aliases: ["сон-куль", "сон-кул", "сон-коль", "сон-кол", "сон-кель", "son-kul", "son-kol", "song-kol", "song-kul", "song-kul"] },
  { key: "chatyr-kul", name: { en: "Chatyr-Kul lake", ru: "озеро Чатыр-Куль" }, lat: 40.61, lon: 75.30, radius_km: 15,
    aliases: ["чатыр-куль", "чатыр-кул", "чатыр-коль", "чатыр-кол", "chatyr-kul", "chatyr-kol", "chatir-kul", "chatyr-kel"] },
];
const NARYN_TOWN = { name: { en: "Naryn (town)", ru: "г. Нарын" }, lat: 41.43, lon: 75.99 };  // known_places.yaml
const PREP = `(?:около|возле|рядом\\s+с|близ|недалеко\\s+от|вокруг|near|around|close\\s+to|next\\s+to|in\\s+the\\s+village\\s+of|village|село|селе|села)`;
const STOP_AFTER_PREP = /^(дорог|вод|рек|озер|насел|сел|посел|город|деревн|road|water|river|lake|settle|villag|town|меня|нас|me|us|the|a|an|них|него|них)/u;
const STOP_CAPS = new Set(["ndvi", "modis", "nasa", "trendex", "osm", "imerg", "openstreetmap", "kyrgyzstan", "kyrgyz", "кыргызстан",
  "кыргызстана", "киргизия", "киргизии", "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "what", "where",
  "which", "how", "show", "find", "please", "покажи", "покажите", "найди", "найдите", "где", "какие", "какой", "как", "что"]);

export function norm(s: string): string {  // length-preserving
  let o = "";
  for (const ch of s) {
    const c = ch.toLowerCase();
    o += c.length === 1 ? c.replace("ё", "е").replace(/[өӧ]/, "о").replace(/[үӱ]/, "у").replace("ң", "н").replace(/[‐-―−]/, "-") : ch;
  }
  return o;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function aliasSrc(alias: string, stem = true): string {
  return norm(alias).split(/[\s-]+/).filter(Boolean).map(esc).join("[\\s-]?") + (stem ? `${L}{0,4}` : "") + `(?![${L}])`;
}
const bounded = (src: string) => new RegExp(`(?<![${L}\\d])(?:${src})`, "u");

class Text {
  low: string; orig: string;
  constructor(t: string) { this.orig = t; this.low = norm(t); }
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.low);
    if (m) {
      const blank = " ".repeat(m[0].length);
      this.low = this.low.slice(0, m.index) + blank + this.low.slice(m.index + m[0].length);
      this.orig = this.orig.slice(0, m.index) + blank + this.orig.slice(m.index + m[0].length);
    }
    return m;
  }
}
const toNum = (s: string) => Number(s.replace(/[  ,]/g, ""));

function placeName(p: GazPlace, lang: string): string {
  const n = p.names ?? {};
  return (lang === "ru" ? n["name:ru"] ?? n["name:ky"] ?? p.name : n["name:en"] ?? n.int_name ?? p.name) ?? p.name;
}
function stemOf(v: string): string | null {
  const n = norm(v).trim();
  if (n.length < 4) return null;
  // drop one trailing vowel / soft sign so Russian case endings still match (Баетово -> Баетова, Кочкорка -> Кочкорке)
  return n.length >= 6 ? n.replace(/[аяоеыиуюйь]$/u, "") : n;
}
function lakeRadius(p: GazPlace): number {
  if (!p.bbox) return 15;
  const [s, w, n, e] = p.bbox;
  const dy = (n - s) * 111.2, dx = (e - w) * 111.2 * Math.cos(((s + n) / 2) * Math.PI / 180);
  return Math.min(30, Math.max(8, Math.round(Math.hypot(dx, dy) / 2 + 5)));
}

// compiled place-name patterns per gazetteer (longest stem first; towns before villages before hamlets)
const CANDS = new WeakMap<GazPlace[], { re: RegExp; g: GazPlace; len: number }[]>();
function candidates(gaz: GazPlace[]) {
  let c = CANDS.get(gaz);
  if (c) return c;
  const rank: Record<string, number> = { city: 0, town: 1, lake: 2, reservoir: 2, village: 3, hamlet: 4 };
  c = [];
  for (const g of gaz) {
    if (g.inside_aoi === false || g.kind === "lake" || g.kind === "reservoir") continue;  // lakes: see LAKES above
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

export function parseQuery(text: string, lang: string, gaz: GazPlace[] = [], districtNames: Record<string, any> = DEFAULT_NAMES): Parsed {
  const T = new Text(text);
  const filter: QueryFilter = {};
  const matched: Parsed["matched"] = [];
  const notes: string[] = [];
  const ru = lang === "ru";
  let scope = "oblast";
  let placeLabel: string | null = null;
  let defaultRadius = 10;

  // ---- numbers first (so "2500 м" never looks like a place) ----
  const range = T.take(new RegExp(`(?:от|between|from)\\s*${NUM}${UNIT_M}\\s*(?:до|and|to|-|–)\\s*${NUM}${UNIT_M}`, "u")) ??
    T.take(new RegExp(`(?<![\\d])${NUM}\\s*(?:-|–|—)\\s*${NUM}\\s*(?:м|m|метр${L}*|meter${L}*|metre${L}*)(?![${L}])`, "u"));
  if (range) {
    const a = toNum(range[1]), b = toNum(range[2]);
    filter.elev_min = Math.min(a, b); filter.elev_max = Math.max(a, b);
    matched.push({ kind: "elevation_range", text: range[0].trim(), value: [filter.elev_min, filter.elev_max] });
  }
  const above = T.take(new RegExp(`(?:выше|над|более|больше|свыше|above|over|higher\\s+than|>\\s*=?)\\s*${NUM}${UNIT_M}`, "u"));
  if (above) { filter.elev_min = toNum(above[1]); matched.push({ kind: "elev_min", text: above[0].trim(), value: filter.elev_min }); }
  const below = T.take(new RegExp(`(?:ниже|менее|меньше|below|under|lower\\s+than|<\\s*=?)\\s*${NUM}${UNIT_M}`, "u"));
  if (below) { filter.elev_max = toNum(below[1]); matched.push({ kind: "elev_max", text: below[0].trim(), value: filter.elev_max }); }
  for (const k of ["elev_min", "elev_max"] as const) {
    const v = filter[k];
    if (v != null && (v < 500 || v > 7500)) { notes.push(ru ? `высота ${v} м вне диапазона области, не учтена` : `elevation ${v} m is outside the region's range; ignored`); delete filter[k]; }
  }
  let radius: number | null = null;
  const rad = T.take(new RegExp(`(?:в\\s+радиусе|радиусом|радиус|within|radius(?:\\s+of)?)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:км|km|kilomet${L}*|километр${L}*)`, "u")) ??
    T.take(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:км|km)\\s*(?:от|вокруг|around|from|of)(?![${L}])`, "u"));
  if (rad) { radius = Number(rad[1].replace(",", ".")); matched.push({ kind: "radius_km", text: rad[0].trim(), value: radius }); }

  // ---- season ----
  let season = "summer";
  const sa = T.take(bounded(`весн${L}*|весен${L}*|осен${L}*|spring|autumn|fall\\s+season`));
  if (sa) { season = "spring_autumn"; matched.push({ kind: "season", text: sa[0], value: season }); }
  const su = T.take(bounded(`летн${L}*|летом|лето|summer${L}*`));
  if (su && !sa) matched.push({ kind: "season", text: su[0], value: "summer" });

  // ---- intent ----
  let intent = "card";
  const intents: [string, string][] = [
    ["queue", `провер${L}*|инспекц${L}*|очеред${L}*|inspect${L}*|check${L}*|field\\s+visit${L}*|queue`],
    ["alternatives", `лучше|вместо|альтернатив${L}*|куда\\s+(?:перегнать|перевести)|better|instead|alternative${L}*|where\\s+else`],
    ["trend", `тренд${L}*|динамик${L}*|меня${L}*|изменен${L}*|снижа${L}*|снижен${L}*|растет|рост${L}*|trend${L}*|chang${L}*|declin${L}*|grow${L}*|increas${L}*|decreas${L}*`],
  ];
  for (const [k, src] of intents) {
    const m = T.take(bounded(src));
    if (m) { if (intent === "card") intent = k; matched.push({ kind: "intent", text: m[0], value: k }); }
  }

  // ---- oblast / districts ----
  for (const src of OBLAST) { const m = T.take(bounded(src)); if (m) matched.push({ kind: "oblast", text: m[0], value: "naryn-oblast" }); }
  for (const [slug, pats] of DISTRICTS) {
    for (const src of pats) {
      const m = T.take(bounded(src));
      if (m) {
        if (!filter.district) { filter.district = slug; scope = "district"; }
        else if (filter.district !== slug) notes.push(ru ? `упомянуто несколько районов; взят первый` : `several districts mentioned; using the first`);
        matched.push({ kind: "district", text: m[0], value: slug });
        break;
      }
    }
  }

  // ---- lakes and places ----
  let place: { lat: number; lon: number; label: string; radius: number } | null = null;
  const gazLakes = gaz.filter((g) => g.kind === "lake" || g.kind === "reservoir" || (g as any).class === "lake");
  for (const lk of LAKES) {
    const src = lk.aliases.map((a) => aliasSrc(a)).join("|");
    const m = T.take(bounded(src));
    if (!m) continue;
    const re = bounded(src);
    const g = gazLakes.find((x) => Object.values(x.names ?? { name: x.name }).some((v) => re.test(norm(String(v)))));
    place = g ? { lat: g.lat, lon: g.lon, label: ru ? `озеро ${placeName(g, "ru")}` : `${placeName(g, "en")} lake`, radius: lakeRadius(g) }
      : { lat: lk.lat, lon: lk.lon, label: lk.name[ru ? "ru" : "en"], radius: lk.radius_km };
    if (!g) notes.push(ru ? "координаты озера приблизительные (нет в OSM-справочнике)" : "approximate lake coordinates (not in the OSM gazetteer)");
    matched.push({ kind: "lake", text: m[0], value: lk.key });
    break;
  }
  if (!place && gaz.length) {
    const cs = candidates(gaz);
    for (const c of cs) {
      const m = T.take(c.re);
      if (!m) continue;
      // same name elsewhere? prefer the one in the district the text names, else the first (towns first)
      const same = [...new Set(cs.filter((o) => o.re.source === c.re.source).map((o) => o.g))];
      let g = c.g;
      if (same.length > 1) {
        const inD = filter.district ? same.filter((o) => o.district === filter.district) : [];
        g = inD[0] ?? c.g;
        if (!inD.length) notes.push(ru ? `несколько мест с названием «${placeName(g, lang)}»; взято первое — уточните район или покажите на карте`
          : `several places are called "${placeName(g, lang)}"; using the first. Name the district or show it on the map`);
      }
      place = { lat: g.lat, lon: g.lon, label: placeName(g, lang), radius: 10 };
      matched.push({ kind: "place", text: m[0], value: g.name });
      break;
    }
  }
  if (!place) {
    const m = T.take(bounded(`нарын${L}{0,3}|naryn(?:\\s+(?:town|city))?`));
    if (m) {
      const g = gaz.find((x) => (x.kind === "town" || x.kind === "city") && /^(нарын|naryn)$/u.test(norm(x.name)));
      place = g ? { lat: g.lat, lon: g.lon, label: placeName(g, lang), radius: 10 } : { lat: NARYN_TOWN.lat, lon: NARYN_TOWN.lon, label: NARYN_TOWN.name[ru ? "ru" : "en"], radius: 10 };
      matched.push({ kind: "place", text: m[0], value: "naryn-town" });
    }
  }
  if (place) {
    defaultRadius = place.radius;
    filter.lat = Math.round(place.lat * 1e5) / 1e5; filter.lon = Math.round(place.lon * 1e5) / 1e5;
    filter.radius_km = Math.min(radius ?? defaultRadius, 50);
    if (radius != null && radius > 50) notes.push(ru ? "радиус ограничен 50 км" : "radius capped at 50 km");
    filter.place = place.label;
    placeLabel = place.label;
    scope = filter.district ? "district+place" : "place";
  } else if (radius != null) {
    notes.push(ru ? "радиус без места не учтён" : "radius without a place was ignored");
  }

  // ---- unknown place? (a capitalised word or a word after "near"/"около" that nothing above matched) ----
  const unknown: string[] = [];
  const firstWord = /^\s*[\p{L}-]+/u.exec(T.orig);
  const capsRe = /(?<![\p{L}\d])(\p{Lu}[\p{L}-]{2,})/gu;
  let cm: RegExpExecArray | null;
  while ((cm = capsRe.exec(T.orig))) {
    if (firstWord && cm.index < firstWord[0].length) continue;
    if (STOP_CAPS.has(cm[1].toLowerCase())) continue;
    unknown.push(cm[1]);
  }
  const pm = new RegExp(`(?<![${L}])${PREP}\\s{1,2}([${L}][${L}-]{2,})`, "u").exec(T.low);
  if (pm && !STOP_AFTER_PREP.test(pm[1])) unknown.push(pm[1]);
  if (unknown.length) {
    return { understood: false, parser: "rules", lang, filter, interpreted_as: "", intent, season, scope, matched, notes,
             message: ru ? "Покажите место на карте" : "Show the place on the map", unknown: [...new Set(unknown)] } as Parsed;
  }
  if (!matched.length) {
    return { understood: false, parser: "rules", lang, filter, interpreted_as: "", intent, season, scope, matched, notes,
             message: ru ? "Не понял запрос. Покажите место на карте или назовите район" : "Query not understood. Show the place on the map or name a district" };
  }

  // ---- interpreted_as ----
  const parts: string[] = [];
  if (filter.district) {
    const nm = districtNames[filter.district] ?? DEFAULT_NAMES[filter.district];
    parts.push(ru ? `${nm?.ru ?? filter.district} район` : `${nm?.en ?? filter.district} district`);
  }
  if (placeLabel) parts.push(ru ? `в радиусе ${filter.radius_km} км от: ${placeLabel}` : `within ${filter.radius_km} km of ${placeLabel}`);
  if (!filter.district && !placeLabel) parts.push(ru ? "вся Нарынская область" : "all of Naryn region");
  const fmtM = (v: number) => (ru ? String(v) : v.toLocaleString("en-US"));
  if (filter.elev_min != null && filter.elev_max != null) parts.push(`${fmtM(filter.elev_min)}–${fmtM(filter.elev_max)} ${ru ? "м" : "m"}`);
  else if (filter.elev_min != null) parts.push(ru ? `выше ${filter.elev_min} м` : `above ${fmtM(filter.elev_min)} m`);
  else if (filter.elev_max != null) parts.push(ru ? `ниже ${filter.elev_max} м` : `below ${fmtM(filter.elev_max)} m`);
  parts.push(season === "summer" ? (ru ? "лето (май–сентябрь)" : "summer (May–Sep)") : (ru ? "весна и осень" : "spring and autumn"));
  const intentLabel: Record<string, [string, string]> = {
    queue: ["очередь проверки", "inspection queue"], alternatives: ["альтернативы рядом", "alternatives nearby"], trend: ["динамика", "trend"],
  };
  if (intentLabel[intent]) parts.push(intentLabel[intent][ru ? 0 : 1]);
  return { understood: true, parser: "rules", lang, filter, interpreted_as: parts.join(" · "), intent, season, scope, matched, notes };
}

// ---- top blocks inside the filter (score over the filtered pasture cells of each block) ----
export function topBlocks(d: Data, sel: Sel, intent: string, lang: string, limit = 10) {
  const acc = new Map<number, { s: number; c: number; a: number }>();
  for (const i of sel.idx) {
    if (!d.isPasture(i)) continue;
    const b = d.f.block_id[i];
    const e = acc.get(b) ?? { s: 0, c: 0, a: 0 };
    const sc = d.f.score[i];
    if (Number.isFinite(sc)) { e.s += sc; e.c += 1; }
    e.a += d.f.area_km2[i];
    acc.set(b, e);
  }
  const meta = new Map(d.blocks.map((b: any) => [b.block_id, b]));
  const lt = d.texts[lang]?.labels ?? d.texts.en.labels;
  const thr = d.cfg.level_thresholds;
  let rows = [...acc.entries()].filter(([, e]) => e.c >= 3).map(([bid, e]) => {
    const b: any = meta.get(bid) ?? {};
    const score = e.s / e.c;
    const lvl = score >= thr.suitable ? "suitable" : score >= thr.limited ? "limited" : "low";
    return { bid, score, lvl, dyn: b.dyn_class ?? null, area: e.a, lat: b.lat, lon: b.lon };
  });
  if (intent === "queue") rows = rows.filter((r) => r.dyn === "decline");
  if (intent === "alternatives") rows = rows.filter((r) => r.dyn !== "decline");
  rows.sort((a, b) => b.score - a.score || b.area - a.area);
  return rows.slice(0, limit).map((r) => ({
    sel: `block:${r.bid}`, name: blockName(d, r.bid, lang), score: Math.round(r.score * 10) / 10, level_class: r.lvl,
    level_label: lt.level[r.lvl], dynamics_class: r.dyn, dynamics_label: r.dyn ? lt.dynamics[r.dyn] : null,
    pasture_km2_in_filter: Math.round(r.area * 10) / 10, centroid: r.lat != null ? { lat: r.lat, lon: r.lon } : null,
  }));
}

let GAZ: Promise<GazPlace[]> | null = null;
function gazetteer(base: string): Promise<GazPlace[]> {
  if (!GAZ) {
    GAZ = fetch(`${base}/gazetteer.json`).then((r) => (r.ok ? r.json() : { places: [] }))
      .then((g) => (Array.isArray(g) ? g : g.places ?? []))
      .catch(() => { GAZ = null; return []; });
  }
  return GAZ;
}

export function runQuery(d: Data, text: string, lang: string, gaz: GazPlace[]) {
  const q = parseQuery(text, lang, gaz, d.cfg.district_names);
  if (!q.understood) return { ...q, card: null, blocks: [] };
  if (q.filter.district && !d.district.includes(q.filter.district)) delete q.filter.district;
  const sel = filterSel(d, q.filter, lang, q.interpreted_as);
  const card = buildCard(d, sel, lang, null, q.season);
  if (q.season !== "summer" && !card.extras?.season_variant) {
    q.notes.push(lang === "ru" ? "весенне-осенний вариант ещё не готов; показаны летние значения" : "the spring/autumn variant is not ready yet; summer values shown");
  }
  if (!sel.idx.length) q.notes.push(lang === "ru" ? "под фильтр не попала ни одна ячейка" : "no cells match this filter");
  return { ...q, card, blocks: topBlocks(d, sel, q.intent, lang) };
}

type Ctx = { data: () => Promise<Data>; json: (o: unknown, status?: number) => Response; BASE: string; lang: string };
export async function queryRoute(path: string, req: Request, u: URL, ctx: Ctx): Promise<Response | null> {
  if (path !== "/api/query") return null;
  let text: unknown, lang: unknown;
  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    text = body?.text; lang = body?.lang;
  } else if (req.method === "GET") {
    text = u.searchParams.get("text"); lang = u.searchParams.get("lang");
  } else return ctx.json({ detail: "use POST {text, lang}" }, 405);
  if (typeof text !== "string" || !text.trim()) return ctx.json({ detail: "text is required" }, 422);
  if (text.length > 500) return ctx.json({ detail: "text is too long (max 500 characters)" }, 422);
  const lg = lang === "ru" || lang === "en" ? lang : /[а-яёөүң]/i.test(text) ? "ru" : "en";
  const [d, gaz] = await Promise.all([ctx.data(), gazetteer(ctx.BASE)]);
  return ctx.json(runQuery(d, text, lg, gaz));
}

export { districtName };
