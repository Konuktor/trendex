// TrendeX API router: the /api contract of backend/api (FastAPI), runtime-neutral.
// Used by (a) the browser bundle (fully static site: trendex-api.js) and (b) the optional Supabase Edge Function (index.ts).
// Static responses are fetched from BASE (the exported data folder); dynamic ones (point/polygon/filter cards,
// weights, compare, locate, recompute, query, capacity) are computed here from cells.json + cells.bin (lazy-loaded).
import { buildCard, classOfScore, Data, filterSel, HttpError, nearest, parseSel, pointSel, polygonSel, recompute } from "./core.ts";
import { registerExtras, routeExtras } from "./extras.ts";

let BASE = "";
export function setBase(base: string) { BASE = base.replace(/\/$/, ""); DATA = null; }
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let DATA: Promise<Data> | null = null;
function data(): Promise<Data> {
  if (!DATA) {
    DATA = (async () => {
      const [h, b] = await Promise.all([
        fetch(`${BASE}/cells.json`).then((r) => { if (!r.ok) throw new Error(`cells.json ${r.status}`); return r.json(); }),
        fetch(`${BASE}/cells.bin`).then((r) => { if (!r.ok) throw new Error(`cells.bin ${r.status}`); return r.arrayBuffer(); }),
      ]);
      const d = new Data(h, b);
      registerExtras(d);
      return d;
    })().catch((e) => { DATA = null; throw e; });
  }
  return DATA;
}

const json = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra } });

async function staticFile(path: string, type = "application/json; charset=utf-8", status404 = "not built yet") {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) return json({ detail: `${path}: ${status404}` }, r.status === 400 || r.status === 404 ? 503 : r.status);
  return new Response(r.body, { status: 200, headers: { ...CORS, "Content-Type": type, "Cache-Control": "public, max-age=300" } });
}
const redirect = (path: string) => new Response(null, { status: 302, headers: { ...CORS, Location: `${BASE}/${path}` } });

function parseWeights(w: string | null): Record<string, number> | null {
  if (!w) return null;
  const keys = ["green", "stability", "season", "terrain"];
  const out: Record<string, number> = { green: 0, stability: 0, season: 0, terrain: 0 };
  const parts = w.split(",");
  parts.forEach((p, i) => {
    const [k, v] = p.includes(":") ? p.split(":") : [keys[i], p];
    if (!keys.includes(k) || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(422, "weights must be 'g,s,se,t' or 'green:0.4,...'");
    out[k] = Number(v);
  });
  if (Object.values(out).reduce((a, b) => a + b, 0) <= 0) throw new HttpError(422, "weights must not all be zero");
  return out;
}
const langOf = (u: URL) => (u.searchParams.get("lang") === "ru" ? "ru" : "en");

async function cardFor(sel: string, lang: string, weights: Record<string, number> | null, season: string) {
  const [kind, val] = [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)];
  if (!weights && season === "summer" && (kind === "district" || kind === "block") && /^[\w-]+$/.test(val)) {
    const r = await fetch(`${BASE}/cards/${kind}/${val}_${lang}.json`);
    if (r.ok) return await r.json();
  }
  const d = await data();
  return buildCard(d, parseSel(d, sel, lang), lang, weights, season);
}

export async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url);
  let path = u.pathname.replace(/^\/(functions\/v1\/)?trendex-api/, "");
  if (!path.startsWith("/api")) path = "/api" + (path === "/" ? "" : path);
  const lang = langOf(u);
  const q = (k: string) => u.searchParams.get(k);

  if (path === "/api" || path === "/api/") return json({ name: "TrendeX API", docs: "see /api/meta, /api/overview, /api/card?sel=district:naryn" });
  if (path === "/api/health") return staticFile("health.json");
  if (["/api/meta", "/api/overview", "/api/methods"].includes(path)) return staticFile(`${path.slice(5)}_${lang}.json`);
  if (path === "/api/layers") {
    const r = await fetch(`${BASE}/layers.json`);
    if (!r.ok) return json({ detail: "layers not built" }, 503);
    const L = await r.json();
    for (const l of L.layers ?? []) l.url = `${BASE}/layers/${l.key}.png`;
    return json(L);
  }
  let m = path.match(/^\/api\/layers\/([\w-]+)\.png$/);
  if (m) return redirect(`layers/${m[1]}.png`);
  m = path.match(/^\/api\/zones\/(districts|blocks)\.geojson$/);
  if (m) return staticFile(`zones/${m[1]}.geojson`, "application/geo+json");
  if (path === "/api/trends") {
    const variable = q("variable") === "precip" ? "precip_trends" : "trends";
    const r = await fetch(`${BASE}/${variable}_${lang}.json`);
    if (!r.ok) return json({ detail: `variable '${q("variable") ?? "ndvi"}' not available yet` }, 503);
    const T = await r.json();
    const scope = q("scope") ?? "all";
    if (scope === "oblast") return json(T.oblast);
    if (scope === "district") {
      const e = (T.districts ?? []).find((x: any) => x.id === q("id"));
      return e ? json(e) : json({ detail: `unknown district ${q("id")}` }, 404);
    }
    return json(T);
  }
  if (path === "/api/queue" || path === "/api/queue.csv") {
    const district = q("district"), level = q("level"), limit = Number(q("limit") ?? 0);
    if (path === "/api/queue.csv" && !district && !level && !limit) return staticFile(`queue_${lang}.csv`, "text/csv; charset=utf-8");
    const r = await fetch(`${BASE}/queue_${lang}.json`);
    if (!r.ok) return json({ detail: "queue not built" }, 503);
    let Z = (await r.json()).filter((z: any) => (!district || z.district === district) && (!level || z.level === level));
    if (limit) Z = Z.slice(0, limit);
    if (path === "/api/queue") return json(Z);
    const cols = ["rank", "zone_id", "district_name", "lat", "lon", "area_km2", "level", "score", "dynamics", "slope_per_decade", "ci_lo", "ci_hi", "confidence", "action"];
    const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [cols.join(","), ...Z.map((z: any) => cols.map((c) => esc(z[c])).join(","))].join("\n");
    return new Response(csv, { headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trendex_inspection_queue_${lang}.csv"` } });
  }
  if (path === "/api/card" && req.method === "GET") {
    const sel = q("sel");
    if (!sel) throw new HttpError(422, "sel is required");
    return json(await cardFor(sel, lang, parseWeights(q("weights")), q("season") ?? "summer"));
  }
  if (path === "/api/card" && req.method === "POST") {
    const body = await req.json().catch(() => { throw new HttpError(422, "invalid JSON body"); });
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
    const better_on = (ca.level?.components ?? []).map((x: any, i: number) => {
      const y = cb.level?.components?.[i];
      return x.percentile != null && y?.percentile != null ? { key: x.key, winner: x.percentile > y.percentile ? "a" : "b", delta: x.percentile - y.percentile } : null;
    }).filter(Boolean);
    return json({ a: ca, b: cb, diff: {
      score_delta: ca.level && cb.level ? ca.level.score - cb.level.score : null,
      pct_per_decade_delta: ca.dynamics?.pct_per_decade != null && cb.dynamics?.pct_per_decade != null ? ca.dynamics.pct_per_decade - cb.dynamics.pct_per_decade : null,
      better_on } });
  }
  if (path === "/api/level/recompute" && req.method === "POST") {
    const body = await req.json();
    const w = parseWeights(Object.entries(body.weights ?? {}).map(([k, v]) => `${k}:${v}`).join(","));
    return json(recompute(await data(), w!));
  }
  if (path === "/api/locate" || path === "/api/point") {
    const lat = Number(q("lat")), lon = Number(q("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(422, "lat and lon are required");
    const d = await data();
    const i = nearest(d, lat, lon);
    if (i < 0) return json({ inside_aoi: false, lat, lon });
    const dist = d.districtOf(i), bid = d.f.block_id[i];
    if (path === "/api/locate") {
      return json({ inside_aoi: true, in_region: !!dist, block_id: bid, district: dist, sel_block: `block:${bid}`,
                    sel_district: dist ? `district:${dist}` : null, sel_point: `point:${lat.toFixed(5)},${lon.toFixed(5)},5` });
    }
    const series = d.years.map((_, y) => { const v = d.s(i, y); return Number.isFinite(v) ? v : null; });
    return json({ inside_aoi: true, district: dist, block_id: bid, status: d.status[d.f.status[i]], elev_mean: d.f.elev_mean[i],
                  slope_mean: d.f.slope_mean[i], score: d.f.score[i], level_class: d.level[d.f.level[i]],
                  trend_class: d.trend[d.f.trend[i]], green: d.f.green[i], valid_frac: d.f.valid_frac[i], series,
                  years: [d.years[0], d.years[d.Y - 1]] });
  }
  const ext = await routeExtras(path, req, u, { data, cardFor, json, staticFile, BASE, lang });
  if (ext) return ext;
  return json({ detail: `not found: ${path}` }, 404);
}

export async function route(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return await handle(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ detail: (e as Error).message }, status);
  }
}

export { classOfScore, pointSel };
