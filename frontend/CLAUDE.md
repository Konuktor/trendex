# TrendeX — project rules for Claude Code

TrendeX is a desktop-first web app for agency analysts in Kyrgyzstan. For any pasture area it gives a plain answer: how good it is relative to other pastures, which direction it is moving, how far that can be trusted, where better options are nearby, and what to do next. The data is satellite-derived (peak-season NDVI, 2000–2025). The pilot covers Naryn oblast plus the Suusamyr valley.

Read this file before every task. If a request conflicts with these rules, ask first.

## Stack

- React 18 + TypeScript (strict) + Vite
- Leaflet 1.9 via `react-leaflet` 4
- Tailwind CSS 3. Put the tokens below in `tailwind.config.ts` and do not use arbitrary colours outside them.
- `react-router-dom` 6 for the routes `/map`, `/trends`, `/queue`, `/methods`
- `zustand` for app state (layer, filters, selection, queue, tour)
- `d3-contour`, `d3-scale`, `d3-shape` for zone polygons and charts. No chart library.
- `@geoman-io/leaflet-geoman-free` for drawing an outline
- `lucide-react` icons, stroke width 1.5
- Vitest + Testing Library for logic and components; Playwright for screenshots and end-to-end checks
- Deploy target: Vercel (static build)

## Reference implementation

`reference/trendex-map-prototype.html` is a working single-file prototype (MapLibre, vanilla JS). It is the source of truth for:
- the sample data generator (`buildData`, `series`, `fit`, the noise functions `H`/`V`, the `YR` weather-year array), which must be ported 1:1 so numbers match the design;
- the answer-card logic (`answer()`): level, trend, confidence, the "why" factors, "this season", "better nearby" and the suggested next step;
- zone selection (`zoneOf`: same class, 4-connected, within 2.3 cells of the clicked cell);
- place naming (`placeName`, `PLACES`), search parsing (`suggestions`) and the copy strings.

Port its logic into typed modules. Do not copy its DOM code.

## Geography and data model

- Analysis grid: 40 × 22 cells, each 0.12° lon × 0.09° lat (about 10 × 10 km), origin at lon 73.6, lat 42.55 (top-left). Cell `(c, r)` centre is `lon = 73.6 + (c + 0.5) * 0.12`, `lat = 42.55 - (r + 0.5) * 0.09`.
- Cells are an internal calculation unit. **Never draw them as squares.** The map shows smoothed zones (see Map rendering).
- Study-area mask: cells whose centre lies inside the real Naryn oblast polygon (geoBoundaries KGZ ADM1). District comes from ADM2 (At-Bashy, Jumgal, Kochkor, Naryn, Ak-Talaa). Suusamyr valley cells are Chüy cells with lon < 74.7 and 41.95 < lat < 42.32.
- Boundary files are stored in the repo at `public/data/kgz-adm1.geojson` and `public/data/kgz-adm2.geojson`. Fetch them once with `scripts/fetch-boundaries.ts` from
  `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/KGZ/ADM1/geoBoundaries-KGZ-ADM1_simplified.geojson` (same for ADM2). Never fetch them at runtime.
- Water: Son-Kul (41.83 N, 75.13 E, semi-axes 15 × 9.5 km) and Chatyr-Kul (40.615 N, 75.30 E, 12 × 5.5 km) are excluded and not drawn as data.
- All pasture figures are **sample data**. Show a small "Sample data" tag in the top bar and in chart captions.
- Keep data access behind `src/data/source.ts` with one interface (`getCells()`, `getSeries(cellIds)`), so a real API can replace the mock later.

```ts
type District = 'NA' | 'AT' | 'JU' | 'KO' | 'AK' | 'SU';
type Level = 'low' | 'moderate' | 'good';
type Trend = 'dec' | 'nr' | 'inc';            // nr = not reliable
type Kind = 'pasture' | 'excluded' | 'nodata';
interface Cell {
  id: string; c: number; r: number; lon: number; lat: number; d: District;
  kind: Kind; why: string; water: boolean;
  pct: number; level: Level; slope: number; trend: Trend; strong: boolean;
  cov: number; seasons: number; conf: 'High' | 'Medium' | 'Low';
}
```

## Visual system (strict)

Premium, calm, precise: think Linear's restraint, Stripe dashboard data clarity, Our World in Data charts, Mapbox Studio map legibility. The interface chrome is white and grey only. **All colour lives in the data**, and colour always means something.

Neutrals (chrome):
| token | hex |
|---|---|
| bg | #FFFFFF |
| surface | #FAFAFA |
| panel | #F5F5F5 |
| hairline | #E5E5E5 |
| border-strong | #D4D4D4 |
| text | #171717 |
| text-2 | #525252 |
| text-3 | #8A8A8A (axis ticks and quiet map labels only; fails WCAG AA for body text) |

Trend layer (diverging, colourblind-safe):
| class | hex |
|---|---|
| decline, steeper (≤ −1.1 %/yr) | #C2410C |
| decline, milder | #FDBA74 |
| not reliable | #D4D4D8 with a #A1A1AA diagonal hatch, so it never relies on colour alone |
| growth, milder | #99D5E0 |
| growth, steeper | #0E7490 |

Level layer (sequential, one hue): low #DCEBD3 · moderate #86C07F · good #2F7D3E.
Excluded #52525B. Not enough data: white with a #A1A1AA dot pattern.
Trend and level are never on the map at the same time.

Type: Inter everywhere, `font-variant-numeric: tabular-nums` for all figures. Sizes 12 / 13 / 14 / 16 / 20 / 28. Weights 400, 500, 600 only. Tracking −0.01em at 20 px and above. Sentence case. All caps only for 11 px section labels with +0.04em tracking.

Layout: 8 px grid. Cards and panels: 8 px radius, 1 px hairline border, no shadow. Shadows only on floating things (tooltip, drawer edge, dropdown), very soft (`0 8px 24px rgba(0,0,0,.08)`). Controls: 6 px radius, 32 px height (44 px on touch). Primary button: solid #171717 with white text. Secondary button: white with a hairline border.

Motion: 150 ms ease on hover, drawer and tooltip. No bounce, no parallax.

Wordmark: "TrendeX" in Inter 600, plain. No glyph, no gradient.

Charts: series line 1.5 px #171717. Trend line dashed in the class colour. 95 % interval as a soft band (light class colour, 45 % opacity). Current season (2025) as one highlighted dot. Use direct labels, not legends. Horizontal gridlines only (#EDEDED). Axis text 12 px #8A8A8A.

## Map rendering (Leaflet)

- Basemap: CARTO Positron without labels (`https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png`), CSS `filter: grayscale(1)` on that pane.
- Terrain: Esri World Hillshade (`https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`) in its own pane, `mix-blend-mode: multiply`, opacity about 0.35.
- Labels: CARTO `light_only_labels` in a pane above the data zones, grayscale.
- Attribution: © OpenStreetMap contributors, © CARTO, Esri, geoBoundaries.
- Zones: for each class, build a binary grid from the cells, upsample ×8, Gaussian blur (σ ≈ 0.26 cell), and run `d3-contour` at 0.45. Convert the contour coordinates from grid to lon/lat and render with `L.geoJSON` (SVG renderer). Hatch and dot fills are SVG `<pattern>` defs injected into the overlay pane's SVG. Neighbouring classes leave a thin natural gap, which is the intended look.
- Filter (matrix cell or district): non-matching cells go into one grey "dim" zone (#E2E2E2, 85 % opacity).
- Selected zone: 2 px #171717 outline on the selected zone polygon. Drawn outline: 2 px #171717 line, 8 % fill; dashed while drawing.
- Oblast boundary: #404040 1.4 px over a white 3.5 px halo. Districts: #737373 0.8 px dashed.
- Click on the map → cell under the cursor → select its zone. Keyboard users reach areas through search.

## Copy rules

- Sentence case, concrete, sober.
- Never use the words "degradation", "cause", "safe" or "allowed".
- Never say "suitable" without "relative".
- Always show "Relative to other pastures in Naryn oblast" under the level/trend chips.
- Always show "Not accounted for: livestock load, land rights, water, roads, forage quality" at the bottom of the answer card.
- The queue banner reads "A prioritisation for field checks, not an instruction."
- Trends page includes "No reliable trend is also a result."
- No lorem ipsum, no marketing language ("unlock", "empower", "supercharge").

## Anti-slop (strict)

No purple or blue-purple gradients, no glow, no glassmorphism or backdrop blur, no emoji, no sparkle or magic-wand icons, no "AI" badges, no hero sections, no three-column icon-and-headline feature grids, no stock illustrations or 3D blobs, no rounded-3xl everywhere, no heavy drop shadows, no oversized empty cards, no decorative gradients on buttons, no colour in the chrome. Icons are never placed in coloured circles. If something is decorative, remove it.

## Accessibility

Real `<button>`, `<a href>` and `<label>` + `<input>` everywhere; never `onClick` on a `div`. Text contrast 4.5:1 (except `text-3` axis ticks). Icon-only buttons get `aria-label`. Matrix cells and district rows are toggle buttons with `aria-pressed`. Charts get `role="img"` plus an `aria-label` that states the slope and the 2025 value.

## Working rules

- Commit after each phase with a clear message.
- After any UI change, run Playwright, take a 1440 × 900 screenshot of the changed route and look at it before saying a phase is done.
- Logic lives in `src/lib/*` with unit tests. Components stay thin.
- Do not add dependencies beyond the stack above without asking.
