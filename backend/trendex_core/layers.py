"""Render per-cell layers to EPSG:3857 RGBA PNGs for Leaflet / MapLibre image overlays."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.warp import Resampling, calculate_default_transform, reproject

from . import config
from .grid import SINU

_3857_to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)


def _hex(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def render(core, codes: np.ndarray, colors: list[str], out_png: Path, res_m: float = 800.0) -> list:
    """codes: per-cell int (0 = transparent, 1..k = colors[k-1]). Returns Leaflet bounds [[s,w],[n,e]]."""
    g = core.grid
    src = np.zeros((g.H, g.W), dtype=np.uint8)
    src[core.col("r"), core.col("c")] = codes.astype(np.uint8)
    t = g.transform
    left, top = t.c, t.f
    right, bottom = left + g.W * t.a, top + g.H * t.e
    dst_t, w, h = calculate_default_transform(SINU, "EPSG:3857", g.W, g.H, left, bottom, right, top, resolution=res_m)
    dst = np.zeros((h, w), dtype=np.uint8)
    reproject(src, dst, src_transform=t, src_crs=SINU, dst_transform=dst_t, dst_crs="EPSG:3857",
              resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
    lut = np.zeros((256, 4), dtype=np.uint8)
    for i, c in enumerate(colors, 1):
        lut[i] = _hex(c)
    Image.fromarray(lut[dst], "RGBA").save(out_png, optimize=True)
    x0, y1 = dst_t.c, dst_t.f
    x1, y0 = x0 + w * dst_t.a, y1 + h * dst_t.e
    (w_lon, s_lat), (e_lon, n_lat) = _3857_to_ll.transform(x0, y0), _3857_to_ll.transform(x1, y1)
    return [[s_lat, w_lon], [n_lat, e_lon]]


def categorical(values: np.ndarray, keys: list[str]) -> np.ndarray:
    codes = np.zeros(len(values), dtype=np.uint8)
    for i, k in enumerate(keys, 1):
        codes[values == k] = i
    return codes


def binned(values: np.ndarray, edges: list[float]) -> np.ndarray:
    codes = np.zeros(len(values), dtype=np.uint8)
    ok = np.isfinite(values)
    codes[ok] = (np.digitize(values[ok], edges) + 1).astype(np.uint8)
    return codes


def build_all(core, out_dir: Path, extra_specs: list | None = None) -> dict:
    """Build the core layers (plus extra specs from ext modules). Writes PNGs + layers.json."""
    pal = config.palette()
    out_dir.mkdir(parents=True, exist_ok=True)
    reg = core.in_region
    st = core.col("status")
    p = st == "pasture"
    specs = []
    tc = np.where(p | (st == "insufficient"), core.col("trend_class"), None)
    specs.append(("trend_class", "categorical", categorical(tc, list(pal["trend_class"])), list(pal["trend_class"].items())))
    lc = np.where(p, core.col("level_class"), None)
    specs.append(("level_class", "categorical", categorical(lc, list(pal["level_class"])), list(pal["level_class"].items())))
    seq = pal["continuous"]["sequential"]
    sc_edges = [20, 40, 60, 80]
    specs.append(("level_score", "binned", binned(np.where(p, core.col("score"), np.nan), sc_edges),
                  list(zip(["0–20", "20–40", "40–60", "60–80", "80–100"], seq))))
    div = pal["continuous"]["diverging"]
    sl_edges = [-15, -7.5, -2.5, 2.5, 7.5, 15]
    specs.append(("trend_slope", "binned", binned(np.where(p, core.col("trend_pct_decade"), np.nan), sl_edges),
                  list(zip(["< −15%", "−15…−7.5%", "−7.5…−2.5%", "±2.5%", "2.5…7.5%", "7.5…15%", "> 15%"], div))))
    ss = np.where(p, core.col("season_class"), None)
    specs.append((f"season_{int(core.years[-1])}", "categorical", categorical(ss, list(pal["season_class"])), list(pal["season_class"].items())))
    mk = np.where(p, None, st)
    specs.append(("mask", "categorical", categorical(mk, list(pal["mask"])), list(pal["mask"].items())))
    combo = np.array([f"{a}|{b}" if a and b in ("growth", "decline", "unreliable") else None
                      for a, b in zip(lc, core.col("trend_class"))], dtype=object)
    specs.append(("matrix", "categorical", categorical(combo, list(pal["matrix"])), list(pal["matrix"].items())))
    cconf = np.where(p, np.where((core.col("valid_frac") < core.cfg["confidence"]["min_valid_frac"]) & (core.col("flip_share") > 0), "low",
                                 np.where((core.col("valid_frac") < core.cfg["confidence"]["min_valid_frac"]) | (core.col("flip_share") > 0), "medium", "high")), None)
    specs.append(("confidence", "categorical", categorical(cconf, list(pal["confidence"])), list(pal["confidence"].items())))
    specs += extra_specs or []

    meta = []
    for key, kind, codes, legend in specs:
        bounds = render(core, codes, [c for _, c in legend], out_dir / f"{key}.png",
                        res_m=float(core.cfg.get("layers", {}).get("res_m", 800)))
        meta.append({"key": key, "kind": kind, "url": f"/api/layers/{key}.png", "bounds": bounds, "crs": "EPSG:3857",
                     "legend": [{"value": k, "color": c} for k, c in legend]})
    (out_dir / "layers.json").write_text(json.dumps(meta, indent=1))
    return {"layers": meta}
