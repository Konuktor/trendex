"""Frontend contract (frontend/docs/BACKEND_INTEGRATION.md): real data on the frontend's 0.12° x 0.09° grid.

Writes export/v1/fe/{cells.json, meta.json, oblast.geojson, districts.geojson} and, with --sync,
copies them to frontend/public/data/v1/.

How the 10-km cell fields come from our 1-km results (all documented in meta.json → method):
- Study area: grid cells whose centre lies in one of Naryn's 5 official districts (geoBoundaries ADM2), plus
  Suusamyr cells (lon < 74.7, 41.95 < lat < 42.32) that our cube covers.
- kind: pasture if pasture 1-km cells cover ≥ 50% of the grid cell; else nodata if "not enough data" cells
  outweigh excluded ones; else excluded, with `why` from the dominant mask reason.
- series: mean of the pasture 1-km cells' summer (May–Sep) NDVI per year, 2000–2025; rare gaps are filled by
  linear interpolation (option a); `seasons` = mean count of valid summers per 1-km pasture cell.
- pct / level: the TrendeX 4-component level score (greenness, stability, season length, terrain), averaged
  over the grid cell's pasture, ranked among all pasture grid cells; level = thirds of that ranking.
- slope / trend: Theil–Sen slope in % of the mean per year; trend reliable when the Hamed–Rao Mann–Kendall
  p-value passes Benjamini–Hochberg FDR (q < 0.05) across pasture grid cells and seasons ≥ 16.
- conf: Low if cov < 0.6; High if the trend is reliable, cov > 0.78 and the level is stable under other weights;
  else Medium.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import mapping
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trendex_core import config  # noqa: E402
from trendex_core.core import Core, clean  # noqa: E402
from trendex_core.io import boundaries  # noqa: E402
from trendex_core.stats import trend as T  # noqa: E402

LON0, LAT0, DLON, DLAT, COLS, ROWS = 73.6, 42.55, 0.12, 0.09, 40, 22
NY = 26
CODE = {"naryn": "NA", "at-bashy": "AT", "jumgal": "JU", "kochkor": "KO", "ak-talaa": "AK"}
SHAPE = {"naryn": "Naryn", "at-bashy": "At-Bashy", "jumgal": "Jumgal", "kochkor": "Kochkor", "ak-talaa": "Ak-Talaa"}
STRONG_PCT_PER_YEAR = 1.1   # frontend rule: |slope| >= 1.1 %/yr on a reliable trend draws darker
REASONS = ("water", "snow_ice", "urban", "cropland", "forest", "steep", "bare")
WHY = {"snow_ice": "Glacier, snow and bare rock", "steep": "Glacier, snow and steep bare rock",
       "cropland": "Irrigated cropland and settlement", "urban": "Settlement and cropland", "forest": "Forest",
       "bare": "Desert and bare ground"}
PROFILE = {"dataset": "naryn", "out": "v1"}   # replaced from core.cfg["fe"] for other profiles (Central Asia)


def apply_profile(cfg: dict) -> None:
    """Switch grid and naming to the active config profile (core_v1 = Naryn defaults, core_ca = Central Asia)."""
    global LON0, LAT0, DLON, DLAT, COLS, ROWS, PROFILE
    fe = cfg.get("fe")
    if not fe:
        return
    g = fe["grid"]
    LON0, LAT0, DLON, DLAT, COLS, ROWS = g["lon0"], g["lat0"], g["dlon"], g["dlat"], g["cols"], g["rows"]
    PROFILE = {"dataset": fe.get("dataset", "ca"), "out": fe.get("out", "ca/v1"), "cellKm2": g.get("cellKm2")}
LAKES = [("Lake Son-Kul", 41.83, 75.13), ("Lake Chatyr-Kul", 40.615, 75.30)]


def fill_gaps(v: np.ndarray) -> np.ndarray:
    v = v.astype(float).copy()
    ok = np.isfinite(v)
    if ok.sum() == 0:
        return v
    idx = np.arange(len(v))
    v[~ok] = np.interp(idx[~ok], idx[ok], v[ok])
    return v


def land_cover(lc: np.ndarray) -> dict:
    n = max(len(lc), 1)
    share = lambda classes: round(float(np.isin(lc, classes).sum()) / n, 3)  # noqa: E731
    return {"grassland": share([6, 7, 8, 9, 10, 11]), "cropland": share([12, 14]), "settlement": share([13]),
            "water": share([17]), "bare": share([15, 16]), "forest": share([1, 2, 3, 4, 5])}


def build(core: Core) -> tuple[list[dict], dict]:
    lon, lat = core.col("lon"), core.col("lat")
    c_idx = np.floor((lon - LON0) / DLON).astype(int)
    r_idx = np.floor((LAT0 - lat) / DLAT).astype(int)
    inside = (c_idx >= 0) & (c_idx < COLS) & (r_idx >= 0) & (r_idx < ROWS)
    key = np.where(inside, r_idx * COLS + c_idx, -1)
    order = np.argsort(key, kind="stable")
    keys_sorted = key[order]
    st = core.col("status")
    area = core.col("area_km2")
    lc = core.col("lc_major")
    flip = core.col("flip_share")
    nyr = core.col("trend_n")
    score = core.col("score")
    dist_geoms = boundaries.districts_ll() if PROFILE["dataset"] == "naryn" else {}
    for g in dist_geoms.values():
        shapely.prepare(g)

    raw = []
    for k in np.unique(keys_sorted[keys_sorted >= 0]):
        lo_i, hi_i = np.searchsorted(keys_sorted, [k, k + 1])
        mem = order[lo_i:hi_i]
        r, c = divmod(int(k), COLS)
        clon, clat = LON0 + (c + 0.5) * DLON, LAT0 - (r + 0.5) * DLAT
        if PROFILE["dataset"] == "naryn":
            d = next((CODE[s] for s, g in dist_geoms.items() if shapely.contains_xy(g, clon, clat)), None)
            if d is None:
                if not (clon < 74.7 and 41.95 < clat < 42.32):
                    continue
                d = "SU"
        else:  # Central Asia: majority ADM1 region of the member 1-km cells
            dz = [v for v in core.col("district")[mem] if v]
            if len(dz) < 0.5 * len(mem):
                continue
            d = max(set(dz), key=dz.count)
        expected = (DLON * 111.32 * np.cos(np.radians(clat))) * (DLAT * 110.57) / 0.8586
        if len(mem) < 0.5 * expected:   # our cube does not cover enough of this grid cell
            continue
        tot = float(area[mem].sum())
        shares = {s: float(area[mem][st[mem] == s].sum()) / tot for s in ("pasture", "insufficient") + REASONS}
        P = mem[st[mem] == "pasture"]
        cell = {"id": f"{c},{r}", "c": c, "r": r, "lon": round(clon, 4), "lat": round(clat, 4), "d": d,
                **({"country": core.cfg["district_names"].get(d, {}).get("country")} if PROFILE["dataset"] != "naryn" else {}),
                "landCover": land_cover(lc[mem]), "_n1km": int(len(mem))}
        excl_total = sum(shares[s] for s in REASONS)
        if shares["pasture"] >= 0.5 and len(P):
            S = core.S[P].astype(np.float64)
            nv = np.isfinite(S).sum(axis=0)
            with np.errstate(invalid="ignore"):
                ser = np.nanmean(S, axis=0)
            ser[nv < max(1, 0.5 * len(P))] = np.nan
            tr = T.trend_1d(ser, core.years, method=core.cfg["trend"]["method"])
            mean = float(np.nanmean(ser))
            seasons = int(round(float(np.nanmean(nyr[P]))))
            cell.update(kind="pasture", why="", water=False, _score=float(np.nanmean(score[P])),
                        _p=tr["p"], _slope_pct=float(tr["slope"] / mean * 100) if np.isfinite(tr["slope"]) else 0.0,
                        _flip=float(np.mean(flip[P] > 0)), seasons=seasons, cov=round(seasons / NY, 3),
                        series=[round(float(x), 4) for x in fill_gaps(ser)])
        else:
            dom = max(REASONS, key=lambda s: shares[s])
            if shares["insufficient"] > excl_total:
                kind, why = "nodata", "Snow or cloud in most seasons"
            elif dom == "water":
                if PROFILE["dataset"] == "naryn":
                    lake = min(LAKES, key=lambda L: (L[1] - clat) ** 2 + (L[2] - clon) ** 2)[0]
                    kind, why = "excluded", f"Water: {lake}"
                else:
                    kind, why = "excluded", "Water: lake or reservoir"
            else:
                kind, why = "excluded", WHY[dom]
            seasons = int(round(float(np.nanmean(nyr[mem])))) if np.isfinite(nyr[mem]).any() else 0
            cell.update(kind=kind, why=why, water=bool(shares["water"] >= 0.5), seasons=seasons,
                        cov=round(seasons / NY, 3), series=[])
        cell["_shares"] = {k2: round(v, 3) for k2, v in shares.items()}
        raw.append(cell)

    past = [x for x in raw if x["kind"] == "pasture"]
    Ls = np.sort([x["_score"] for x in past])
    q1, q2 = Ls[len(Ls) // 3], Ls[(2 * len(Ls)) // 3]
    q = T.bh_fdr(np.array([x["_p"] for x in past]))
    alpha = core.cfg["trend"]["fdr_q"]
    for x, qv in zip(past, q):
        rel = bool(np.isfinite(qv) and qv < alpha and x["seasons"] >= 16)
        sl = round(x["_slope_pct"], 1)
        trend = ("dec" if sl < 0 else "inc" if sl > 0 else "nr") if rel else "nr"
        x.update(pct=int(round(100 * np.sum(Ls < x["_score"]) / len(Ls))),
                 level="low" if x["_score"] < q1 else "moderate" if x["_score"] < q2 else "good",
                 slope=sl, trend=trend, strong=bool(trend != "nr" and abs(sl) >= STRONG_PCT_PER_YEAR),
                 conf="Low" if x["cov"] < 0.6 else ("High" if trend != "nr" and x["cov"] > 0.78 and x["_flip"] < 0.3 else "Medium"),
                 q_value=float(qv) if np.isfinite(qv) else None, p_value=x["_p"], score=round(x["_score"], 1))
    for x in raw:
        if x["kind"] != "pasture":
            x.update(pct=0, level="low", slope=0.0, trend="nr", strong=False, conf="Low")
    raw.sort(key=lambda x: (x["r"], x["c"]))
    cells = [{k: v for k, v in x.items() if not k.startswith("_")} for x in raw]
    stats = {"n_cells": len(cells), "n_pasture": len(past),
             "kinds": {k: sum(1 for x in cells if x["kind"] == k) for k in ("pasture", "excluded", "nodata")},
             "trend": {k: sum(1 for x in past if x["trend"] == k) for k in ("dec", "inc", "nr")},
             "strong": sum(1 for x in past if x["strong"]),
             "conf": {k: sum(1 for x in past if x["conf"] == k) for k in ("High", "Medium", "Low")},
             "districts": {k: sum(1 for x in cells if x["d"] == k) for k in sorted({x["d"] for x in cells})}}
    return cells, stats


def pick_defaults(cells: list[dict]) -> dict:
    by = {x["id"]: x for x in cells}
    past = [x for x in cells if x["kind"] == "pasture"]
    demo = "3,4" if by.get("3,4", {}).get("kind") == "pasture" else None
    if demo is None:
        dec = sorted([x for x in past if x["trend"] == "dec"], key=lambda x: x["slope"])
        demo = (dec[0] if dec else max(past, key=lambda x: x["pct"]))["id"]
    low = next((x["id"] for x in past if x["conf"] == "Low"), None)
    excl = next((x["id"] for x in cells if x["kind"] == "excluded" and not x["water"]), None)
    return {"defaultCellId": demo, "lowCellId": low, "excludedCellId": excl}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sync", action="store_true", help="copy into frontend/public/data/v1/")
    a = ap.parse_args()
    import os
    core = Core.load(Path(os.environ.get("TRENDEX_ARTIFACTS", config.ARTIFACTS)))
    apply_profile(core.cfg)
    cells, stats = build(core)
    out = config.ROOT / "export" / PROFILE["out"] / "fe"
    out.mkdir(parents=True, exist_ok=True)
    manifest = core.meta.get("manifest", {})
    obl_b = unary_union(list(boundaries.districts_ll().values())).bounds if PROFILE["dataset"] == "naryn" else None
    region_names = {"NA": "Naryn", "AT": "At-Bashy", "JU": "Jumgal", "KO": "Kochkor", "AK": "Ak-Talaa", "SU": "Suusamyr valley"}
    if PROFILE["dataset"] != "naryn":
        from trendex_core.io import regions as R
        ub = R.ca_union().bounds
        title = core.cfg.get("title", {}).get("en", "Central Asia")
        region_list = [{"code": x["code"], "name": x["name"], "country": x["country"], "iso2": x["iso2"],
                        "countryName": x["countryName"]} for x in R.regions()]
    naryn = PROFILE["dataset"] == "naryn"
    meta = {
        "dataset": PROFILE["dataset"],
        "title": "Naryn oblast" if naryn else title,
        "view": {"bounds": [[obl_b[1] - 0.15, obl_b[0] - 0.9], [obl_b[3] + 0.15, obl_b[2] + 0.1]] if naryn
                 else [[ub[1], ub[0]], [ub[3], ub[2]]]},
        "regions": [{"code": k, "name": v, "country": "KGZ", "iso2": "KG", "countryName": "Kyrgyzstan"} for k, v in region_names.items()]
                   if naryn else region_list,
        "regionLabel": {"en": "District", "ru": "Район"} if naryn else {"en": "Region", "ru": "Регион"},
        "boundaryFile": "oblast.geojson" if naryn else "boundary.geojson",
        "regionsFile": "districts.geojson" if naryn else "regions.geojson",
        "dataStatus": "production" if core.meta.get("data_mode") == "real" else "sample",
        "pipelineVersion": f"1.0.0+{core.meta.get('config_hash')}",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "dataComputedAt": core.meta.get("computed_at"),
        "years": [int(core.years[0]), int(core.years[-1])],
        "grid": {"cols": COLS, "rows": ROWS, "lon0": LON0, "lat0": LAT0, "dlon": DLON, "dlat": DLAT,
                 "cellKm2": 100 if naryn else PROFILE.get("cellKm2", 400)},
        "sources": {
            "ndvi": "NASA MODIS MOD13A3 v061 (Terra, monthly 1 km NDVI), LP DAAC",
            "landCover": "NASA MODIS MCD12Q1 v061 (IGBP LC_Type1, 2020), LP DAAC",
            "precip": "NASA GPM IMERG Final V07 monthly, GES DISC",
            "dem": "NASADEM (30 m), LP DAAC",
            "boundaries": ("geoBoundaries gbOpen KGZ ADM2 (5 official Naryn districts)" if PROFILE["dataset"] == "naryn"
                           else "geoBoundaries gbOpen ADM0/ADM1 (KAZ, KGZ, TJK, TKM, UZB)"),
        },
        "method": {
            "series": "Summer (May–Sep) mean NDVI of the pasture 1-km cells in each 10-km cell, 2000–2025; rare gaps interpolated.",
            "level": "TrendeX level score (greenness, year-to-year stability, green-season length, gentle terrain; 1-km "
                     "percentiles, weights 0.4/0.2/0.2/0.2) averaged per 10-km cell; pct = rank among pasture cells; "
                     "level = thirds of that rank.",
            "trend": "Theil–Sen slope (% of mean per year); reliable if Hamed–Rao Mann–Kendall passes Benjamini–Hochberg "
                     "FDR q < 0.05 across pasture cells and ≥ 16 valid summers.",
            "strong": f"reliable and |slope| ≥ {STRONG_PCT_PER_YEAR} %/yr",
            "conf": "Low if cov < 0.6; High if reliable, cov > 0.78 and level stable under alternative weights; else Medium.",
            "kind": "pasture if pasture 1-km cells cover ≥ 50% of the 10-km cell; masks: water, snow/ice, built-up, "
                    "cropland, forest (MCD12Q1) and mean slope > 35°.",
        },
        "stats": stats,
        "cubeManifest": {k: manifest.get(k) for k in ("synthetic", "partial", "datasets", "sources_used") if k in manifest},
        **pick_defaults(cells),
    }
    (out / "cells.json").write_text(json.dumps(clean({"cells": cells}), ensure_ascii=False, separators=(",", ":")))
    (out / "meta.json").write_text(json.dumps(clean(meta), ensure_ascii=False, indent=1))
    if naryn:
        d = boundaries.districts_ll()
        obl = unary_union(list(d.values())).simplify(0.002, preserve_topology=True)
        (out / "oblast.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"shapeName": "Naryn Region"}, "geometry": mapping(obl)}]}))
        (out / "districts.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"shapeName": SHAPE[s], "code": CODE[s]},
             "geometry": mapping(g.simplify(0.002, preserve_topology=True))} for s, g in d.items()]}))
        files = ("cells.json", "meta.json", "oblast.geojson", "districts.geojson")
    else:
        (out / "boundary.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"shapeName": title},
             "geometry": mapping(R.ca_union().simplify(0.02, preserve_topology=True))}]}))
        (out / "regions.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"shapeName": x["name"], "code": x["code"], "country": x["country"]},
             "geometry": mapping(x["geom"].simplify(0.02, preserve_topology=True))} for x in R.regions()]}))
        files = ("cells.json", "meta.json", "boundary.geojson", "regions.geojson")
    print(json.dumps(stats), "defaults:", pick_defaults(cells))
    print("cells.json", round((out / "cells.json").stat().st_size / 1e3), "KB ->", out)
    if a.sync:
        dst = config.ROOT.parent / "frontend" / "public" / "data" / PROFILE["out"]
        dst.mkdir(parents=True, exist_ok=True)
        for f in files:
            shutil.copy(out / f, dst / f)
        print("synced ->", dst)


if __name__ == "__main__":
    main()
