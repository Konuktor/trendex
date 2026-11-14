"""TrendeX API. Routers in api/routers/ are auto-discovered: parallel sessions add files, never edit this one."""
from __future__ import annotations

import importlib
import logging
import os
import pkgutil

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse

from . import deps, routers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="TrendeX API", version="1.0",
              description="Naryn pastures 2000–2025 from NASA data: level x dynamics -> answer. "
                          "Every response carries data_mode (mock|real).")

origins = os.environ.get("TRENDEX_CORS", "https://trendex.space,https://www.trendex.space,http://localhost:3000,"
                                         "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins,
                   allow_origin_regex=r"https://.*\.(vercel\.app|netlify\.app|hf\.space|pages\.dev)",
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)

for m in sorted(pkgutil.iter_modules(routers.__path__), key=lambda m: m.name):
    if m.name.startswith("_"):
        continue
    mod = importlib.import_module(f"{routers.__name__}.{m.name}")
    if hasattr(mod, "router"):
        app.include_router(mod.router, prefix="/api")


@app.on_event("startup")
def _startup():
    try:
        deps.core()
    except Exception:  # noqa: BLE001
        logging.getLogger("trendex.api").exception("artifacts not loaded at startup")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/docs")
