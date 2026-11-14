// F16 access and water: card.extras.access from the per-cell OSM distances in cells.bin
// (dist_road_km, dist_water_km, dist_settlement_km, written by backend/trendex_core/ext/access.py).
// Mirrors access.py card_extra: means over the selection's pasture cells, rounded to 0.1 km.
import { type Data, EXTRA_HOOKS } from "./core.ts";

const FIELDS: [string, string][] = [["dist_road_km", "road_km"], ["dist_water_km", "water_km"], ["dist_settlement_km", "settlement_km"]];
const NOTE: Record<string, string> = {
  en: "straight-line distance, © OpenStreetMap contributors",
  ru: "расстояние по прямой, © участники OpenStreetMap",
};
let registered = false;

export function accessExtra(d: Data, pasture: number[], lang: string): Record<string, any> | null {
  if (!d.f.dist_road_km || !pasture?.length) return null;
  const out: Record<string, any> = {};
  for (const [f, key] of FIELDS) {
    const a = d.f[f];
    if (!a) { out[key] = null; continue; }
    let s = 0, c = 0;
    for (const i of pasture) { const v = a[i]; if (Number.isFinite(v)) { s += v; c++; } }
    out[key] = c ? Math.round((s / c) * 10) / 10 : null;
  }
  out.note = NOTE[lang] ?? NOTE.en;
  return out;
}

export function registerAccess(d: Data) {
  if (registered || !d.f.dist_road_km) return;
  registered = true;
  EXTRA_HOOKS.push((dd, _sel, ctx) => {
    const v = accessExtra(dd, ctx.pasture, ctx.lang);
    return v ? ["access", v] : null;
  });
}
