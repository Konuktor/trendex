// Browser client for the fully static TrendeX site.
// Same /api contract as the FastAPI reference, answered from static files under `base` plus in-browser compute.
//
//   import { createTrendexApi } from "./trendex-api.mjs";
//   const api = createTrendexApi("/data/v1");          // folder where export/v1 is hosted
//   const card = await api.get("/api/card?sel=district:naryn&lang=ru");
//   const poly = await api.post("/api/card", { type: "polygon", geometry });
//   const res  = await api.fetch("/api/queue.csv?lang=ru");   // raw Response (CSV download)
import { route, setBase } from "./router.ts";

export function createTrendexApi(base: string) {
  const abs = new URL(base, (globalThis as any).location?.href ?? "http://localhost/").href.replace(/\/$/, "");
  setBase(abs);
  const origin = "https://trendex.local";
  const call = (path: string, init?: RequestInit) => route(new Request(origin + (path.startsWith("/") ? path : "/" + path), init));
  const asJson = async (r: Response) => {
    const body = await r.json();
    if (!r.ok) throw Object.assign(new Error(body?.detail ?? `HTTP ${r.status}`), { status: r.status, body });
    return body;
  };
  return {
    base: abs,
    fetch: call,
    get: (path: string) => call(path).then(asJson),
    post: (path: string, body: unknown) =>
      call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }).then(asJson),
  };
}

if (typeof window !== "undefined") (window as any).createTrendexApi = createTrendexApi;
