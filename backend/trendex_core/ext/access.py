"""F16 access and water: straight-line distance from every cell to the nearest road, water and settlement.

Source: one Overpass API query (OpenStreetMap) for the bbox of the cells, cached in data/osm/.
The features are rasterized onto the MODIS sinusoidal grid (padded so features just outside the AOI count),
then scipy's Euclidean distance transform gives per-cell distances in km (cell centre to feature cell centre).

Outputs:
- core.cells: dist_road_km, dist_water_km, dist_settlement_km (saved in cells.parquet)
- core.extra["bin_fields"]: the same arrays (float32) -> cells.bin for the Edge Function
- artifacts/access/gazetteer.json (place names for the text query, F13) -> export/v1/gazetteer.json
- layers: access_road (binned road distance), underused (hypothesis)
- card.extras.access: means over the selection's pasture cells

python -m trendex_core.ext.access --prefetch   # fetch + cache the OSM data for artifacts/cells.parquet
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import time
from pathlib import Path

import numpy as np

from .. import config
from ..core import clean
from ..grid import CELL, X_ORIGIN, Y_ORIGIN, global_rowcol, lonlat_to_xy

log = logging.getLogger("trendex.ext.access")

FEATURE = "access"
OSM_DIR = config.DATA / "osm"
ENDPOINTS = ("https://overpass-api.de/api/interpreter",          # main instance (preferred)
             "https://overpass.kumi.systems/api/interpreter",     # public mirrors of the same API
             "https://overpass.private.coffee/api/interpreter")
USER_AGENT = "trendex-backend"
KM_PER_CELL = CELL / 1000.0
FIELDS = ("dist_road_km", "dist_water_km", "dist_settlement_km")
ROAD_RE = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track)(_link)?$"
PLACE_RE = "^(city|town|village|hamlet)$"
MARGIN_DEG = 0.2      # fetch features this far outside the cells' bbox
PAD = 30              # raster padding in cells (~28 km) so features outside the grid still count
ROAD_EDGES = [1, 3, 5, 10]
ROAD_LABELS = ["< 1 km", "1–3 km", "3–5 km", "5–10 km", "> 10 km"]
UNDERUSED_COLOR = "#7b3294"
NOTE = {"en": "straight-line distance, © OpenStreetMap contributors",
        "ru": "расстояние по прямой, © участники OpenStreetMap"}
UNDERUSED_NOTE = {"en": "Hypothesis: suitable, not declining and farther from settlements than 75% of the oblast's "
                        "pastures. It may be under-used; check in the field.",
                  "ru": "Гипотеза: пригодно, без снижения и дальше от населённых пунктов, чем 75% пастбищ области. "
                        "Возможно, используется мало; нужна проверка на месте."}


# ---------------------------------------------------------------- fetch
def bbox_of(lon: np.ndarray, lat: np.ndarray) -> tuple[float, float, float, float]:
    """(south, west, north, east), widened by MARGIN_DEG and rounded outward to 0.1 deg."""
    s = math.floor((np.nanmin(lat) - MARGIN_DEG) * 10) / 10
    w = math.floor((np.nanmin(lon) - MARGIN_DEG) * 10) / 10
    n = math.ceil((np.nanmax(lat) + MARGIN_DEG) * 10) / 10
    e = math.ceil((np.nanmax(lon) + MARGIN_DEG) * 10) / 10
    return (round(s, 1), round(w, 1), round(n, 1), round(e, 1))


def overpass_query(b: tuple) -> str:
    s, w, n, e = b
    return (f'[out:json][timeout:600][maxsize:1073741824][bbox:{s},{w},{n},{e}];\n'
            f'(\n'
            f'  way["highway"~"{ROAD_RE}"];\n'
            f'  way["waterway"~"^(river|stream)$"];\n'
            f'  way["natural"="water"];\n'
            f'  relation["natural"="water"];\n'
            f'  node["place"~"{PLACE_RE}"];\n'
            f');\n'
            f'out geom qt;\n')


def _cache_path(b: tuple) -> Path:
    s, w, n, e = b
    return OSM_DIR / f"overpass_{s}_{w}_{n}_{e}.json"


def _covers(path: Path, b: tuple) -> bool:
    try:
        s, w, n, e = (float(v) for v in path.stem.split("_")[1:5])
    except ValueError:
        return False
    return s <= b[0] and w <= b[1] and n >= b[2] and e >= b[3]


def cached(b: tuple) -> Path | None:
    if not OSM_DIR.exists():
        return None
    hits = [p for p in OSM_DIR.glob("overpass_*.json") if _covers(p, b)]
    return min(hits, key=lambda p: p.stat().st_size) if hits else None


def fetch_osm(b: tuple, budget_s: float = 1200, network: bool = True) -> dict | None:
    """Cached Overpass result for bbox b, or None. Retries the endpoints with exponential backoff."""
    hit = cached(b)
    if hit is not None:
        log.info("OSM cache hit: %s", hit.name)
        return json.loads(hit.read_text(encoding="utf-8"))
    if not network:
        return None
    import httpx
    q = overpass_query(b)
    t0, wait, k = time.time(), 10.0, 0
    while time.time() - t0 < budget_s:
        url = ENDPOINTS[k % len(ENDPOINTS)]
        k += 1
        try:
            log.info("Overpass %s (attempt %d)", url, k)
            r = httpx.post(url, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=660)
            if r.status_code == 200 and r.content.lstrip().startswith(b"{"):
                osm = r.json()
                remark = str(osm.get("remark") or "")
                if "error" in remark.lower() or "timed out" in remark.lower():
                    raise RuntimeError(f"Overpass remark: {remark[:200]}")
                if not osm.get("elements"):
                    raise RuntimeError("Overpass returned no elements")
                OSM_DIR.mkdir(parents=True, exist_ok=True)
                osm["_trendex"] = {"bbox": list(b), "endpoint": url, "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                   "query_sha": hashlib.sha256(q.encode()).hexdigest()[:12]}
                tmp = _cache_path(b).with_suffix(".tmp")
                tmp.write_text(json.dumps(osm, ensure_ascii=False), encoding="utf-8")
                tmp.rename(_cache_path(b))
                log.info("OSM cached: %d elements, %.1f MB", len(osm["elements"]), _cache_path(b).stat().st_size / 1e6)
                return osm
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:120]!r}")
        except Exception as e:  # noqa: BLE001
            log.warning("Overpass failed (%s); retry in %.0fs", e, wait)
        time.sleep(min(wait, max(0.0, budget_s - (time.time() - t0))))
        wait = min(wait * 2, 120)
    log.error("Overpass: gave up after %.0fs", time.time() - t0)
    return None


# ---------------------------------------------------------------- parse
def _names(tags: dict) -> dict:
    keys = ("name", "name:ru", "name:en", "name:ky", "name:kk", "int_name", "alt_name", "old_name", "official_name")
    return {k: tags[k] for k in keys if tags.get(k)}


def parse(osm: dict) -> dict:
    roads, wlines, wpolys, places, lakes = [], [], [], [], []
    for el in osm.get("elements", []):
        tags = el.get("tags") or {}
        t = el.get("type")
        if t == "node":
            if tags.get("place") and "lat" in el:
                places.append({"names": _names(tags), "lat": el["lat"], "lon": el["lon"], "kind": tags["place"]})
            continue
        if t == "way":
            ring = [(p["lon"], p["lat"]) for p in (el.get("geometry") or []) if p]
            if len(ring) < 2:
                continue
            if tags.get("highway"):
                roads.append(ring)
            elif tags.get("waterway"):
                wlines.append(ring)
            elif tags.get("natural") == "water":
                wlines.append(ring)
                if len(ring) >= 4 and ring[0] == ring[-1]:
                    wpolys.append(ring)
                if tags.get("name"):
                    lakes.append(_lake(tags, ring))
            continue
        if t == "relation" and tags.get("natural") == "water":
            outer = []
            for m in el.get("members") or []:
                ring = [(p["lon"], p["lat"]) for p in (m.get("geometry") or []) if p]
                if len(ring) >= 2:
                    wlines.append(ring)
                    if m.get("role", "outer") == "outer":
                        outer += ring
            if tags.get("name") and outer:
                lakes.append(_lake(tags, outer))
    return {"roads": roads, "water_lines": wlines, "water_polys": wpolys, "places": places, "lakes": lakes}


def _lake(tags: dict, coords: list) -> dict:
    a = np.asarray(coords)
    return {"names": _names(tags), "lon": float(a[:, 0].mean()), "lat": float(a[:, 1].mean()),
            "kind": tags.get("water") or "lake",
            "bbox": [float(a[:, 1].min()), float(a[:, 0].min()), float(a[:, 1].max()), float(a[:, 0].max())]}


# ---------------------------------------------------------------- rasterize + distance
def _padded(grid):
    from rasterio.transform import from_origin
    shape = (grid.H + 2 * PAD, grid.W + 2 * PAD)
    t = from_origin(X_ORIGIN + (grid.col0 - PAD) * CELL, Y_ORIGIN - (grid.row0 - PAD) * CELL, CELL, CELL)
    return shape, t


def _to_sinu(rings: list) -> list:
    if not rings:
        return []
    lens = np.fromiter((len(r) for r in rings), dtype=np.int64, count=len(rings))
    allc = np.concatenate([np.asarray(r, dtype=np.float64) for r in rings])
    x, y = lonlat_to_xy(allc[:, 0], allc[:, 1])
    xy = np.column_stack([x, y])
    return np.split(xy, np.cumsum(lens)[:-1])


def feature_mask(grid, lines: list = (), polys: list = (), points: list = ()) -> np.ndarray:
    """Boolean padded raster: True where a cell touches a feature."""
    import shapely
    from rasterio.features import rasterize
    shape, t = _padded(grid)
    mask = np.zeros(shape, dtype=bool)
    geoms = []
    for xy in _to_sinu(list(lines)):
        if len(xy) >= 2:
            geoms.append(shapely.linestrings(xy))
    for xy in _to_sinu(list(polys)):
        if len(xy) >= 4:
            try:
                geoms.append(shapely.polygons(xy))
            except Exception:  # noqa: BLE001
                pass
    if geoms:
        mask |= rasterize(((g, 1) for g in geoms), out_shape=shape, transform=t, all_touched=True,
                          fill=0, dtype="uint8").astype(bool)
    if len(points):
        p = np.asarray(points, dtype=np.float64)
        x, y = lonlat_to_xy(p[:, 0], p[:, 1])
        row, col = global_rowcol(x, y)
        r, c = row - (grid.row0 - PAD), col - (grid.col0 - PAD)
        ok = (r >= 0) & (r < shape[0]) & (c >= 0) & (c < shape[1])
        mask[r[ok], c[ok]] = True
    return mask


def distance_km(grid, rr: np.ndarray, cc: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Per-cell straight-line distance (km) to the nearest True cell of the padded mask; NaN if there is none."""
    from scipy.ndimage import distance_transform_edt
    if not mask.any():
        return np.full(len(rr), np.nan, dtype=np.float32)
    d = distance_transform_edt(~mask)
    return (d[rr + PAD, cc + PAD] * KM_PER_CELL).astype(np.float32)


# ---------------------------------------------------------------- gazetteer
def gazetteer(core, feats: dict) -> list:
    from ..grid import haversine_km
    lat, lon = core.col("lat"), core.col("lon")
    dist = core.col("district")
    out = []
    for kind_key, rows in (("place", feats["places"]), ("lake", feats["lakes"])):
        for p in rows:
            if not p["names"].get("name"):
                continue
            d = haversine_km(lat, lon, p["lat"], p["lon"])
            i = int(np.argmin(d))
            inside = bool(d[i] <= 2.0)
            di = dist[i] if inside else None
            out.append({"name": p["names"]["name"], "names": p["names"], "lat": round(p["lat"], 5), "lon": round(p["lon"], 5),
                        "kind": p["kind"] if kind_key == "place" else "lake", "class": kind_key,
                        "inside_aoi": inside, "district": di if isinstance(di, str) and di else None,
                        **({"bbox": p["bbox"]} if "bbox" in p else {})})
    rank = {"city": 0, "town": 1, "lake": 2, "reservoir": 2, "village": 3, "hamlet": 4}
    out.sort(key=lambda g: (not g["inside_aoi"], rank.get(g["kind"], 5), g["name"]))
    return out


# ---------------------------------------------------------------- hooks
def _publish(core) -> None:
    """Expose the distance columns to cells.bin (bin_fields) and their metadata to cells.json (bin_meta)."""
    bf = core.extra.setdefault("bin_fields", {})
    for f in FIELDS:
        if f in core.cells:
            bf[f] = core.cells[f].to_numpy(dtype=np.float32)
    meta = core.extra.get("access_meta")
    if meta:
        core.extra.setdefault("bin_meta", {})["access"] = meta


def compute(core, osm: dict, roads_only: bool = False) -> dict:
    feats = parse(osm)
    rr, cc = core.col("r"), core.col("c")
    t0 = time.time()
    core.cells["dist_road_km"] = distance_km(core.grid, rr, cc, feature_mask(core.grid, lines=feats["roads"]))
    if not roads_only:
        core.cells["dist_water_km"] = distance_km(core.grid, rr, cc, feature_mask(core.grid, lines=feats["water_lines"],
                                                                                    polys=feats["water_polys"]))
        pts = [(p["lon"], p["lat"]) for p in feats["places"]]
        core.cells["dist_settlement_km"] = distance_km(core.grid, rr, cc, feature_mask(core.grid, points=pts))
    for k in list(core._cache):
        if isinstance(k, tuple) and k[1] in FIELDS:
            core._cache.pop(k)
    log.info("access distances done in %.1fs (%d roads, %d water lines, %d places)", time.time() - t0,
             len(feats["roads"]), len(feats["water_lines"]), len(feats["places"]))
    return feats


def _settlement_p75(core) -> float | None:
    if "dist_settlement_km" not in core.cells:
        return None
    ref = core.pasture & core.in_region
    v = core.col("dist_settlement_km")[ref]
    v = v[np.isfinite(v)]
    return float(np.percentile(v, 75)) if len(v) else None


def build_step(core, cube=None) -> None:
    b = bbox_of(core.col("lon"), core.col("lat"))
    osm = fetch_osm(b)
    if osm is None:
        log.error("access: no OSM data for bbox %s; feature skipped", b)
        return
    feats = compute(core, osm)
    art = Path(core.extra.get("_art", config.ARTIFACTS)) / "access"
    art.mkdir(parents=True, exist_ok=True)
    gz = gazetteer(core, feats)
    (art / "gazetteer.json").write_text(json.dumps(clean(gz), ensure_ascii=False, indent=0, allow_nan=False), encoding="utf-8")
    src = osm.get("_trendex", {})
    meta = {"source": "OpenStreetMap via Overpass API", "attribution": "© OpenStreetMap contributors (ODbL)",
            "osm_base": (osm.get("osm3s") or {}).get("timestamp_osm_base"), "fetched_at": src.get("fetched_at"),
            "bbox": src.get("bbox") or list(b), "fields": [f for f in FIELDS if f in core.cells],
            "settlement_p75_km": _settlement_p75(core), "method": "straight-line distance on the 1 km grid (cell centre to "
            "nearest cell touching a feature)", "n_roads": len(feats["roads"]), "n_water_lines": len(feats["water_lines"]),
            "n_places": len(feats["places"]), "n_gazetteer": len(gz)}
    (art / "meta.json").write_text(json.dumps(clean(meta), ensure_ascii=False, indent=1, allow_nan=False), encoding="utf-8")
    core.extra["access_meta"] = meta
    core.extra["gazetteer"] = gz
    _publish(core)


def load(core, art_dir) -> None:
    art = Path(art_dir) / "access"
    if (art / "meta.json").exists():
        core.extra["access_meta"] = json.loads((art / "meta.json").read_text(encoding="utf-8"))
    if (art / "gazetteer.json").exists():
        core.extra["gazetteer"] = json.loads((art / "gazetteer.json").read_text(encoding="utf-8"))
    _publish(core)


def available(core) -> bool:
    return "dist_road_km" in core.cells


def card_extra(core, sel, ctx):
    if "dist_road_km" not in core.cells:
        return None
    p = ctx.get("pasture")
    if p is None or not np.any(p):
        return None
    lang = ctx.get("lang", "en")
    out = {}
    for f, key in zip(FIELDS, ("road_km", "water_km", "settlement_km")):
        if f in core.cells:
            v = core.col(f)[p]
            v = v[np.isfinite(v)]
            out[key] = round(float(v.mean()), 1) if len(v) else None
        else:
            out[key] = None
    out["note"] = NOTE.get(lang, NOTE["en"])
    return ("access", out)


def layers(core) -> list:
    if "dist_road_km" not in core.cells:
        return []
    from ..layers import binned, categorical
    seq = config.palette()["continuous"]["sequential"]
    p = core.pasture
    specs = [("access_road", "binned", binned(np.where(p, core.col("dist_road_km"), np.nan), ROAD_EDGES),
              list(zip(ROAD_LABELS, seq)))]
    thr = _settlement_p75(core)
    if thr is not None:
        far = np.nan_to_num(core.col("dist_settlement_km"), nan=-1) > thr
        cond = p & (core.col("level_class") == "suitable") & (core.col("trend_class") != "decline") & far
        vals = np.where(cond, "underused_hypothesis", None)
        specs.append(("underused", "categorical", categorical(vals, ["underused_hypothesis"]),
                      [("underused_hypothesis", UNDERUSED_COLOR)]))
    return specs


def export(core, out_dir) -> None:
    out_dir = Path(out_dir)
    gz = core.extra.get("gazetteer")
    if gz is None:
        return
    meta = core.extra.get("access_meta") or {}
    doc = {"attribution": meta.get("attribution", "© OpenStreetMap contributors (ODbL)"), "osm_base": meta.get("osm_base"),
           "settlement_p75_km": meta.get("settlement_p75_km"), "underused_note": UNDERUSED_NOTE, "places": gz}
    (out_dir / "gazetteer.json").write_text(json.dumps(clean(doc), ensure_ascii=False, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":  # prefetch the OSM cache (so the pipeline build does not wait on Overpass)
    import argparse

    import pandas as pd
    ap = argparse.ArgumentParser()
    ap.add_argument("--cells", default=str(config.ARTIFACTS / "cells.parquet"))
    ap.add_argument("--budget", type=float, default=3600)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    c = pd.read_parquet(a.cells, columns=["lon", "lat"])
    bb = bbox_of(c["lon"].to_numpy(), c["lat"].to_numpy())
    print("bbox", bb)
    res = fetch_osm(bb, budget_s=a.budget)
    print("ok" if res else "FAILED", cached(bb))
