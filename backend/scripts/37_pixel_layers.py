"""1 km pixel layers for the static site (research: native pixels + area shares, not majority-class blocks).

From pipeline artifacts (cells.parquet + S.npy + core.json) writes to <out>/px/:
- tiles/{trend,level}/{z}/{x}/{y}.png  palette PNG XYZ tiles (EPSG:3857), zooms 3..8 (8 ~ native 1 km)
- chunks/{cr}_{cc}.bin                64 x 64 sinusoidal cells per file, struct-of-arrays (see meta.layout)
- meta.json                          grid, chunk layout, codes, colours, labels, tile URL template
- regions.json                       share of PASTURE AREA per class for every region, country and the whole area

Trend tiers (per pixel): reliable = Benjamini-Hochberg q < 0.05 (TrendeX rule); early sign = per-pixel
Mann-Kendall p < 0.05 but not FDR-significant (the Trends.Earth / SDG 15.3.1 convention); else no reliable trend.

python scripts/37_pixel_layers.py --art artifacts --dataset naryn --out ../frontend/public/data/v1
python scripts/37_pixel_layers.py --art data/ca_formula/formula/artifacts_ca --dataset ca --out ../frontend/public/data/ca/v1
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trendex_core.grid import CELL, SINU, X_ORIGIN, Y_ORIGIN  # noqa: E402

R_SINU = 6371007.181
R_MERC = 6378137.0
CHUNK = 64
ZOOMS = range(3, 9)
YEARS = 26

# trend tier codes (pasture) and mask codes (non-pasture); 0 = outside the study area
TIERS = {1: ("decline", "Reliable decline", "#C2410C"), 2: ("early_decline", "Possible decline (pixel p < 0.05)", "#FDBA74"),
         3: ("stable", "No reliable trend", "#E4E4E7"), 4: ("early_growth", "Possible growth (pixel p < 0.05)", "#99D5E0"),
         5: ("growth", "Reliable growth", "#0E7490"), 6: ("insufficient", "Not enough data", "#FFFFFF")}
LEVELS = {21: ("low", "Low (relative)", "#DCEBD3"), 22: ("moderate", "Moderate (relative)", "#86C07F"),
          23: ("good", "Good (relative)", "#2F7D3E")}
MASKS = {40: ("water", "Water", "#BFD7EA"), 41: ("snow_ice", "Snow and ice", "#F4F4F5"),
         42: ("urban", "Built-up", "#71717A"), 43: ("cropland", "Cropland", "#D6C7A1"),
         44: ("forest", "Forest", "#5B7F5E"), 45: ("steep", "Too steep", "#A1A1AA"),
         46: ("bare", "Desert and bare ground", "#EDE6D6"), 47: ("insufficient", "Not enough data", "#FFFFFF")}
MASK_CODE = {v[0]: k for k, v in MASKS.items()}
LEVEL_CODE = {"low": 21, "limited": 22, "suitable": 23}
NARYN_CODES = {"naryn": "NA", "at-bashy": "AT", "jumgal": "JU", "kochkor": "KO", "ak-talaa": "AK"}


def hex_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def palette_image(a: np.ndarray) -> Image.Image:
    im = Image.fromarray(a, "P")
    pal = [0] * 768
    for code, (_, _, col) in {**TIERS, **LEVELS, **MASKS}.items():
        pal[code * 3:code * 3 + 3] = hex_rgb(col)
    im.putpalette(pal)
    im.info["transparency"] = 0
    return im


def merc_xy(lon, lat):
    x = R_MERC * np.radians(lon)
    y = R_MERC * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    return x, y


def tile_range(lon0, lat0, lon1, lat1, z):
    n = 2 ** z
    x0 = int(math.floor((lon0 + 180) / 360 * n))
    x1 = int(math.floor((lon1 + 180) / 360 * n))
    def ty(lat):
        return int(math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
    return x0, x1, ty(lat1), ty(lat0)


def write_tiles(code_grid: np.ndarray, src_transform, out: Path, layer: str, bounds) -> int:
    lon0, lat0, lon1, lat1 = bounds
    count = 0
    for z in ZOOMS:
        x0, x1, y0, y1 = tile_range(lon0, lat0, lon1, lat1, z)
        size = 2 * math.pi * R_MERC / (256 * 2 ** z)
        W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
        left = -math.pi * R_MERC + x0 * 256 * size
        top = math.pi * R_MERC - y0 * 256 * size
        dst = np.zeros((H, W), dtype=np.uint8)
        reproject(code_grid, dst, src_transform=src_transform, src_crs=SINU,
                  dst_transform=from_origin(left, top, size, size), dst_crs="EPSG:3857",
                  resampling=Resampling.mode if z < 7 else Resampling.nearest, src_nodata=0, dst_nodata=0)
        for ty in range(y0, y1 + 1):
            for tx in range(x0, x1 + 1):
                t = dst[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256]
                if not t.any():
                    continue
                p = out / layer / str(z) / str(tx)
                p.mkdir(parents=True, exist_ok=True)
                palette_image(t).save(p / f"{ty}.png", optimize=True)
                count += 1
    return count


def _yearly_band(df, key):
    """Summer (May–Sep) means per key-year of observed/expected/p10/p90, weighted by n (cells)."""
    df = df[(df["month"] >= 5) & (df["month"] <= 9)]
    w = df["n"].to_numpy(dtype=float)
    g = df.assign(wo=df["observed"] * w, we=df["expected"] * w, w10=df["p10"] * w, w90=df["p90"] * w, w=w)
    a = g.groupby([key, "year"])[["wo", "we", "w10", "w90", "w"]].sum()
    return pd.DataFrame({"observed": a.wo / a.w, "expected": a.we / a.w, "p10": a.w10 / a.w, "p90": a.w90 / a.w}).reset_index()


def _series_entry(sub):
    sub = sub.sort_values("year")
    yrs = sub["year"].astype(int).tolist()
    res = (sub["observed"] - sub["expected"]).to_numpy()
    last, hist = res[-1], res[:-1]
    pct = float(100 * (np.sum(hist < last) + 0.5 * np.sum(hist == last)) / max(len(hist), 1))
    cls = "below" if pct < 33.3 else ("above" if pct > 66.7 else "within")
    r4 = lambda v: [None if not np.isfinite(x) else round(float(x), 4) for x in v]  # noqa: E731
    return {"years": yrs, "observed": r4(sub["observed"]), "expected": r4(sub["expected"]), "p10": r4(sub["p10"]),
            "p90": r4(sub["p90"]), "season": {"year": yrs[-1], "residual": round(float(last), 4), "percentile": round(pct, 1),
                                             "class": cls}}


def ml_side_files(a, prod, out, c, reg, ridx, regions, country, pasture, rs):
    """expected-vs-observed per region/country/all (into regions.json), whatif.json and ml.json."""
    # --- observed vs weather-expected yearly series ---
    if a.dataset == "ca":
        eb = pd.read_parquet(prod / "expected_block.parquet", columns=["block_id", "year", "month", "observed", "expected", "p10", "p90", "n_cells"])
        eb = eb.rename(columns={"n_cells": "n"})
        lab = pd.DataFrame({"block_id": c["block_label"].astype(str).to_numpy(), "reg": reg})
        lab = lab[lab["reg"] > 0].groupby("block_id")["reg"].agg(lambda s: s.value_counts().index[0])
        eb["reg"] = eb["block_id"].map(lab).fillna(0).astype(int)
    else:
        eo = pd.read_parquet(prod / "expected_oof.parquet", columns=["cell_id", "year", "month", "observed", "expected", "p10", "p90"])
        cmap = pd.Series(reg, index=c["cell_id"].astype(str).to_numpy())
        eo["reg"] = cmap.reindex(eo["cell_id"].astype(str).to_numpy()).fillna(0).astype(int).to_numpy()
        eb = eo.assign(n=1.0)
    eb = eb[eb["reg"] > 0]
    per_reg = _yearly_band(eb, "reg")
    for d in regions:
        sub = per_reg[per_reg["reg"] == ridx[d]]
        if len(sub):
            rs["regions"][d]["expected"] = _series_entry(sub)
    rs["all"]["expected"] = _series_entry(_yearly_band(eb.assign(k=1), "k"))
    if country is not None:
        inv = {i: d for d, i in ridx.items()}
        ccode = {i: country[np.flatnonzero(reg == i)[0]] for i in inv if (reg == i).any()}
        eb["cty"] = eb["reg"].map(ccode)
        per_c = _yearly_band(eb.dropna(subset=["cty"]), "cty")
        for k in rs.get("countries", {}):
            sub = per_c[per_c["cty"] == k]
            if len(sub):
                rs["countries"][k]["expected"] = _series_entry(sub)

    # --- what-if (model sensitivity) mapped to our region codes ---
    w = json.loads((prod / "scenarios" / "what_if.json").read_text())
    wi = {k: w[k] for k in ("model", "units", "months", "precip_pct", "temp_c", "layout") if k in w}
    wi["label"] = "Model sensitivity, not a causal effect"
    wi["meaning"] = w.get("meaning", "")
    if a.dataset == "ca":
        from trendex_core.io.regions import regions as RR
        name2code = {x["name"]: x["code"] for x in RR()}
        wi["all"] = w["all"]
        wi["countries"] = w.get("countries", {})
        wi["regions"] = {name2code[n]: v for n, v in w.get("regions", {}).items() if n in name2code}
    else:
        nmap = {"Naryn": "NA", "At-Bashy": "AT", "Jumgal": "JU", "Kochkor": "KO", "Ak-Talaa": "AK"}
        wi["all"] = w.get("oblast") or w.get("all")
        wi["regions"] = {nmap[n]: v for n, v in w.get("districts", {}).items() if n in nmap}
    (out / "whatif.json").write_text(json.dumps(wi))

    # --- model card numbers for Methods (read from metrics.json, never typed) ---
    m = json.loads((prod / "metrics.json").read_text())
    summ = json.loads((prod / "products_summary.json").read_text()) if (prod / "products_summary.json").exists() else {}
    tt, st = m.get("temporal_test", {}), m.get("spatial_test", {})
    repo = "TrendeX90/expected-greenness-ca" if a.dataset == "ca" else "TrendeX90/expected-greenness"
    ml = {"model": repo, "version": "v2-ca" if a.dataset == "ca" else "v1",
          "url": f"https://huggingface.co/{repo}/tree/" + ("v2-ca" if a.dataset == "ca" else "v1"),
          "training_log": f"https://huggingface.co/{repo}/blob/main/TRAINING_LOG.md",
          "gate": m.get("gate"), "skill_vs_ridge": {"temporal": tt.get("skill_xgb_vs_ridge"), "spatial": st.get("skill_xgb_vs_ridge")},
          "skill_vs_climatology": {"temporal": tt.get("skill_xgb_vs_clim"), "spatial": st.get("skill_xgb_vs_clim")},
          "coverage_p10_p90": tt.get("conformal_coverage_p10_p90"), "cells_by_source": summ.get("cells_by_source"),
          "residual_season": "Jun-Aug", "git_commit": m.get("git_commit"),
          "wording": "Change not explained by precipitation, air temperature, snow and soil moisture"}
    (out / "ml.json").write_text(json.dumps(ml, indent=1))
    print("ml side files: whatif.json, ml.json, expected series for", sum(1 for d in regions if "expected" in rs["regions"][d]), "regions")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--art", required=True)
    ap.add_argument("--dataset", choices=["naryn", "ca"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--products", help="ML products dir (residual_trend.parquet, expected_*, scenarios/what_if.json, metrics.json)")
    a = ap.parse_args()
    t0 = time.time()
    art, out = Path(a.art), Path(a.out) / "px"
    core = json.loads((art / "core.json").read_text())
    g = core["grid"]
    cols = ["cell_id", "r", "c", "status", "level_class", "score", "trend_slope", "trend_p", "trend_q", "trend_n",
            "trend_pct_decade", "district", "area_km2", "lon", "lat"]
    if a.dataset == "ca":
        cols.append("block_label")
    c = pd.read_parquet(art / "cells.parquet", columns=cols)
    S = np.load(art / "S.npy", mmap_mode="r")
    N = len(c)
    r, cc = c["r"].to_numpy(), c["c"].to_numpy()
    status = c["status"].to_numpy().astype(object)
    pasture = status == "pasture"
    p, q, n = c["trend_p"].to_numpy(), c["trend_q"].to_numpy(), c["trend_n"].to_numpy()
    slope = c["trend_slope"].to_numpy()
    min_years = 18

    tier = np.zeros(N, dtype=np.uint8)
    for reason, code in MASK_CODE.items():
        tier[status == reason] = code
    ok = pasture & (n >= min_years) & np.isfinite(p)
    tier[pasture] = 6
    tier[ok] = 3
    early = ok & (p < 0.05)
    tier[early & (slope < 0)] = 2
    tier[early & (slope > 0)] = 4
    rel = ok & np.isfinite(q) & (q < 0.05)
    tier[rel & (slope < 0)] = 1
    tier[rel & (slope > 0)] = 5
    level = np.where(pasture, pd.Series(c["level_class"]).map(LEVEL_CODE).fillna(0).to_numpy(), tier).astype(np.uint8)
    level[pasture & (level == 0)] = 47

    # region codes (frontend codes for Naryn, ADM1 codes for CA)
    dist = c["district"].to_numpy().astype(object)
    if a.dataset == "naryn":
        dist = np.array([NARYN_CODES.get(d) if isinstance(d, str) else None for d in dist], dtype=object)
        # Suusamyr valley (Chüy) is part of the Naryn pilot view: lon < 74.7, 41.95 < lat < 42.32, outside the oblast
        lo_, la_ = c["lon"].to_numpy(), c["lat"].to_numpy()
        su = np.array([d is None for d in dist]) & (lo_ < 74.7) & (la_ > 41.95) & (la_ < 42.32)
        dist[su] = "SU"
    regions = sorted({d for d in dist if isinstance(d, str)})
    ridx = {d: i + 1 for i, d in enumerate(regions)}
    reg = np.array([ridx.get(d, 0) if isinstance(d, str) else 0 for d in dist], dtype=np.uint8)
    country = None
    if a.dataset == "ca":
        from trendex_core.io.regions import regions as RR
        cmap = {x["code"]: x["country"] for x in RR()}
        country = np.array([cmap.get(d) for d in dist], dtype=object)

    # show only the study area itself (Naryn oblast / the five countries), not the processing buffer
    tier[reg == 0] = 0
    level[reg == 0] = 0

    # ---- ML "beyond weather": residual trend tiers (same tier rules), joined by cell_id ----
    resid = rslope = None
    if a.products:
        prod = Path(a.products)
        rt = pd.read_parquet(prod / "residual_trend.parquet", columns=["cell_id", "slope_per_decade", "p", "q"])
        rows = pd.Index(c["cell_id"].astype(str).to_numpy()).get_indexer(rt["cell_id"].astype(str).to_numpy())
        keep = rows >= 0
        rows = rows[keep]
        rsl = np.full(N, np.nan); rp = np.full(N, np.nan); rq = np.full(N, np.nan)
        rsl[rows] = rt["slope_per_decade"].to_numpy()[keep]; rp[rows] = rt["p"].to_numpy()[keep]; rq[rows] = rt["q"].to_numpy()[keep]
        resid = tier.copy()
        rp_ok = pasture & np.isfinite(rp)
        resid[pasture & (reg > 0)] = 6
        m3 = rp_ok & (reg > 0)
        resid[m3] = 3
        resid[m3 & (rp < 0.05) & (rsl < 0)] = 2
        resid[m3 & (rp < 0.05) & (rsl > 0)] = 4
        resid[m3 & np.isfinite(rq) & (rq < 0.05) & (rsl < 0)] = 1
        resid[m3 & np.isfinite(rq) & (rq < 0.05) & (rsl > 0)] = 5
        rslope = np.where(np.isfinite(rsl), np.clip(np.round(rsl * 1000), -32000, 32000), -32768).astype(np.int16)
        print(f"residual trend joined for {int(m3.sum())} pasture pixels")

    if out.exists():
        shutil.rmtree(out)
    (out / "tiles").mkdir(parents=True)
    (out / "chunks").mkdir(parents=True)

    # ---- tiles ----
    H, W = g["H"], g["W"]
    tgrid = np.zeros((H, W), dtype=np.uint8)
    lgrid = np.zeros((H, W), dtype=np.uint8)
    tgrid[r, cc] = tier
    lgrid[r, cc] = level
    src_t = from_origin(X_ORIGIN + g["col0"] * CELL, Y_ORIGIN - g["row0"] * CELL, CELL, CELL)
    lon, lat = c["lon"].to_numpy(), c["lat"].to_numpy()
    bounds = (float(lon.min()) - 0.05, float(lat.min()) - 0.05, float(lon.max()) + 0.05, float(lat.max()) + 0.05)
    nt = write_tiles(tgrid, src_t, out / "tiles", "trend", bounds)
    nl = write_tiles(lgrid, src_t, out / "tiles", "level", bounds)
    del tgrid, lgrid
    if resid is not None:
        rgrid = np.zeros((H, W), dtype=np.uint8)
        rgrid[r, cc] = resid
        nr = write_tiles(rgrid, src_t, out / "tiles", "resid", bounds)
        del rgrid
        print(f"tiles: resid {nr}")
    print(f"tiles: trend {nt}, level {nl} ({time.time() - t0:.0f}s)")

    # ---- chunks (struct of arrays, 64 x 64 local cells) ----
    score = np.where(np.isfinite(c["score"].to_numpy()), np.clip(np.round(c["score"].to_numpy()), 0, 100), 255).astype(np.uint8)
    pct = c["trend_pct_decade"].to_numpy()
    pct10 = np.where(np.isfinite(pct), np.clip(np.round(pct * 10), -32000, 32000), -32768).astype(np.int16)
    p8 = np.where(np.isfinite(p), np.round(np.clip(p, 0, 1) * 250), 255).astype(np.uint8)
    q8 = np.where(np.isfinite(q), np.round(np.clip(q, 0, 1) * 250), 255).astype(np.uint8)
    cr, ccc = r // CHUNK, cc // CHUNK
    key = cr.astype(np.int64) * 10000 + ccc
    order = np.argsort(key, kind="stable")
    ks = key[order]
    starts = np.flatnonzero(np.r_[True, ks[1:] != ks[:-1]])
    ends = np.r_[starts[1:], len(ks)]
    n_chunks = 0
    total = 0
    for s0, s1 in zip(starts, ends):
        idx = order[s0:s1]
        k = int(ks[s0])
        kr, kc = divmod(k, 10000)
        local = (r[idx] - kr * CHUNK) * CHUNK + (cc[idx] - kc * CHUNK)
        def arr(dtype, fill):
            x = np.full(CHUNK * CHUNK, fill, dtype=dtype)
            return x
        A_t, A_l, A_s, A_p, A_q, A_r = arr(np.uint8, 0), arr(np.uint8, 0), arr(np.uint8, 255), arr(np.uint8, 255), arr(np.uint8, 255), arr(np.uint8, 0)
        A_slope = arr(np.int16, -32768)
        A_ser = np.full((YEARS, CHUNK * CHUNK), 255, dtype=np.uint8)
        A_t[local], A_l[local], A_s[local] = tier[idx], level[idx], score[idx]
        A_p[local], A_q[local], A_r[local], A_slope[local] = p8[idx], q8[idx], reg[idx], pct10[idx]
        sv = np.asarray(S[np.sort(idx)], dtype=np.float32)  # sorted read is faster on the memmap
        srt = np.argsort(np.argsort(idx))  # map back to idx order
        sv = sv[srt]
        sq = np.where(np.isfinite(sv), np.clip(np.round((sv + 0.2) / 1.2 * 254), 0, 254), 255).astype(np.uint8)
        A_ser[:, local] = sq.T
        parts = [A_t.tobytes(), A_l.tobytes(), A_s.tobytes(), A_slope.tobytes(), A_p.tobytes(),
                 A_q.tobytes(), A_r.tobytes(), A_ser.tobytes()]
        if resid is not None:
            A_rt, A_rs = arr(np.uint8, 0), arr(np.int16, -32768)
            A_rt[local], A_rs[local] = resid[idx], rslope[idx]
            parts += [A_rt.tobytes(), A_rs.tobytes()]
        blob = b"".join(parts)
        (out / "chunks" / f"{kr}_{kc}.bin").write_bytes(blob)
        n_chunks += 1
        total += len(blob)
    print(f"chunks: {n_chunks}, {total / 1e6:.1f} MB ({time.time() - t0:.0f}s)")

    # ---- region statistics: share of PASTURE AREA per class ----
    area = c["area_km2"].to_numpy()
    def stats(m):
        pm = m & pasture
        pa = float(area[pm].sum())
        out_ = {"pasture_km2": round(pa, 1), "n_pasture_px": int(pm.sum()),
                "trend": {TIERS[k][0]: (float(area[pm & (tier == k)].sum()) / pa if pa else 0.0) for k in range(1, 7)},
                "level": {LEVELS[k][0]: (float(area[pm & (level == k)].sum()) / pa if pa else 0.0) for k in LEVELS},
                "matrix": {LEVELS[lk][0]: {TIERS[tk][0]: (float(area[pm & (level == lk) & (tier == tk)].sum()) / pa if pa else 0.0)
                                           for tk in range(1, 7)} for lk in LEVELS},
                "excluded_km2": {MASKS[k][0]: round(float(area[m & (tier == k)].sum()), 1) for k in MASKS if k != 47}}
        if resid is not None:
            out_["resid"] = {TIERS[k][0]: (float(area[pm & (resid == k)].sum()) / pa if pa else 0.0) for k in range(1, 7)}
        return out_
    inreg = reg > 0
    rs = {"all": stats(inreg), "regions": {d: stats(reg == ridx[d]) for d in regions}}
    if country is not None:
        rs["countries"] = {k: stats(country == k) for k in sorted({x for x in country if x})}
    if a.products:
        ml_side_files(a, Path(a.products), out, c, reg, ridx, regions, country, pasture, rs)
    (out / "regions.json").write_text(json.dumps(rs, indent=1))

    layout = [("tier", "uint8", 1), ("level", "uint8", 1), ("score", "uint8", 1), ("slope_pct_decade_x10", "int16", 2),
              ("p_x250", "uint8", 1), ("q_x250", "uint8", 1), ("region", "uint8", 1), ("series", "uint8", YEARS)]
    if resid is not None:
        layout += [("resid", "uint8", 1), ("resid_slope_ndvi_x1000_per_decade", "int16", 2)]
    off = 0
    lay = []
    for name, dt, size in layout:
        lay.append({"name": name, "dtype": dt, "offset": off, "count": CHUNK * CHUNK * (YEARS if name == "series" else 1)})
        off += CHUNK * CHUNK * size
    meta = {"dataset": a.dataset, "years": [2000, 2025], "chunk": CHUNK, "chunkBytes": off,
            "grid": {"crs": "MODIS sinusoidal", "R": R_SINU, "cell_m": CELL, "x_origin": X_ORIGIN, "y_origin": Y_ORIGIN,
                     "row0": g["row0"], "col0": g["col0"], "H": H, "W": W},
            "lookup": "x = R*lon_rad*cos(lat_rad); y = R*lat_rad; row = floor((y_origin - y)/cell_m) - row0; "
                      "col = floor((x - x_origin)/cell_m) - col0; chunk = chunks/{row//64}_{col//64}.bin; "
                      "i = (row%64)*64 + col%64",
            "layout": lay, "series_decode": "ndvi = v/254*1.2 - 0.2 (v=255 missing)",
            "slope_decode": "pct per decade = v/10 (v=-32768 missing)", "p_decode": "p = v/250 (255 missing)",
            "regions": regions,
            "codes": {str(k): {"key": v[0], "label": v[1], "color": v[2]} for k, v in {**TIERS, **LEVELS, **MASKS}.items()},
            "legend": {"trend": [1, 2, 3, 4, 5, 6] + list(MASKS)[:-1], "level": [23, 22, 21] + list(MASKS)[:-1],
                       **({"resid": [1, 2, 3, 4, 5, 6] + list(MASKS)[:-1]} if resid is not None else {})},
            "resid_decode": "resid slope (NDVI per decade) = v/1000 (v=-32768 missing); tier codes as trend, 6 = no model output",
            "tiles": {"url": "px/tiles/{layer}/{z}/{x}/{y}.png", "layers": ["trend", "level"] + (["resid"] if resid is not None else []), "minZoom": min(ZOOMS),
                      "maxNativeZoom": max(ZOOMS), "bounds": [[bounds[1], bounds[0]], [bounds[3], bounds[2]]]},
            "method": {"reliable": "Benjamini-Hochberg FDR q < 0.05 across all pasture pixels (Hamed-Rao Mann-Kendall)",
                       "possible": "per-pixel Mann-Kendall p < 0.05 but not FDR-significant (the per-pixel significance convention of Trends.Earth / SDG 15.3.1); labelled possible, not the Trends.Earth LPD class 'early signs of decline'",
                       "fdr_scope": "BH FDR is computed across all pasture pixels of this dataset, so the same Naryn pixel can be reliable in the Naryn pilot and possible in the Central Asia view",
                       "level": "TrendeX 4-component score per 1 km pixel, thresholds 60 / 40",
                       "greening_note": "Greening is not automatically better pasture: shrubs and crops also raise NDVI."}}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"done in {time.time() - t0:.0f}s -> {out}")
    print("shares (all):", {k: round(v, 3) for k, v in rs["all"]["trend"].items()})


if __name__ == "__main__":
    main()
