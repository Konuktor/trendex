"""Synthetic cube with the exact schema of the ML session's cube (§2a of the plan).

For interface and pipeline testing only. manifest.json says data_mode = "mock"
and every API response carries it, so mock numbers can never pass as results.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
from scipy.ndimage import gaussian_filter

from .. import grid as G
from . import boundaries

MONTHS = np.arange(4, 11)  # Apr..Oct are all the formula needs


def _field(rng, shape, sigma):
    f = gaussian_filter(rng.standard_normal(shape), sigma)
    return (f - f.mean()) / (f.std() + 1e-9)


def _disk(lon, lat, lon0, lat0, r_km):
    return G.haversine_km(lat, lon, lat0, lon0) < r_km


def make(out_dir: Path, seed: int = 7, years=(2000, 2025)) -> dict:
    rng = np.random.default_rng(seed)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    aoi = boundaries.to_sinu(boundaries.aoi_ll(20.0))
    xmin, ymin, xmax, ymax = aoi.bounds
    r_top, c_left = G.global_rowcol(xmin, ymax)
    r_bot, c_right = G.global_rowcol(xmax, ymin)
    rows, cols = np.mgrid[int(r_top):int(r_bot) + 1, int(c_left):int(c_right) + 1]
    H, W = rows.shape
    x, y = G.cell_center(rows.ravel(), cols.ravel())
    shapely.prepare(aoi)
    inside = shapely.contains_xy(aoi, x, y)

    elev_f = 0.8 * _field(rng, (H, W), 30) + 0.35 * _field(rng, (H, W), 7) + 0.15 * _field(rng, (H, W), 2)
    elev_f = (elev_f - elev_f.min()) / (elev_f.max() - elev_f.min())
    elev = 1700 + 3000 * elev_f
    gy, gx = np.gradient(elev, G.CELL)
    slope = np.degrees(np.arctan(np.hypot(gx, gy))) * 6 + 2 * np.abs(_field(rng, (H, W), 1.5))
    trend_f = _field(rng, (H, W), 12)
    noise_f = (_field(rng, (H, W), 4) + 3) / 6

    sel = np.flatnonzero(inside)
    x, y = x[sel], y[sel]
    rr, cc = rows.ravel()[sel], cols.ravel()[sel]
    elev, slope = elev.ravel()[sel], np.clip(slope.ravel()[sel], 0, 45)
    trend_f, noise_f = trend_f.ravel()[sel], noise_f.ravel()[sel]
    lon, lat = G.xy_to_lonlat(x, y)
    N = len(sel)

    lc = np.full(N, 10, dtype=np.int16)  # grassland
    lc[(elev < 2300) & (noise_f > 0.55)] = 7       # open shrubland
    lc[(elev < 2000) & (noise_f > 0.62)] = 12      # cropland
    lc[(elev > 2200) & (elev < 2900) & (noise_f > 0.78)] = 1  # forest
    lc[elev > 3900] = 16                           # barren
    lc[elev > 4400] = 15                           # snow and ice
    # approximate places, for the mock only
    lc[_disk(lon, lat, 75.13, 41.83, 9)] = 17      # a "Son-Kul-like" lake
    lc[_disk(lon, lat, 75.30, 40.62, 6)] = 17      # a "Chatyr-Kul-like" lake
    lc[_disk(lon, lat, 75.99, 41.43, 3)] = 13      # a "Naryn-like" town
    grass_frac = np.clip(np.where(lc == 10, 0.75, 0.25) + 0.2 * (noise_f - 0.5), 0, 1)

    cid = G.cell_id(rr, cc)
    cells = pa.table({
        "cell_id": pa.array(cid), "x": x, "y": y, "lon": lon, "lat": lat,
        "district": pa.array(boundaries.assign_district(x, y).tolist(), type=pa.string()),
        "block_id": ((rr // 11) * 100000 + (cc // 11)).astype(np.int64),
        "elev_mean": elev.astype(np.float32), "slope_mean": slope.astype(np.float32),
        "steep_share": np.clip((slope - 15) / 30, 0, 1).astype(np.float32),
        "lc_major": lc, "grass_frac": grass_frac.astype(np.float32),
    })
    pq.write_table(cells, out_dir / "cells.parquet")

    yrs = np.arange(years[0], years[1] + 1)
    Y, M = len(yrs), len(MONTHS)
    peak = 0.10 + 0.55 * np.exp(-((elev - 2800) / 850) ** 2)
    peak = np.where(lc == 16, peak * 0.4, peak)
    peak = np.where(lc == 15, 0.02, np.where(lc == 17, -0.05, np.where(lc == 13, 0.12, peak)))
    base = np.array([0.30, 0.55, 0.85, 1.0, 0.92, 0.62, 0.32])
    shift = np.clip((elev - 2500) / 1500, -0.5, 1.2)[:, None]
    curve = np.interp(MONTHS[None, :] - 4 - shift, np.arange(M), base, left=0.2, right=0.25)  # N x M
    tslope = 0.0045 * np.sign(trend_f) * np.clip(np.abs(trend_f) - 0.6, 0, None)        # NDVI / yr
    year_eff = rng.normal(0, 0.03, Y)
    ndvi = (peak[:, None, None] * curve[:, None, :]
            + tslope[:, None, None] * (yrs[None, :, None] - yrs.mean())
            + year_eff[None, :, None] * peak[:, None, None] * 2
            + rng.normal(0, 0.02, (N, Y, M))).astype(np.float32)
    ndvi = np.clip(ndvi, -0.2, 0.95)
    p_bad = 0.04 + 0.45 * ((elev[:, None] > 3400) & np.isin(MONTHS, [4, 5, 10])[None, :]) + 0.06 * np.isin(MONTHS, [4, 10])[None, :]
    ok = rng.random((N, Y, M)) > p_bad[:, None, :]

    precip_curve = np.array([35, 55, 60, 50, 40, 30, 20], dtype=np.float32)
    precip = (precip_curve[None, None, :] * (0.6 + elev[:, None, None] / 4000)
              * (1 + rng.normal(0, 0.25, (1, Y, M))) + rng.normal(0, 4, (N, Y, M))).astype(np.float32)
    precip = np.clip(precip, 0, None)
    precip[:, 0, :2] = np.nan  # IMERG starts 2000-06
    lst = (25 - (elev[:, None, None] - 1700) / 150 + 8 * curve[:, None, :] + rng.normal(0, 1.5, (N, Y, M))).astype(np.float32)
    snow = np.clip(((elev[:, None, None] - 2600) / 1500) * (1 - curve[:, None, :]) + rng.normal(0, 0.1, (N, Y, M)), 0, 1).astype(np.float32)
    aqua = (ndvi + rng.normal(0, 0.015, ndvi.shape)).astype(np.float32)
    aqua[:, yrs < 2003, :] = np.nan

    cell_idx = np.repeat(np.arange(N, dtype=np.int32), Y * M)
    tab = pa.table({
        "cell_id": pa.DictionaryArray.from_arrays(pa.array(cell_idx), pa.array(cid)),
        "year": np.tile(np.repeat(yrs, M), N).astype(np.int16),
        "month": np.tile(MONTHS, N * Y).astype(np.int8),
        "ndvi": ndvi.ravel(), "ndvi_ok": ok.ravel(), "ndvi_aqua": aqua.ravel(),
        "precip": precip.ravel(), "lst_day": lst.ravel(), "lst_night": (lst - 12).ravel(),
        "snow": snow.ravel(), "soil_moist": (0.2 + 0.1 * curve[:, None, :] + 0 * ndvi).ravel().astype(np.float32),
        "swe": (snow * 50).ravel(),
    })
    pq.write_table(tab, out_dir / "monthly.parquet", compression="zstd")

    manifest = {
        "data_mode": "mock",
        "note": "Synthetic cube for interface testing. Not NASA data, not results.",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": seed, "n_cells": int(N), "years": [int(yrs[0]), int(yrs[-1])], "months": MONTHS.tolist(),
        "units": {"precip": "mm/month", "lst_day": "degC", "snow": "share of 8-day periods with snow"},
        "datasets": [],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest
