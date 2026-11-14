# Prompt for Claude Code

Paste everything below the line into Claude Code, started in an empty project folder that already holds `CLAUDE.md` and `reference/trendex-map-prototype.html`.

---

Build the TrendeX frontend described in `CLAUDE.md`. Read `CLAUDE.md` and `reference/trendex-map-prototype.html` fully before writing code. Work in the phases below. At the end of each phase: run the tests, run the app, take Playwright screenshots of the changed routes at 1440 × 900, review them against `CLAUDE.md`, fix what is off, then commit. Tell me briefly what you did and show the screenshot paths before moving on.

## Phase 0 — Setup
- Scaffold Vite + React + TS (strict). Add Tailwind with the tokens from `CLAUDE.md` (colours, font sizes, radii, shadow). Load Inter (400/500/600) from Google Fonts.
- Add react-leaflet, leaflet, zustand, react-router-dom, d3-contour, d3-scale, d3-shape, @geoman-io/leaflet-geoman-free, lucide-react, vitest, @testing-library/react and playwright.
- Write `scripts/fetch-boundaries.ts`, run it, and commit `public/data/kgz-adm1.geojson` and `public/data/kgz-adm2.geojson`.
- Build an app shell with a 48 px top bar: wordmark, tabs Map / Trends / Inspection queue / Methods & limits, a "Sample data" tag and a "Demo tour" secondary button. Add routes `/map` (default), `/trends`, `/queue`, `/methods`.

## Phase 1 — Data and logic (no UI)
Port these from the reference into `src/lib/` with full types and unit tests:
- `noise.ts`: `H`, `V`, `YR`.
- `mask.ts`: the study-area mask from the GeoJSON files (Naryn oblast, ADM2 districts, Suusamyr rule, lakes, settlement cells).
- `mock.ts`: `buildData(mask)`, same formulas and the same forced cells. The Suusamyr demo cell `(3,4)` is moderate, reliable decline, −1.1 %/yr, high confidence. The Ak-Sai cell gets coverage 0.5, which makes it low confidence.
- `series.ts`: `series(cell)`, `fit(values)` (OLS slope in %/yr with a 95 % interval).
- `zones.ts`: `classOf(cell, layer)`, `zoneKey`, `zoneOf(anchor, layer)`, plus `buildZoneGeoJSON(cells, layer, filter)`, which does upsample → blur → d3-contour → lon/lat polygons, one feature per class plus a "dim" feature.
- `answer.ts`: `answer(selection)` returning a typed `Answer` (pasture, excluded, no data, outside study area; zone vs drawn outline; the low-confidence banner text; why factors; this season; better nearby; next step). Copy strings exactly from the reference.
- `places.ts`: `PLACES` (Latin and Cyrillic names), `placeName`, and `parseSearch` (place prefix in either script, or "lat, lon" with comma or dot decimals).
- Tests must cover at least: the demo cell answer; an excluded Kochkor zone; a drawn outline of fewer than 3 cells getting lower confidence; `parseSearch("Кочкор")` and `parseSearch("42,15; 74,02")`; zone selection staying within 2.3 cells.

## Phase 2 — Map screen
Layout at 1440 × 900:
- **Left rail, 280 px, surface background:**
  - Layer switch (Trend / Level), a segmented control.
  - A compact legend for the active layer, plus Excluded and Not enough data.
  - **Level × trend matrix (3 × 3).** It is both legend and filter. Each cell shows the share of pasture area in a white pill. Cell colour follows the active layer. The selected filter cell gets a 2 px #171717 ring, and a black dot marks where the selected area falls.
  - **District list.** Each row shows the name, km², % decline and a 64 px stacked bar (decline / not reliable / growth). Clicking a row toggles a district filter.
- **Headline strip, 40 px:** "X% reliable decline · Y% reliable growth · Z% not reliable", the scope with its pasture km², and the active filter as a removable chip.
- **Map:** the panes and styling from `CLAUDE.md`. Fit Naryn oblast on load with right padding for the drawer. Zoom and scale controls go bottom-left.
- **Map toolbar, top-left:**
  - Search box with a suggestion dropdown (floating, soft shadow).
  - "Draw an area" button using Geoman polygon mode. While drawing, show a bar: "Click the map to add corners · N", then Undo, Cancel and "Show answer".
- **Right drawer, 400 px, the answer card**, overlaying the map with a soft left shadow. Order:
  1. Area name and confidence badge (three neutral bars).
  2. LEVEL and TREND chips side by side, with "Relative to other pastures in Naryn oblast" underneath.
  3. A one-sentence takeaway.
  4. Line chart 2000–2025 with trend and interval.
  5. "Why" with 2–3 ± factors.
  6. "This season" mini range.
  7. "Better nearby", up to 3 rows with distance; clicking a row selects that area and flies to it.
  8. "Suggested next step for the agency" with "Add to queue". The added state is "In queue · undo".
  9. The always-visible "Not accounted for" footer.
- **Default selection:** the Suusamyr demo zone, card open.
- Matrix and district filters re-render the zones. The layer switch rebuilds zones by level.

## Phase 3 — States
- **Excluded area card** (not a pasture): reason, land-cover detail, explanation, nearest pastures, and a next step with "Flag mask for review".
- **Low-confidence card:** grey banner at the top of the card with an alert icon.
- **Not enough data** card and **outside the study area** card.
- **Loading skeleton** for the rail matrix, map zones (flat grey) and card (pulsing grey blocks).
- Expose the states at `/map?state=excluded|lowConfidence|loading` for screenshots.

## Phase 4 — Trends (`/trends`)
- Title and scope selector (oblast or a district), plus a "Download CSV" button that really downloads the per-cell table for the scope.
- **Four stat cards:** reliable decline %, reliable growth %, not reliable % (each with km²), and the trend of the scope average with its 95 % interval.
- **Large chart** of the scope average 2000–2025 with trend line and interval band, plus direct labels.
- **Area share by trend class:** three horizontal bars, followed by the line "No reliable trend is also a result." and a short explanation.
- **Level × trend matrix** with % and km² in each cell.
- **District small multiples** sorted by slope. All panels share one y-scale. Each gets a reliable / not reliable tag and a "Set as scope" action.

## Phase 5 — Inspection queue (`/queue`)
- Banner: "A prioritisation for field checks, not an instruction."
- **Filters:** district select, level toggle chips, confidence (Any / High only), and a result count.
- **Table columns:** rank, area (place name, with id and district underneath), level chip, trend chip with slope, pasture km², confidence, one-line reason, and a link that opens the area on the map.
- Score = steepness of decline × level weight (low 1.3, moderate 1.0, good 0.7) × confidence weight (high 1.0, medium 0.8). State the formula under the table.
- Areas added from the map appear here, marked "added from map". Persist the queue in localStorage.
- Export CSV.
- **Empty states:** "Nothing in the queue yet", and "No areas match these filters" with a "Clear filters" button.

## Phase 6 — Methods & limits (`/methods`)
A long, readable page (max 720 px text column) with a left anchor list. Sections:
1. **What we measure.**
2. **How the answer is built:** a flow diagram built from HTML boxes, not an image.
3. **The formula:** level percentile and thirds; Theil–Sen slope in %/yr; reliable means Mann–Kendall p < 0.05 and at least 16 of 26 clear seasons; confidence rules; zones and drawn outlines.
4. **Checks:** a table of known places, expected vs observed. Highlight mismatches with a grey row and a bold "Mismatch".
5. **Data sources and versions:** MODIS MOD13Q1 C6.1, ESA WorldCover v200, CHIRPS v2.0, Copernicus DEM, geoBoundaries, pipeline version.
6. **What this does not know.**
7. **AI use disclosure.**

Take the copy from the reference and the design.

## Phase 7 — Mobile (≤ 768 px)
- The rail collapses into a "Layers" sheet button.
- The answer card becomes a bottom sheet with a grab handle. Collapsed, it shows the name, chips and takeaway. Expanded, it shows everything.
- Search and draw stay at the top. Touch targets are at least 44 px.
- Screenshot at 390 × 844.

## Phase 8 — Demo tour
"Demo tour" steps through:
1. Map overview.
2. Selects Suusamyr and opens the card.
3. Sets the matrix filter to moderate × decline.
4. Points to Methods, with a button that navigates to `/methods`.

Show it as a floating 296 px card with Back / Next / End tour. No modal overlay.

## Phase 9 — Polish and ship
- Accessibility pass: keyboard-only walkthrough of all routes; check contrast against `CLAUDE.md`.
- Performance: rebuild zones only when the layer or filter changes (memoize), so the map stays at 60 fps while panning.
- Run `npm run build`, then a final Playwright run over every route and state at 1440 × 900 and 390 × 844.
- Add `vercel.json` with an SPA rewrite to `index.html`. Do not deploy until I say so.

## Definition of done
- Every phase screenshot matches `CLAUDE.md`: no colour in the chrome, no squares on the map, Inter with tabular numerals, the copy rules met.
- All unit tests and Playwright checks pass.
- The demo cell, the excluded Kochkor zone and the Ak-Sai low-confidence zone give the same answers as the reference prototype.
