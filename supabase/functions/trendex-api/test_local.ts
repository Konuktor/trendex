// Local smoke test of index.ts without Deno: node --experimental-strip-types test_local.ts <static_base_url>
const base = process.argv[2] ?? "http://127.0.0.1:8765/v1";
let handler: (r: Request) => Promise<Response>;
const _unused = {
  env: { get: (k: string) => (k === "TRENDEX_STORAGE" ? base : undefined) },
  serve: (h: any) => { handler = h; },
};
const R = await import("./router.ts"); R.setBase(base); handler = R.route;
const F = "https://x.supabase.co/functions/v1/trendex-api";
const urls = [
  "/api/health", "/api/meta?lang=ru", "/api/overview", "/api/layers", "/api/zones/districts.geojson",
  "/api/card?sel=district:naryn", "/api/card?sel=block:52202566&lang=ru", "/api/card?sel=point:41.5,75.5,5",
  "/api/card?sel=district:naryn&weights=1,0,0,0", "/api/trends?scope=district&id=kochkor", "/api/queue?limit=2",
  "/api/queue.csv?district=at-bashy", "/api/methods?lang=ru", "/api/compare?a=district:naryn&b=district:kochkor",
  "/api/locate?lat=41.5&lon=75.5", "/api/point?lat=41.5&lon=75.5", "/api/card?sel=district:nope", "/api/card?sel=bad",
  "/api/trends?variable=precip", "/api/nope",
];
for (const u of urls) {
  const t = Date.now();
  const r = await handler!(new Request(F + u));
  const body = await r.text();
  console.log(r.status, `${Date.now() - t}ms`.padStart(7), u, body.length, r.status >= 400 ? body.slice(0, 80) : "");
}
const post = async (body: unknown, path = "/api/card") => {
  const r = await handler!(new Request(F + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
  return [r.status, await r.json()] as const;
};
const [s1, c1] = await post({ type: "polygon", geometry: { type: "Polygon", coordinates: [[[75.4, 41.4], [75.7, 41.4], [75.7, 41.6], [75.4, 41.6], [75.4, 41.4]]] } });
console.log("POST polygon", s1, c1.status, c1.area?.pasture_km2);
const [s2, c2] = await post({ weights: { green: 1, stability: 0, season: 0, terrain: 0 } }, "/api/level/recompute");
console.log("POST recompute", s2, c2.changed_share_vs_default, Object.keys(c2.blocks ?? {}).length, "blocks");
