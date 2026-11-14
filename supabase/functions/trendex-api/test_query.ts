// Golden test for the rules-only text query (F13): node --experimental-strip-types --no-warnings test_query.ts
// The fixture gazetteer holds real OSM entries (names, coordinates) copied from the Overpass response.
import { existsSync, readFileSync } from "node:fs";
import { type GazPlace, parseQuery, runQuery } from "./query.ts";
import { Data } from "./core.ts";

const GAZ: GazPlace[] = [
  { name: "Нарын", names: { name: "Нарын", "name:ru": "Нарын", "name:en": "Naryn", "name:ky": "Нарын" }, lat: 41.4286, lon: 75.9976, kind: "city", inside_aoi: true, district: "naryn" },
  { name: "Баетов", names: { name: "Баетов", "name:ru": "Баетово", "name:en": "Baetov", "name:ky": "Баетов", int_name: "Bayetov" }, lat: 41.267, lon: 74.9609, kind: "village", inside_aoi: true, district: "ak-talaa" },
  { name: "Чаек", names: { name: "Чаек", "name:ru": "Чаек", "name:en": "Chaek" }, lat: 41.9266, lon: 74.5165, kind: "village", inside_aoi: true, district: "jumgal" },
  { name: "Ат-Башы", names: { name: "Ат-Башы", "name:ru": "Ат-Баши", "name:en": "At-Bashy" }, lat: 41.1693, lon: 75.8088, kind: "village", inside_aoi: true, district: "at-bashy" },
  { name: "Достук", names: { name: "Достук", "name:ru": "Достук", "name:en": "Dostuk", alt_name: "Кызыл-Аскер" }, lat: 41.3765, lon: 75.6397, kind: "village", inside_aoi: true, district: "naryn" },
  { name: "Кара-Суу", names: { name: "Кара-Суу", "name:ru": "Кара-Суу", "name:en": "Kara-Suu" }, lat: 41.424, lon: 74.0274, kind: "hamlet", inside_aoi: true, district: null },
  { name: "Кара-Суу", names: { name: "Кара-Суу", "name:ru": "Кара-Суу", "name:en": "Kara-Suu" }, lat: 42.1942, lon: 75.8159, kind: "village", inside_aoi: true, district: "kochkor" },
  { name: "Бишкек", names: { name: "Бишкек", "name:ru": "Бишкек", "name:en": "Bishkek" }, lat: 42.8761, lon: 74.6037, kind: "city", inside_aoi: false, district: null },
  { name: "Соң-Көл", names: { name: "Соң-Көл", "name:ru": "Сон-Куль", "name:en": "Song-Kul", int_name: "Soŋ-Köl" }, lat: 41.84239, lon: 75.165, kind: "lake", inside_aoi: true, district: "kochkor", bbox: [41.759, 75.00875, 41.9237784, 75.3376955] },
  { name: "Чатыр-Көл", names: { name: "Чатыр-Көл", "name:ru": "Чатыр-Куль", "name:en": "Chatyr-Köl" }, lat: 40.62257, lon: 75.31049, kind: "lake", inside_aoi: true, district: "at-bashy", bbox: [40.5745994, 75.1586079, 40.7099059, 75.4027104] },
];
const SONKUL = { lat: 41.84239, lon: 75.165 };

type Case = [string, string, Record<string, any> | null, { intent?: string; season?: string; label?: RegExp }?];
const CASES: Case[] = [
  // PRD example
  ["ru", "покажи летние пастбища Ат-Башинского района выше 2500 м", { district: "at-bashy", elev_min: 2500 }, { season: "summer", label: /Ат-Башинский район · выше 2500 м · лето/ }],
  ["en", "summer pastures in At-Bashy district above 2500 m", { district: "at-bashy", elev_min: 2500 }, { season: "summer", label: /At-Bashy district · above 2,500 m/ }],
  ["ru", "пастбища Кочкорского района ниже 3000 м", { district: "kochkor", elev_max: 3000 }],
  ["en", "Kochkor pastures below 3,000 m", { district: "kochkor", elev_max: 3000 }],
  ["ru", "Жумгальский район от 2000 до 3000 м", { district: "jumgal", elev_min: 2000, elev_max: 3000 }],
  ["en", "Jumgal district between 2000 and 3000 m", { district: "jumgal", elev_min: 2000, elev_max: 3000 }],
  ["ru", "Ак-Талинский район", { district: "ak-talaa" }],
  ["en", "Ak-Talaa", { district: "ak-talaa" }],
  ["ru", "Нарынский район выше 2800 м", { district: "naryn", elev_min: 2800 }],
  ["ru", "пастбища вокруг Сон-Куля", { ...SONKUL, radius_km: 21 }, { label: /озеро Сон-Куль/ }],
  ["en", "Song-Kol lake within 15 km", { ...SONKUL, radius_km: 15 }],
  ["ru", "Сонкёль летом", { ...SONKUL, radius_km: 21 }, { season: "summer" }],
  ["ru", "пастбища в радиусе 20 км от Баетово", { lat: 41.267, lon: 74.9609, radius_km: 20 }, { label: /Баетово/ }],
  ["en", "pastures within 5 km of Chaek", { lat: 41.9266, lon: 74.5165, radius_km: 5 }],
  ["ru", "где проверить пастбища в Ат-Башинском районе", { district: "at-bashy" }, { intent: "queue" }],
  ["en", "where are better pastures instead of Dostuk", { lat: 41.3765, lon: 75.6397, radius_km: 10 }, { intent: "alternatives" }],
  ["ru", "тренд зелени в Жумгальском районе", { district: "jumgal" }, { intent: "trend" }],
  ["ru", "весенние пастбища Кочкорского района", { district: "kochkor" }, { season: "spring_autumn" }],
  ["en", "pastures above 3000 m", { elev_min: 3000 }, { label: /all of Naryn region/ }],
  ["ru", "в Нарыне ниже 2500 м", { lat: 41.4286, lon: 75.9976, radius_km: 10, elev_max: 2500 }],
  ["ru", "Кара-Суу в Кочкорском районе", { district: "kochkor", lat: 42.1942, lon: 75.8159, radius_km: 10 }],
  ["ru", "Нарынская область выше 3000 м", { elev_min: 3000 }],
  ["en", "Chatyr-Kul lake", { lat: 40.62257, lon: 75.31049, radius_km: 18 }],
  ["en", "which pastures in Naryn district are declining?", { district: "naryn" }, { intent: "trend" }],
  // unknown places -> "show the place on the map"
  ["en", "pastures near Atlantis", null],
  ["ru", "пастбища около Москвы", null],
  ["en", "pastures near Bishkek", null],
  ["ru", "покажи пастбища", null],
];

const KEYS = ["district", "lat", "lon", "radius_km", "elev_min", "elev_max"];
let fails = 0;
for (const [lang, text, want, extra] of CASES) {
  const q = parseQuery(text, lang, GAZ);
  const errs: string[] = [];
  if (want === null) {
    if (q.understood) errs.push(`expected understood=false, got filter ${JSON.stringify(q.filter)}`);
    else if (!/карте|map/.test(q.message ?? "")) errs.push(`message: ${q.message}`);
  } else {
    if (!q.understood) errs.push(`not understood: ${q.message} ${JSON.stringify((q as any).unknown)}`);
    for (const k of KEYS) {
      const a = (q.filter as any)[k], b = want[k];
      if (!(a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-4))) errs.push(`${k}: got ${a} want ${b}`);
    }
    if (extra?.intent && q.intent !== extra.intent) errs.push(`intent: got ${q.intent} want ${extra.intent}`);
    if (extra?.season && q.season !== extra.season) errs.push(`season: got ${q.season} want ${extra.season}`);
    if (extra?.label && !extra.label.test(q.interpreted_as)) errs.push(`interpreted_as: ${q.interpreted_as}`);
  }
  if (errs.length) { fails++; console.log(`FAIL [${lang}] ${text}\n   ${errs.join("\n   ")}`); }
  else console.log(`ok   [${lang}] ${text}  ->  ${q.understood ? q.interpreted_as : q.message}`);
}

// end to end on exported data (if present): card + blocks
const EXP = new URL("../../../backend/export_b/v1/", import.meta.url);
if (existsSync(new URL("cells.json", EXP))) {
  const buf = readFileSync(new URL("cells.bin", EXP));
  const d = new Data(JSON.parse(readFileSync(new URL("cells.json", EXP), "utf8")), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const t = Date.now();
  const r: any = runQuery(d, "покажи летние пастбища Ат-Башинского района выше 2500 м", "ru", GAZ);
  const ok = r.understood && r.card?.status === "ok" && r.card.selection.name === r.interpreted_as && r.blocks.length > 0 &&
    r.blocks.every((b: any) => b.sel.startsWith("block:")) && r.card.area.n_cells > 0;
  console.log(`${ok ? "ok  " : "FAIL"} runQuery on export_b: status=${r.card?.status} cells=${r.card?.area?.n_cells} blocks=${r.blocks.length} ${Date.now() - t}ms`);
  if (!ok) fails++;
  const q2: any = runQuery(d, "где проверить пастбища в Кочкорском районе", "ru", GAZ);
  if (!q2.blocks.every((b: any) => b.dynamics_class === "decline")) { fails++; console.log("FAIL queue intent returned non-declining blocks"); }
}
console.log(`${CASES.length - fails}/${CASES.length} query cases pass`);
if (fails) process.exit(1);
