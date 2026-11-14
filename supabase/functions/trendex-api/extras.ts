// P1 extension seam for the Edge Function (mirrors backend/trendex_core/ext/).
// - registerExtras(d): push card extra hooks into EXTRA_HOOKS (e.g. access distances, precip trend, flags)
// - routeExtras(path, ...): extra endpoints (/api/query, /api/capacity, /api/ml/*, /api/forecast, /api/passport.*)
// Parallel sessions add their code in separate files and register it here (one import + one line each).
import type { Data } from "./core.ts";

type Ctx = {
  data: () => Promise<Data>;
  cardFor: (sel: string, lang: string, w: Record<string, number> | null, season: string) => Promise<any>;
  json: (o: unknown, status?: number, h?: Record<string, string>) => Response;
  staticFile: (path: string, type?: string) => Promise<Response>;
  BASE: string;
  lang: string;
};
type Route = (path: string, req: Request, u: URL, ctx: Ctx) => Promise<Response | null> | Response | null;

const ROUTES: Route[] = [];
const REGISTRARS: ((d: Data) => void)[] = [];

export function addRoute(r: Route) { ROUTES.push(r); }
export function addRegistrar(f: (d: Data) => void) { REGISTRARS.push(f); }

export function registerExtras(d: Data) {
  for (const f of REGISTRARS) { try { f(d); } catch (e) { console.error("extra registrar failed", e); } }
}

export async function routeExtras(path: string, req: Request, u: URL, ctx: Ctx): Promise<Response | null> {
  for (const r of ROUTES) {
    const res = await r(path, req, u, ctx);
    if (res) return res;
  }
  // static per-selection products precomputed in Python (ML expected greenness, forecast replay, passports)
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

// ---- register P1 modules below (one import + call each) ----
import { registerAccess } from "./access.ts";        // F16 access and water -> card.extras.access
addRegistrar(registerAccess);
import { queryRoute } from "./query.ts";              // F13 text query -> POST /api/query
addRoute(queryRoute);
import { registerAExtras } from "./a_ext.ts";        // F23 precip, F14 spring-autumn + snow -> card.extras
addRegistrar(registerAExtras);
import { capacityRoute } from "./capacity.ts";        // F22 capacity scenario -> POST /api/capacity
addRoute(capacityRoute);
