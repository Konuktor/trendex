# TrendeX

Desktop-first web app for agency analysts in Kyrgyzstan: for any pasture area in Naryn oblast and the
Suusamyr valley it says how good it is relative to other pastures, which way it is moving, how far that
can be trusted, where better options are nearby, and what to check next. **All pasture figures are sample data.**

Project rules: [`CLAUDE.md`](CLAUDE.md). Build plan: [`PROMPT.md`](PROMPT.md). Logic reference:
[`reference/trendex-map-prototype.html`](reference/trendex-map-prototype.html).

## Run

Requires Node 20+.

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # unit tests (Vitest), incl. parity with the reference prototype
npx playwright install chromium
npm run e2e              # end-to-end + screenshots at 1440×900 and 390×844 → screenshots/
npm run e2e:build        # same, against the production build
npm run build            # static build in dist/
```

Playwright is pinned to 1.56.1 because newer releases do not ship Chromium for macOS 13.

## Basemap

CLAUDE.md asks for CARTO Positron. CARTO now watermarks tiles requested without a key, so the app uses
CARTO only when `VITE_CARTO_KEY` is set (free key: <https://carto.com/basemaps/apikey>, see `.env.example`).
Without a key it falls back to Esri's keyless World Light Gray Canvas. Both are shown in grayscale.

## Structure

- `src/lib/` – typed logic with unit tests: noise, mask, mock data, series/fit, zones, answer, places,
  stats, trends, queue, checks.
- `src/data/source.ts` – the single data interface (`getCells()`, `getSeries(ids)`); swap for a real API.
- `src/routes/` – `/map`, `/trends`, `/queue`, `/methods`. Screenshot states: `/map?state=excluded|lowConfidence|noData|outside|loading`.
- `public/data/` – geoBoundaries KGZ ADM1/ADM2, fetched once by `npm run fetch-boundaries`.

## Deploy

`vercel.json` builds with `npm run build` and rewrites routes to `index.html`. Not deployed yet.
