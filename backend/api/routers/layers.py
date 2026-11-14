"""/layers list and PNGs (F7); /layers/level_class.png?weights= re-renders with custom weights (F18)."""
import io
import tempfile
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from trendex_core import config, formula, layers as L

from .. import deps

router = APIRouter(tags=["layers"])


@router.get("/layers")
def list_layers():
    c = deps.core()
    return {"data_mode": c.meta.get("data_mode"), "default": "trend_class", "layers": deps.art_json("layers/layers.json")}


@router.get("/layers/{key}.png", responses={200: {"content": {"image/png": {}}}})
def layer_png(key: str, weights: str | None = Query(None)):
    if weights and key == "level_class":
        c = deps.core()
        w = deps.parse_weights(weights)
        s = formula.score_from_pct(c.pct(), w)
        cls = formula.level_class(s, c.cfg["level_thresholds"])
        cls = np.where(c.pasture, cls, None)
        pal = config.palette()["level_class"]
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "x.png"
            L.render(c, L.categorical(cls, list(pal)), list(pal.values()), out)
            return Response(out.read_bytes(), media_type="image/png")
    p = deps.ART / "layers" / f"{key}.png"
    if not p.exists() or "/" in key or ".." in key:
        raise HTTPException(404, f"unknown layer {key}")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "public, max-age=600"})
