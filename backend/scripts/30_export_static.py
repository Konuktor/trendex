"""Export everything the Supabase deployment serves into export/v1/.

- Static GET responses, produced by calling the local FastAPI app (so they are byte-identical in content):
  meta/overview/trends/queue/methods per language, layers, zones, PNGs, every district and block card (en, ru).
- cells.bin + cells.json: compact per-cell arrays for the Edge Function's dynamic cards (point, polygon, filter, weights).
- ext modules may add files through `export(core, out_dir)`.

python scripts/30_export_static.py [--no-cards]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from api import deps  # noqa: E402
from api.main import app  # noqa: E402
from trendex_core import config, ext  # noqa: E402
from trendex_core.core import clean  # noqa: E402
from trendex_core.formula import COMPONENTS  # noqa: E402

OUT = Path(os.environ.get("TRENDEX_EXPORT", config.ROOT / "export" / "v1"))
LANGS = ("en", "ru")
STATUS_CODES = ["pasture", "insufficient", "water", "snow_ice", "urban", "cropland", "forest", "steep"]
LEVEL_CODES = [None, "suitable", "limited", "low"]
TREND_CODES = [None, "growth", "decline", "unreliable", "insufficient"]


def _codes(values, codes):
    lut = {v: i for i, v in enumerate(codes)}
    return np.array([lut.get(v if v == v else None, 0) for v in values], dtype=np.uint8)


def write_bin(core, out: Path) -> dict:
    c = core.cells
    dist_codes = [None] + list(core.cfg["district_names"])
    fields = []
    blobs = []
    offset = 0

    def add(name, arr):
        nonlocal offset
        arr = np.ascontiguousarray(arr)
        b = arr.tobytes()
        pad = (-len(b)) % 8
        fields.append({"name": name, "dtype": arr.dtype.name, "offset": offset, "length": int(arr.size)})
        blobs.append(b + b"\0" * pad)
        offset += len(b) + pad

    f32 = lambda col: c[col].to_numpy(dtype=np.float32)  # noqa: E731
    for col in ("lat", "lon", "elev_mean", "slope_mean", "area_km2", "score", "valid_frac", "flip_share",
                "green", "cv", "season_len", "s_mean"):
        add(col, f32(col))
    for k in COMPONENTS:
        add(f"pct_{k}", f32(f"pct_{k}"))
    bid = c["block_id"].to_numpy()
    if bid.max() > np.iinfo(np.int32).max:
        raise ValueError("block_id exceeds int32")
    add("block_id", bid.astype(np.int32))
    add("status", _codes(c["status"], STATUS_CODES))
    add("district", _codes(c["district"], dist_codes))
    add("level", _codes(c["level_class"], LEVEL_CODES))
    add("trend", _codes(c["trend_class"], TREND_CODES))
    add("S", core.S.astype(np.float32).ravel())  # float32 keeps Hamed-Rao p-values identical to Python
    for name, arr in core.extra.get("bin_fields", {}).items():  # ext modules (access distances, precip...)
        add(name, np.asarray(arr))
    (out / "cells.bin").write_bytes(b"".join(blobs))

    B = core.blocks
    blocks = [{"block_id": int(b.block_id), "lat": float(b.lat), "lon": float(b.lon), "pasture_km2": float(b.pasture_km2),
               "score": None if not np.isfinite(b.score) else float(b.score), "level_class": b.level_class,
               "dyn_class": b.dyn_class, "pct_green": None if not np.isfinite(b.pct_green) else float(b.pct_green),
               "in_region": bool(b.in_region), "district": b.district} for b in B.itertuples(index=False)]
    cfg = {k: v for k, v in core.cfg.items() if not k.startswith("_")}
    header = clean({"n": core.N, "years": [int(core.years[0]), int(core.years[-1])], "fields": fields,
                    "S_shape": list(core.S.shape), "S_dtype": "float32",
                    "codes": {"status": STATUS_CODES, "district": dist_codes, "level": LEVEL_CODES, "trend": TREND_CODES},
                    "cfg": cfg, "matrix": config.matrix(), "texts": {lang: config.texts(lang) for lang in LANGS},
                    "blocks": blocks, "meta": {k: core.meta.get(k) for k in ("data_mode", "data_version", "config_hash", "computed_at")},
                    "extra": core.extra.get("bin_meta", {})})
    (out / "cells.json").write_text(json.dumps(header, ensure_ascii=False))
    return header


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cards", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    cl = TestClient(app)
    cl.__enter__()
    core = deps.core()

    def get(url, path, binary=False):
        r = cl.get(url)
        if r.status_code != 200:
            print("skip", url, r.status_code)
            return
        p = OUT / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(r.content)

    get("/api/health", "health.json")
    for lang in LANGS:
        for ep in ("meta", "overview", "trends", "queue", "methods"):
            get(f"/api/{ep}?lang={lang}", f"{ep}_{lang}.json")
        get(f"/api/queue.csv?lang={lang}", f"queue_{lang}.csv")
        get(f"/api/trends?variable=precip&lang={lang}", f"precip_trends_{lang}.json")
    get("/api/layers", "layers.json")
    for L in deps.art_json("layers/layers.json"):
        get(L["url"], f"layers/{L['key']}.png")
    for z in ("districts", "blocks"):
        get(f"/api/zones/{z}.geojson", f"zones/{z}.geojson")
    shutil.copy(deps.ART / "summary.json", OUT / "summary.json")

    if not a.no_cards:
        sels = [f"district:{d}" for d in core.cfg["district_names"]] + [f"block:{int(b)}" for b in core.blocks["block_id"]]
        jobs = [(s, lang) for s in sels for lang in LANGS]

        def one(job):
            s, lang = job
            kind, val = s.split(":")
            get(f"/api/card?sel={s}&lang={lang}", f"cards/{kind}/{val}_{lang}.json")
        with ThreadPoolExecutor(8) as ex:
            list(ex.map(one, jobs))
        print(f"cards: {len(jobs)}")

    write_bin(core, OUT)
    for name, _ in ext.run("export", core, OUT):
        print("ext export:", name)
    n = sum(1 for _ in OUT.rglob("*") if _.is_file())
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1e6
    print(f"export: {n} files, {size:.1f} MB in {time.time() - t0:.1f}s -> {OUT}")


if __name__ == "__main__":
    main()
