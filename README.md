# TrendeX

Pastures of Naryn region (Kyrgyzstan), 2000–2025, from NASA satellite data. For any area it gives a plain answer:
- how good the pasture is relative to others;
- which way it is moving (Sen slope, Mann–Kendall with autocorrelation and multiple-testing control);
- how far that can be trusted;
- what is better nearby;
- what to check next.

NASA Space Apps Challenge 2026, Bishkek.

| Folder | What |
|---|---|
| `frontend/` | React + Vite static site (map, answer card, trends, inspection queue, methods). Reads `public/data/v1/*.json`. |
| `backend/` | Python pipeline: NASA cube → open formula (level × dynamics) → static exports. Local FastAPI reference API. |
| `web-api/` | Browser client (`trendex-api.mjs`) serving the full `/api` contract from static files. |
| `supabase/functions/trendex-api/` | TypeScript port of the card logic (parity-tested with Python); optional Edge Function wrapper. |
| `docs/` | API guide (`API.md`) and OpenAPI schema. |

**Data and model:**
- Data cube (MOD13A3, NASADEM, MCD12Q1, IMERG, GLDAS, LST, snow): https://huggingface.co/datasets/TrendeX90/naryn-cube
- Expected-greenness model: https://huggingface.co/TrendeX90/expected-greenness

**Rebuild:**
```
cd backend && uv venv -p 3.11 .venv && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m pipeline.build --cube hf://TrendeX90/naryn-cube --clean
.venv/bin/python scripts/30_export_static.py         # full static API export
.venv/bin/python scripts/35_export_frontend.py --sync  # frontend grid data -> frontend/public/data/v1
cd ../frontend && npm ci && npm run build            # dist/ = the site
```
