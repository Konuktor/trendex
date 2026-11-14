---
title: TrendeX API
emoji: 🌾
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: NASA-data pasture answers for Naryn region (API)
---

# TrendeX API

Backend for trendex.space: NASA MODIS data on Naryn region pastures (2000–2025) turned into an answer per area.
The answer covers the level (relative suitability), the dynamics (Sen slope + Mann–Kendall), confidence,
alternatives and what to check.

- Interactive docs: `/docs` (OpenAPI at `/openapi.json`)
- Every response carries `data_mode` (`mock` | `real`). Mock data is synthetic and for interface testing only.

## Local
```
uv venv -p 3.11 .venv && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python scripts/00_mock_cube.py                         # synthetic cube (same schema as the real one)
.venv/bin/python -m pipeline.build --cube data/cube_mock --clean # -> artifacts/
.venv/bin/uvicorn api.main:app --reload --port 7860
```
Real data: `python -m pipeline.build --cube hf://TrendeX90/naryn-cube --clean`.

## Central Asia profile (KAZ, KGZ, TJK, TKM, UZB)
Same formula, with deserts (MCD12Q1 barren) excluded. The per-cell exports that don't scale are switched off, and the frontend grid is 0.24°×0.18°. It needs about 64 GB of RAM for ~4.6M cells.
```
export TRENDEX_CONFIG=core_ca.yaml
.venv/bin/python -m pipeline.build --cube hf://TrendeX90/ca-cube --out artifacts_ca --clean --jobs 30
TRENDEX_ARTIFACTS=artifacts_ca TRENDEX_EXPORT=export_ca/v1 .venv/bin/python scripts/30_export_static.py
TRENDEX_ARTIFACTS=artifacts_ca .venv/bin/python scripts/35_export_frontend.py      # -> export/ca/v1/fe (add --sync locally)
```
