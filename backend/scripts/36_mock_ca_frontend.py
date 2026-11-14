"""SAMPLE Central Asia dataset in the frontend contract, for frontend development only (dataStatus = "sample").

Writes frontend/public/data/ca/v1/{cells.json, meta.json, boundary.geojson, regions.geojson} on the CA
overview grid (0.24° x 0.18°, about 20 x 20 km). The real CA export replaces these files with the same names.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from shapely.geometry import mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trendex_core import config  # noqa: E402
from trendex_core.io import regions as R  # noqa: E402

GRID = {"lon0": 46.4, "lat0": 55.5, "dlon": 0.24, "dlat": 0.18}
GRID["cols"] = int(np.ceil((87.4 - GRID["lon0"]) / GRID["dlon"]))
GRID["rows"] = int(np.ceil((GRID["lat0"] - 35.0) / GRID["dlat"]))


def main(out: Path):
    rng = np.random.default_rng(3)
    c, r = np.meshgrid(np.arange(GRID["cols"]), np.arange(GRID["rows"]))
    c, r = c.ravel(), r.ravel()
    lon = GRID["lon0"] + (c + 0.5) * GRID["dlon"]
    lat = GRID["lat0"] - (r + 0.5) * GRID["dlat"]
    reg = R.assign(lon, lat)
    keep = reg != None  # noqa: E711
    c, r, lon, lat, reg = c[keep], r[keep], lon[keep], lat[keep], reg[keep]
    n = len(c)
    # smooth synthetic fields
    green = 0.5 + 0.35 * np.sin(lat / 3.1) * np.cos(lon / 4.7) + rng.normal(0, 0.08, n)
    slope = 1.2 * np.sin(lon / 2.3 + lat / 1.7) + rng.normal(0, 0.5, n)
    desert = (lat < 45) & (lon < 66) & (green < 0.45)
    kind = np.where(desert, "excluded", "pasture")
    years = np.arange(2000, 2026)
    order = np.argsort(green[kind == "pasture"])
    pct = np.zeros(n, dtype=int)
    pidx = np.flatnonzero(kind == "pasture")
    pct[pidx[order]] = np.round(100 * np.arange(len(order)) / max(len(order), 1)).astype(int)
    cells = []
    for i in range(n):
        base = 0.15 + 0.4 * np.clip(green[i], 0, 1)
        ser = base * (1 + slope[i] / 100 * (years - 2012.5)) + rng.normal(0, 0.012, len(years))
        rel = abs(slope[i]) > 1.0
        trend = ("dec" if slope[i] < 0 else "inc") if rel else "nr"
        p = int(pct[i])
        cells.append({"id": f"{c[i]},{r[i]}", "c": int(c[i]), "r": int(r[i]), "lon": round(float(lon[i]), 4),
                      "lat": round(float(lat[i]), 4), "d": reg[i], "country": {"KZ": "KAZ", "KG": "KGZ", "TJ": "TJK", "TM": "TKM", "UZ": "UZB"}[reg[i][:2]], "kind": kind[i],
                      "why": "Desert and bare ground" if kind[i] == "excluded" else "", "water": False,
                      "pct": p if kind[i] == "pasture" else 0,
                      "level": ("low" if p < 33 else "moderate" if p < 67 else "good") if kind[i] == "pasture" else "low",
                      "slope": round(float(slope[i]), 1) if kind[i] == "pasture" else 0.0,
                      "trend": trend if kind[i] == "pasture" else "nr",
                      "strong": bool(rel and abs(slope[i]) >= 1.1 and kind[i] == "pasture"),
                      "cov": 1.0, "seasons": 26, "conf": "Medium" if kind[i] == "pasture" else "Low",
                      "series": [round(float(v), 4) for v in ser] if kind[i] == "pasture" else [],
                      "landCover": {"grassland": 0.0 if kind[i] == "excluded" else 0.8, "bare": 1.0 if kind[i] == "excluded" else 0.2}})
    regs = [{"code": x["code"], "name": x["name"], "country": x["country"], "iso2": x["iso2"],
             "countryName": x["countryName"]} for x in R.regions()]
    ub = R.ca_union().bounds
    meta = {"dataset": "ca", "title": "Central Asia", "dataStatus": "sample",
            "pipelineVersion": "ca-sample (synthetic, for frontend development)",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "years": [2000, 2025], "grid": {**GRID, "cellKm2": 400},
            "view": {"bounds": [[ub[1], ub[0]], [ub[3], ub[2]]]},
            "regions": regs, "boundaryFile": "boundary.geojson", "regionsFile": "regions.geojson",
            "regionLabel": {"en": "Region", "ru": "Регион"},
            "defaultCellId": next(x["id"] for x in cells if x["kind"] == "pasture" and x["d"].startswith("KG")),
            "lowCellId": None, "excludedCellId": next((x["id"] for x in cells if x["kind"] == "excluded"), None),
            "sources": {"note": "SAMPLE data. The real Central Asia export (NASA MODIS 1 km, aggregated) replaces this file."}}
    out.mkdir(parents=True, exist_ok=True)
    (out / "cells.json").write_text(json.dumps({"cells": cells}, separators=(",", ":")))
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    (out / "boundary.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"shapeName": "Central Asia"},
         "geometry": mapping(R.ca_union().simplify(0.02, preserve_topology=True))}]}))
    (out / "regions.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"shapeName": x["name"], "code": x["code"], "country": x["country"]},
         "geometry": mapping(x["geom"].simplify(0.02, preserve_topology=True))} for x in R.regions()]}))
    print(f"CA sample: {len(cells)} cells, {len(regs)} regions, grid {GRID['cols']}x{GRID['rows']} -> {out}")


if __name__ == "__main__":
    main(config.ROOT.parent / "frontend" / "public" / "data" / "ca" / "v1")
