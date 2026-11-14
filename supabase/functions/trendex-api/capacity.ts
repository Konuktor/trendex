// F22 capacity scenario: POST /api/capacity {sel | geometry | filter, assumptions?, lang?}
// heads = A_ha × B × u / (I × D), B = a + b × NDVI_peak, as low / central / high. Port of backend/trendex_core/ext/capacity.py.
// Defaults come from capacity.json (exported from backend/configs/capacity.yaml); every unsourced one is named in `unsourced`.
import { buildCard, type Data, filterSel, HttpError, polygonSel } from "./core.ts";

const PARAMS = ["a", "b", "u", "I", "D"] as const;
type P = { low: number; central: number; high: number; heads_effect?: string; source?: string; placeholder?: boolean; [k: string]: any };

function sig(x: number, n = 2): number | null {  // round to n significant digits (no false precision)
  if (!Number.isFinite(x)) return null;
  if (x === 0) return 0;
  const k = Math.floor(Math.log10(Math.abs(x))) - (n - 1);
  const f = 10 ** k;
  return k >= 0 ? Math.round(x / f) * f : Number((Math.round(x / f) * f).toFixed(-k));
}

export function mergeAssumptions(cfg: any, a: Record<string, any> | undefined) {
  const out: Record<string, P> = {};
  const unsourced: string[] = [];
  for (const k of PARAMS) {
    const p: P = { ...cfg.parameters[k] };
    const o = a?.[k];
    if (typeof o === "number" && Number.isFinite(o)) Object.assign(p, { low: o, central: o, high: o, source: "user", placeholder: false });
    else if (o && typeof o === "object") {
      for (const e of ["low", "central", "high"]) if (typeof o[e] === "number" && Number.isFinite(o[e])) p[e] = o[e];
      Object.assign(p, { source: String(o.source || "user"), placeholder: false });
    } else if (o !== undefined) throw new HttpError(422, `assumptions.${k} must be a number or {low, central, high}`);
    if (p.placeholder || !p.source) unsourced.push(k);
    out[k] = p;
  }
  for (const k of Object.keys(a ?? {})) if (!(PARAMS as readonly string[]).includes(k)) throw new HttpError(422, `unknown assumption '${k}' (use ${PARAMS.join(", ")})`);
  if (["I", "D"].some((k) => Math.min(out[k].low, out[k].high, out[k].central) <= 0)) throw new HttpError(422, "I and D must be positive");
  return { P: out, unsourced };
}

export function scenario(card: any, cfg: any, assumptions?: Record<string, any>, lang = "en") {
  const { P, unsourced } = mergeAssumptions(cfg, assumptions);
  const pastureKm2 = card?.area?.pasture_km2 ?? 0;
  const ndvi = card?.dynamics?.mean;
  const A = pastureKm2 * 100;
  const end = (k: string, s: string) => {
    const p = P[k];
    if (s === "central") return p.central;
    const up = (p.heads_effect ?? "up") === "up";
    return (s === "high") === up ? Math.max(p.low, p.high) : Math.min(p.low, p.high);
  };
  const heads: Record<string, number | null> = {}, biomass: Record<string, number | null> = {};
  for (const s of ["low", "central", "high"]) {
    if (!Number.isFinite(ndvi) || !(A > 0)) { heads[s] = biomass[s] = null; continue; }
    const B = Math.max(0, end("a", s) + end("b", s) * ndvi);
    biomass[s] = Math.round(B);
    heads[s] = sig((A * B * end("u", s)) / (end("I", s) * end("D", s)));
  }
  const L = lang === "ru" ? "ru" : "en";
  return {
    label: cfg.label[L], formula: cfg.formula, head_unit: cfg.head_unit[L],
    low: heads.low, central: heads.central, high: heads.high, biomass_kg_dm_ha: biomass,
    inputs: { sel: card?.selection?.sel ?? null, name: card?.selection?.name ?? null, status: card?.status ?? null,
              pasture_km2: pastureKm2, A_ha: A, ndvi_peak: Number.isFinite(ndvi) ? ndvi : null, ndvi_peak_source: cfg.ndvi_peak_source },
    assumptions: P, unsourced, caveats: cfg.caveats[L], data_mode: card?.meta?.data_mode ?? null,
    ...(heads.central == null ? { message: L === "ru" ? "в выбранной области нет пастбищ с данными" : "no pasture with data in this selection" } : {}),
  };
}

let CFG: Promise<any> | null = null;
function capacityCfg(base: string): Promise<any> {
  if (!CFG) {
    CFG = fetch(`${base}/capacity.json`).then((r) => { if (!r.ok) throw new Error(`capacity.json ${r.status}`); return r.json(); })
      .catch((e) => { CFG = null; throw e; });
  }
  return CFG;
}

type Ctx = { data: () => Promise<Data>; cardFor: (sel: string, lang: string, w: any, season: string) => Promise<any>;
             json: (o: unknown, status?: number) => Response; BASE: string; lang: string };
export async function capacityRoute(path: string, req: Request, _u: URL, ctx: Ctx): Promise<Response | null> {
  if (path !== "/api/capacity") return null;
  if (req.method !== "POST") return ctx.json({ detail: "use POST {sel, assumptions?, lang?}" }, 405);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return ctx.json({ detail: "invalid JSON body" }, 422);
  const lang = body.lang === "ru" ? "ru" : body.lang === "en" ? "en" : ctx.lang;
  let cfg: any;
  try { cfg = await capacityCfg(ctx.BASE); } catch (_e) { return ctx.json({ detail: "capacity config not exported yet" }, 503); }
  let card: any;
  if (typeof body.sel === "string" && body.sel) card = await ctx.cardFor(body.sel, lang, null, "summer");
  else if (body.geometry) card = buildCard(await ctx.data(), polygonSel(await ctx.data(), body.geometry, lang), lang);
  else if (body.filter) card = buildCard(await ctx.data(), filterSel(await ctx.data(), body.filter, lang), lang);
  else return ctx.json({ detail: "sel (or geometry / filter) is required" }, 422);
  return ctx.json(scenario(card, cfg, body.assumptions, lang));
}
