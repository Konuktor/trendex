# TrendeX API: guide for the frontend (fully static site)

The site is **fully static**: no server. The backend ships two things.
1. **Data folder `data/v1/`.** This is `backend/export/v1/`: precomputed JSON, GeoJSON, PNG and CSV, every district and block card in en and ru, and `cells.json` + `cells.bin` for on-device calculations. Host it next to the site, for example at `public/data/v1/`.
2. **Client `web-api/trendex-api.mjs`.** It is one ES module of about 70 KB; a minified IIFE build is also available at `trendex-api.min.js`, exposing `window.TrendexApi.createTrendexApi`. It answers the whole `/api/...` contract below from the data folder. For a point, a drawn polygon, custom weights, compare or the text query, it computes the answer in the browser with the same code as the Python reference (31/31 parity tests). The heavy `cells.bin` (~22 MB, ~13 MB gzipped) loads only on the first such call.

```js
import { createTrendexApi } from "./trendex-api.mjs";
const api = createTrendexApi("/data/v1");                      // where data/v1 is hosted
const meta = await api.get("/api/meta?lang=ru");
const card = await api.get("/api/card?sel=district:at-bashy&lang=ru");
const drawn = await api.post("/api/card", { type: "polygon", geometry, lang: "ru" });
const q = await api.post("/api/query", { text: "покажи летние пастбища Ат-Башинского района выше 2500 м", lang: "ru" });
const csv = await (await api.fetch("/api/queue.csv?lang=ru")).blob();   // download
```
`api.get` and `api.post` reject with `{status, body}` for 404 and 422. The working demo is `web-api/demo.html?base=../backend/export/v1`. To try it locally, serve the repo root with `python3 -m http.server`.

The same contract is also served locally by FastAPI (`cd backend && .venv/bin/uvicorn api.main:app --port 7860`, Swagger at `/docs`, schema in [`openapi.json`](openapi.json)). That is useful for debugging; the static client returns the same JSON.

## Two rules for the UI
1. **`data_mode`.** Every card, the overview and `/api/health` carry `data_mode`. It is now `"real"`. If it ever says `"mock"`, show the banner from `/api/meta` → `mock_banner`.
2. **`null` = not ready.** If a block or an `extras.*` field is `null`, hide it. `/api/meta` → `features` lists what is live.

## Selections: `sel=`

| Form | Example | Notes |
|---|---|---|
| district | `district:at-bashy` | Slugs: `at-bashy`, `naryn`, `ak-talaa`, `jumgal`, `kochkor` |
| block (11×11 km cells) | `block:4017` | Ids come from `/api/zones/blocks.geojson` (`properties.id` / `sel`) or `/api/locate` |
| point and radius | `point:41.42,75.98,5` | lat, lon, km (max 50) |
| polygon | `POST /api/card {"type":"polygon","geometry":{GeoJSON Polygon}}` | max 5,000 km² |
| filter | `POST /api/card {"type":"filter","filter":{"district":"at-bashy","elev_min":2500}}` | |

## Endpoints

| Screen | Call | Returns |
|---|---|---|
| any | `GET /api/meta?lang=` | districts with bbox, labels, action texts, matrix, default weights, `features`, `mock_banner` |
| Overview | `GET /api/overview?lang=` | `headline` (shares, `sentence`), 3×3 `matrix`, `districts` (with `precip_trend`), `top_zones`, `decline_zones` |
| Map | `GET /api/layers` | `layers[]`: `{key, url, bounds [[s,w],[n,e]], legend[]}`. Use `L.imageOverlay(url, bounds)`; the first screen is `trend_class`. Layer titles in en/ru come from `/api/meta` → `labels.layers`. Also: `level_class`, `level_score`, `trend_slope`, `season_2025`, `mask`, `matrix`, `confidence`, `precip_trend`, `snow_may`, `level_spring_autumn`, `access_road`, `underused` |
| Map | `GET /api/zones/districts.geojson`, `/api/zones/blocks.geojson` | polygons with `score`, `level_class`, `dynamics_class`, `in_queue` |
| Click | `GET /api/locate?lat=&lon=` | `sel_block`, `sel_district`, `sel_point` |
| Hover | `GET /api/point?lat=&lon=` | one cell plus its yearly series |
| Card | `GET /api/card?sel=…&lang=` (`&weights=0.4,0.2,0.2,0.2`) | **8-block card** (below) |
| Trends | `GET /api/trends?lang=` (`scope=oblast` / `scope=district&id=`), `&variable=precip` | yearly series, `slope_per_decade`, `ci95`, `p_value`, `class`, `monthly_anomaly` |
| Queue | `GET /api/queue?lang=&district=&level=&limit=` / `GET /api/queue.csv?lang=` | ranked zones / CSV |
| Methods | `GET /api/methods?lang=` | steps, frozen config, sensitivity, known places, `placebo`, ML gate and metrics, limitations |
| Compare | `GET /api/compare?a=sel&b=sel` | `{a, b, diff}` |
| Weight sliders | `POST /api/level/recompute {"weights":{…}}` | shares, changed share, per-block `{score, level_class}` to recolour the blocks layer |
| Text query | `POST /api/query {"text","lang"}` | `{understood, filter, interpreted_as, card, blocks}`; if `understood:false`, show `message` |
| Capacity | `POST /api/capacity {"sel","assumptions","lang"}` | `{low, central, high, formula, assumptions, unsourced[], label}`: a scenario, not an estimate. All defaults are placeholders until sourced, so show the `unsourced` list |
| Passport | `GET /api/passport.pdf?sel=district:…\|block:…&lang=` / `.csv` (use `api.fetch` and `.blob()`) | one-page PDF / CSV, districts and in-region blocks only (for a drawn area, use the browser's print) |
| ML | `GET /api/ml/expected?sel=…`, `GET /api/ml/whatif?sel=…`, `GET /api/forecast?sel=district:…` | being built |

## Card: the 8 blocks
```
card.selection   {type, id, sel, name, centroid{lat,lon}, districts[]}
card.status      ok | excluded | insufficient | outside_aoi      (only "ok" has blocks 1–6)
card.area        {total_km2, pasture_km2, excluded_km2{…}, insufficient_km2}
1 card.level       {class, label, score 0–100, class_shares, components[{key,label,percentile,raw,unit}], relative_note}
2 card.dynamics    {class, label, slope_per_decade, ci95[lo,hi], pct_per_decade, p_value, series[{year,value}], fit{intercept,slope}, cell_shares}
3 card.reasons     {pro[{key,text}], con[{key,text}]}
4 card.confidence  {level, label, factors[{key,text}]}
5 card.season      {year, class, label, text, vs_expected (ML; may be null)}
6 card.alternatives {radius_km, items[{sel,name,distance_km,score,level_label,dynamics_label,centroid,reasons[]}], note}
7 card.action      {key, text, note}
8 card.not_considered [text]
card.extras      {precip, season_variant, snow, access, beyond_weather, flags, capacity_hint}  — each {…, text} or null
card.meta        {lang, data_mode, config_hash, weights, computed_at}
```
Trend line: `value(year) = fit.intercept + fit.slope * year`.

## Wording rules (PRD §9)
- Never show "degradation" or "cause".
- "Suitable" is relative to Naryn's pastures; show `level.relative_note`.
- ML what-if wording is "model sensitivity, not a causal effect".
