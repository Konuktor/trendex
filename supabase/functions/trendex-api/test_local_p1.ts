// Local smoke test of the P1 routes (F13 query, F22 capacity, F18 passports, F16 access extras) without Deno:
//   python3 -m http.server 8766 --directory backend/export_b &
//   node --experimental-strip-types --no-warnings test_local_p1.ts http://127.0.0.1:8766/v1
const base = process.argv[2] ?? "http://127.0.0.1:8766/v1";
let handler: (r: Request) => Promise<Response>;
(globalThis as any).Deno = {
  env: { get: (k: string) => (k === "TRENDEX_STORAGE" ? base : undefined) },
  serve: (h: any) => { handler = h; },
};
await import("./index.ts");
const F = "https://x.supabase.co/functions/v1/trendex-api";
let fails = 0;
const FORBIDDEN = /degradat|\bcause|деградац|причин/i;
async function call(method: string, path: string, body?: unknown) {
  const t = Date.now();
  const r = await handler!(new Request(F + path, method === "POST" ? { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}));
  const ct = r.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await r.arrayBuffer());
  const text = ct.includes("json") || ct.includes("csv") ? new TextDecoder().decode(buf) : "";
  return { status: r.status, ct, buf, text, json: ct.includes("json") ? JSON.parse(text) : null, ms: Date.now() - t };
}
function check(name: string, ok: boolean, info = "") {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${info}`);
}

// F13 text query
let r = await call("POST", "/api/query", { text: "покажи летние пастбища Ат-Башинского района выше 2500 м", lang: "ru" });
check("POST /api/query (PRD example)", r.status === 200 && r.json.understood && r.json.filter.district === "at-bashy" && r.json.filter.elev_min === 2500 &&
  r.json.card?.status === "ok" && r.json.blocks.length > 0 && !FORBIDDEN.test(r.text), `${r.ms}ms "${r.json?.interpreted_as}" blocks=${r.json?.blocks?.length}`);
r = await call("POST", "/api/query", { text: "pastures around Son-Kul above 3000 m", lang: "en" });
check("POST /api/query (Son-Kul via OSM gazetteer)", r.status === 200 && r.json.understood && r.json.filter.lat != null && r.json.card?.area?.n_cells > 0 &&
  !r.json.notes.some((n: string) => n.includes("approximate")), `${r.ms}ms "${r.json?.interpreted_as}"`);
r = await call("POST", "/api/query", { text: "пастбища в радиусе 15 км от Баетово" });
check("POST /api/query (village from gazetteer, lang auto)", r.status === 200 && r.json.understood && r.json.lang === "ru" && r.json.filter.radius_km === 15,
  `${r.ms}ms "${r.json?.interpreted_as}"`);
r = await call("GET", "/api/query?text=" + encodeURIComponent("где проверить пастбища Кочкорского района") + "&lang=ru");
check("GET /api/query (inspection intent)", r.status === 200 && r.json.intent === "queue" && r.json.blocks.every((b: any) => b.dynamics_class === "decline"), `${r.ms}ms blocks=${r.json?.blocks?.length}`);
r = await call("POST", "/api/query", { text: "pastures near Atlantis", lang: "en" });
check("POST /api/query (unknown place)", r.status === 200 && r.json.understood === false && r.json.message === "Show the place on the map", r.json?.message);
r = await call("POST", "/api/query", { lang: "en" });
check("POST /api/query (no text) -> 422", r.status === 422);

// F22 capacity
r = await call("POST", "/api/capacity", { sel: "district:naryn", lang: "ru" });
check("POST /api/capacity district", r.status === 200 && r.json.label === "сценарий, не оценка" && r.json.unsourced.length === 5 &&
  r.json.low <= r.json.central && r.json.central <= r.json.high && r.json.inputs.pasture_km2 > 0, `${r.ms}ms ${r.json?.low}/${r.json?.central}/${r.json?.high} ${r.json?.head_unit}`);
r = await call("POST", "/api/capacity", { sel: "point:41.5,75.5,5", assumptions: { u: 0.5, I: { low: 1.8, high: 2.2, source: "test" } } });
check("POST /api/capacity point + overrides", r.status === 200 && !r.json.unsourced.includes("u") && r.json.assumptions.u.central === 0.5 && r.json.label === "scenario, not an estimate",
  `${r.ms}ms unsourced=${r.json?.unsourced}`);
r = await call("POST", "/api/capacity", { type: "polygon", geometry: { type: "Polygon", coordinates: [[[75.4, 41.4], [75.7, 41.4], [75.7, 41.6], [75.4, 41.6], [75.4, 41.4]]] } });
check("POST /api/capacity polygon", r.status === 200 && r.json.central != null, `${r.ms}ms`);
r = await call("POST", "/api/capacity", { sel: "district:naryn", assumptions: { zz: 1 } });
check("POST /api/capacity bad assumption -> 422", r.status === 422, r.json?.detail);

// F18 passports (static files)
r = await call("GET", "/api/passport.pdf?sel=district:naryn&lang=ru");
check("GET /api/passport.pdf district ru", r.status === 200 && r.ct === "application/pdf" && new TextDecoder().decode(r.buf.slice(0, 4)) === "%PDF", `${r.buf.length} bytes`);
const blk = JSON.parse(await (await fetch(`${base}/zones/blocks.geojson`)).text()).features.find((f: any) => f.properties.in_region && f.properties.pasture_km2 > 0)?.properties;
r = await call("GET", `/api/passport.csv?sel=block:${blk?.block_id ?? blk?.id}&lang=en`);
check("GET /api/passport.csv block", r.status === 200 && r.text.includes("year,ndvi_may_sep_mean"), `block:${blk?.block_id ?? blk?.id} ${r.buf.length} bytes`);
r = await call("GET", "/api/passport.pdf?sel=point:41.5,75.5,5");
check("GET /api/passport.pdf point -> 422", r.status === 422);

// F16 access extras: static (Python) and dynamic (TS hook) cards
r = await call("GET", "/api/card?sel=district:at-bashy&lang=ru");
check("static card extras.access", r.json?.extras?.access?.road_km != null, JSON.stringify(r.json?.extras?.access));
r = await call("GET", "/api/card?sel=point:41.5,75.5,10");
check("dynamic card extras.access (TS hook)", r.json?.extras?.access?.road_km != null && /OpenStreetMap/.test(r.json.extras.access.note), JSON.stringify(r.json?.extras?.access));
r = await call("GET", "/api/layers");
check("layers include access_road + underused", ["access_road", "underused"].every((k) => r.json.layers.some((l: any) => l.key === k)));

console.log(fails ? `${fails} P1 smoke checks FAILED` : "all P1 smoke checks pass");
if (fails) process.exit(1);
