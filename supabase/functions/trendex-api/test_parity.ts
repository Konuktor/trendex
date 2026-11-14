// node --experimental-strip-types supabase/functions/trendex-api/test_parity.ts
// Compares TS cards with Python reference cards (backend/export/parity_fixture.json).
import { readFileSync } from "node:fs";
import { buildCard, Data, filterSel, parseSel, polygonSel } from "./core.ts";

const EXP = new URL("../../../backend/export/", import.meta.url);
const header = JSON.parse(readFileSync(new URL("v1/cells.json", EXP), "utf8"));
const buf = readFileSync(new URL("v1/cells.bin", EXP));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const d = new Data(header, ab);
const fixture = JSON.parse(readFileSync(new URL("parity_fixture.json", EXP), "utf8"));

let fails = 0;
let textDiffs = 0;
const close = (a: any, b: any, tol: number) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol);
for (const { case: cs, card: py } of fixture) {
  const sel = cs.kind === "sel" ? parseSel(d, cs.sel, cs.lang) : cs.kind === "polygon" ? polygonSel(d, cs.geometry, cs.lang) : filterSel(d, cs.filter, cs.lang);
  const ts = buildCard(d, sel, cs.lang, cs.weights ?? null);
  const errs: string[] = [];
  const chk = (name: string, ok: boolean, a: any, b: any) => { if (!ok) errs.push(`${name}: ts=${JSON.stringify(a)} py=${JSON.stringify(b)}`); };
  chk("status", ts.status === py.status, ts.status, py.status);
  chk("n_cells", ts.area?.n_cells === py.area?.n_cells, ts.area?.n_cells, py.area?.n_cells);
  chk("level", ts.level?.class === py.level?.class, ts.level?.class, py.level?.class);
  chk("score", close(ts.level?.score, py.level?.score, 0.11), ts.level?.score, py.level?.score);
  chk("dyn", ts.dynamics?.class === py.dynamics?.class, ts.dynamics?.class, py.dynamics?.class);
  chk("slope", close(ts.dynamics?.slope_per_decade, py.dynamics?.slope_per_decade, 2e-4), ts.dynamics?.slope_per_decade, py.dynamics?.slope_per_decade);
  chk("p", close(ts.dynamics?.p_value, py.dynamics?.p_value, 0.01), ts.dynamics?.p_value, py.dynamics?.p_value);
  chk("conf", ts.confidence?.level === py.confidence?.level, ts.confidence?.level, py.confidence?.level);
  chk("season", ts.season?.class === py.season?.class, ts.season?.class, py.season?.class);
  chk("action", ts.action?.key === py.action?.key, ts.action?.key, py.action?.key);
  const alt = (c: any) => (c.alternatives?.items ?? []).map((x: any) => x.sel).join(",");
  chk("alts", alt(ts) === alt(py), alt(ts), alt(py));
  const rk = (c: any) => JSON.stringify([(c.reasons?.pro ?? []).map((r: any) => r.key), (c.reasons?.con ?? []).map((r: any) => r.key)]);
  chk("reason keys", rk(ts) === rk(py), rk(ts), rk(py));
  const txt = (c: any) => [...(c.reasons?.pro ?? []), ...(c.reasons?.con ?? [])].map((r: any) => r.text).join("|");
  if (txt(ts) !== txt(py)) textDiffs++;
  chk("name", ts.selection.name === py.selection.name, ts.selection.name, py.selection.name);
  if (errs.length) { fails++; console.log("FAIL", JSON.stringify(cs).slice(0, 90), "\n   " + errs.join("\n   ")); }
}
console.log(`${fixture.length - fails}/${fixture.length} cases match (reason texts differ by rounding in ${textDiffs})`);
if (fails) process.exit(1);
