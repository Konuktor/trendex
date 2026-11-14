"""Region-level products: block summaries, overview (F7/F8), trends (F8), queue (F21), validation (F10)."""
from __future__ import annotations

import io
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy import ndimage

from . import config
from .card import area_series, build_card, series_trend
from .formula import class_of_score
from .grid import CELL, X_ORIGIN, Y_ORIGIN, xy_to_lonlat
from .selection import Selection, district_name, point, polygon
from .stats import trend as T

DYN = ("growth", "decline", "unreliable")


# ---------- blocks ----------
def block_summaries(core) -> pd.DataFrame:
    c = core.cells
    p = core.pasture
    df = pd.DataFrame({"block_id": c["block_id"].to_numpy(), "lat": c["lat"].to_numpy(), "lon": c["lon"].to_numpy(),
                       "area": c["area_km2"].to_numpy(), "pasture": p, "in_region": core.in_region,
                       "score": np.where(p, core.col("score"), np.nan),
                       "pct_green": np.where(p, core.col("pct_green"), np.nan),
                       "flip": np.where(p, core.col("flip_share"), np.nan),
                       "district": c["district"].to_numpy(), "r": c["r"].to_numpy(), "c": c["c"].to_numpy()})
    df["pasture_area"] = df["area"] * df["pasture"]
    g = df.groupby("block_id", sort=True)
    B = pd.DataFrame({
        "lat": g["lat"].mean(), "lon": g["lon"].mean(), "total_km2": g["area"].sum(),
        "pasture_km2": g["pasture_area"].sum(), "in_region_share": g["in_region"].mean(),
        "score": g["score"].mean(), "pct_green": g["pct_green"].mean(), "flip_any": g["flip"].apply(lambda s: float((s > 0).mean()) if s.notna().any() else np.nan),
        "r0": g["r"].min(), "r1": g["r"].max(), "c0": g["c"].min(), "c1": g["c"].max(),
    }).reset_index()
    dist = df[df["district"].notna()].groupby("block_id")["district"].agg(lambda s: s.value_counts().index[0])
    B["district"] = B["block_id"].map(dist).astype(object)
    B["district"] = B["district"].where(B["district"].notna(), None)
    B["in_region"] = B["in_region_share"] >= 0.5
    thr = core.cfg["level_thresholds"]
    B["level_class"] = [class_of_score(s, thr) for s in B["score"]]

    # block mean series over pasture cells -> trend
    ids = c["block_id"].to_numpy()
    order = np.argsort(B["block_id"].to_numpy())
    pos = np.searchsorted(B["block_id"].to_numpy()[order], ids)
    rows = order[pos]
    Sp = np.where(p[:, None], core.S, np.nan)
    nb, ny = len(B), core.S.shape[1]
    sums = np.zeros((nb, ny))
    cnt = np.zeros((nb, ny))
    tot = np.zeros(nb)
    np.add.at(tot, rows, p.astype(float))
    ok = np.isfinite(Sp)
    np.add.at(sums, rows, np.where(ok, Sp, 0))
    np.add.at(cnt, rows, ok)
    with np.errstate(invalid="ignore", divide="ignore"):
        ser = sums / cnt
    ser[cnt < 0.5 * tot[:, None]] = np.nan
    tr = T.trend_many(ser, core.years, method=core.cfg["trend"]["method"], n_jobs=-1)
    B["slope"] = tr["slope"]
    B["p"] = tr["p"]
    B["dyn_class"] = T.classify(tr["slope"], tr["p"], tr["n"], core.cfg["trend"]["alpha"], core.cfg["min_valid_years"])
    with np.errstate(invalid="ignore", divide="ignore"):
        B["pct_per_decade"] = T.pct_per_decade(tr["slope"], np.nanmean(ser, axis=1))
    B.loc[B["pasture_km2"] <= 0, ["level_class"]] = None
    B.loc[B["pasture_km2"] <= 0, ["dyn_class"]] = "insufficient"
    return B


def blocks_geojson(core, B: pd.DataFrame, lang: str = "en") -> dict:
    from shapely.geometry import box, mapping
    from shapely.ops import transform as shp_transform

    from .grid import _to_ll
    feats = []
    g = core.grid
    for b in B.itertuples(index=False):
        x0 = X_ORIGIN + (g.col0 + b.c0) * CELL
        x1 = X_ORIGIN + (g.col0 + b.c1 + 1) * CELL
        y1 = Y_ORIGIN - (g.row0 + b.r0) * CELL
        y0 = Y_ORIGIN - (g.row0 + b.r1 + 1) * CELL
        poly = box(x0, y0, x1, y1).segmentize(CELL * 3)
        ll = shp_transform(lambda x, y, z=None: _to_ll.transform(x, y), poly)
        feats.append({"type": "Feature", "geometry": mapping(ll.simplify(0.0005)),
                      "properties": {"id": int(b.block_id), "sel": f"block:{int(b.block_id)}",
                                     "district": b.district, "in_region": bool(b.in_region),
                                     "pasture_km2": round(float(b.pasture_km2), 1),
                                     "score": None if not np.isfinite(b.score) else round(float(b.score), 1),
                                     "level_class": b.level_class, "dynamics_class": b.dyn_class,
                                     "pct_per_decade": None if not np.isfinite(b.pct_per_decade) else round(float(b.pct_per_decade), 2),
                                     "in_queue": bool(getattr(b, "in_queue", False))}})
    return {"type": "FeatureCollection", "features": feats}


# ---------- trends ----------
def _trend_entry(core, mask, monthly=None, name=None, scope=None, id_=None) -> dict:
    vals, n_valid = area_series(core, mask)
    tr = series_trend(core, vals)
    e = {"scope": scope, "id": id_, "name": name, "variable": "ndvi",
         "series": [{"year": int(y), "value": (float(v) if np.isfinite(v) else None), "n_valid_cells": int(n)}
                    for y, v, n in zip(core.years, vals, n_valid)],
         "slope_per_decade": tr["slope"] * 10, "ci95": [tr["ci_lo"] * 10, tr["ci_hi"] * 10],
         "pct_per_decade": tr["pct_per_decade"], "p_value": tr["p"], "significant": tr["class"] in ("growth", "decline"),
         "class": tr["class"], "method": f"Sen slope + Mann-Kendall ({tr['method']})", "n_years": int(tr["n"]),
         "fit": {"intercept": tr["intercept"], "slope": tr["slope"]}, "mean": tr["mean"],
         "pasture_km2": float(core.col("area_km2")[mask].sum())}
    if monthly is not None:
        sub = monthly[mask]  # n, Y, 12
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            mm = np.nanmean(sub, axis=0)  # Y x 12
            clim = np.nanmean(mm, axis=0)
        anom = []
        for yi, y in enumerate(core.years):
            for mo in core.cfg["season_months"]:
                v = mm[yi, mo - 1] - clim[mo - 1]
                anom.append({"year": int(y), "month": int(mo), "anomaly": float(v) if np.isfinite(v) else None})
        e["monthly_anomaly"] = anom
    return e


def trends(core, monthly=None) -> dict:
    p = core.pasture & core.in_region
    out = {"oblast": _trend_entry(core, p, monthly, "Naryn region", "oblast", "naryn-region"), "districts": []}
    for slug in core.cfg["district_names"]:
        m = p & (core.col("district") == slug)
        if m.any():
            out["districts"].append(_trend_entry(core, m, monthly, district_name(core, slug, "en"), "district", slug))
    return out


# ---------- queue ----------
def inspection_queue(core, lang: str = "en") -> list[dict]:
    cfg = core.cfg
    t = config.texts(lang)
    qual = (core.pasture & core.in_region & np.isin(core.col("level_class"), ["suitable", "limited"])
            & (core.col("trend_class") == "decline"))
    G = np.zeros((core.grid.H, core.grid.W), dtype=bool)
    G[core.col("r")[qual], core.col("c")[qual]] = True
    lab, n = ndimage.label(G, structure=np.ones((3, 3)))
    qidx = np.flatnonzero(qual)
    qlab = lab[core.col("r")[qidx], core.col("c")[qidx]]
    order = np.argsort(qlab, kind="stable")
    qidx, qlab = qidx[order], qlab[order]
    bounds = np.searchsorted(qlab, np.arange(1, n + 2))
    zones = []
    area = core.col("area_km2")
    for z in range(1, n + 1):
        m = qidx[bounds[z - 1]:bounds[z]]  # cell indices of zone z
        if len(m) < cfg["queue"]["min_zone_cells"]:
            continue
        vals, _ = area_series(core, m)
        tr = series_trend(core, vals)
        lv = core.col("level_class")[m]
        lvl = "suitable" if np.mean(lv == "suitable") >= 0.5 else "limited"
        akey = config.matrix()[lvl]["decline"]
        d = [v for v in core.col("district")[m] if v]
        km2 = float(area[m].sum())
        conf = "high" if km2 >= cfg["confidence"]["min_pasture_km2"] else "medium"
        if np.nanmean(core.col("valid_frac")[m]) < cfg["confidence"]["min_valid_frac"]:
            conf = "medium" if conf == "high" else "low"
        zones.append({"zone_id": None, "district": max(set(d), key=d.count) if d else None,
                      "lat": float(core.col("lat")[m].mean()), "lon": float(core.col("lon")[m].mean()),
                      "area_km2": round(km2, 2), "n_cells": int(len(m)),
                      "level": lvl, "score": round(float(np.nanmean(core.col("score")[m])), 1),
                      "dynamics": tr["class"], "slope_per_decade": tr["slope"] * 10,
                      "ci_lo": tr["ci_lo"] * 10, "ci_hi": tr["ci_hi"] * 10, "p_value": tr["p"],
                      "pct_per_decade": tr["pct_per_decade"], "confidence": conf, "action_key": akey,
                      "blocks": sorted({int(b) for b in core.col("block_id")[m]}),
                      "loss_index": abs(tr["slope"]) * km2 if np.isfinite(tr["slope"]) else 0.0})
    zones.sort(key=lambda z: -z["loss_index"])
    for i, z in enumerate(zones, 1):
        z["rank"] = i
        z["zone_id"] = f"Z{i:03d}"
    return zones


def queue_csv(zones: list[dict], core, lang: str = "en") -> bytes:
    t = config.texts(lang)
    rows = [{"rank": z["rank"], "zone_id": z["zone_id"],
             "district": district_name(core, z["district"], lang) if z["district"] else "",
             "lat": round(z["lat"], 5), "lon": round(z["lon"], 5), "area_km2": z["area_km2"],
             "level": t["labels"]["level"][z["level"]], "score": z["score"],
             "dynamics": t["labels"]["dynamics"][z["dynamics"]],
             "slope_ndvi_per_decade": round(z["slope_per_decade"], 4), "ci_lo": round(z["ci_lo"], 4),
             "ci_hi": round(z["ci_hi"], 4), "confidence": t["labels"]["confidence"][z["confidence"]],
             "action": t["actions"][z["action_key"]]} for z in zones]
    buf = io.StringIO()
    pd.DataFrame(rows, columns=["rank", "zone_id", "district", "lat", "lon", "area_km2", "level", "score", "dynamics",
                                "slope_ndvi_per_decade", "ci_lo", "ci_hi", "confidence", "action"]).to_csv(buf, index=False)
    return ("﻿" + buf.getvalue()).encode("utf-8")


# ---------- overview ----------
def overview(core, B: pd.DataFrame, zones: list[dict], tr: dict) -> dict:
    reg = core.in_region
    st = core.col("status")
    area = core.col("area_km2")
    p = reg & (st == "pasture")
    ins = reg & (st == "insufficient")
    denom = float(area[p | ins].sum()) or 1.0
    tc = core.col("trend_class")
    dyn_shares = {k: float(area[p & (tc == k)].sum()) / denom for k in DYN}
    dyn_shares["insufficient"] = float(area[ins].sum()) / denom
    lc = core.col("level_class")
    pk = float(area[p].sum()) or 1.0
    lvl_shares = {k: float(area[p & (lc == k)].sum()) / pk for k in ("suitable", "limited", "low")}
    matrix = []
    for lv in ("suitable", "limited", "low"):
        for dy in DYN:
            km2 = float(area[p & (lc == lv) & (tc == dy)].sum())
            matrix.append({"level": lv, "dynamics": dy, "km2": km2, "share": km2 / pk,
                           "action_key": config.matrix()[lv][dy]})
    dist_rows = []
    for e in tr["districts"]:
        m = p & (core.col("district") == e["id"])
        dist_rows.append({"id": e["id"], "pasture_km2": float(area[m].sum()),
                          "score": float(np.nanmean(core.col("score")[m])) if m.any() else None,
                          "level_class": class_of_score(float(np.nanmean(core.col("score")[m])), core.cfg["level_thresholds"]) if m.any() else None,
                          "dynamics_shares": {k: (float(area[m & (tc == k)].sum()) / max(float(area[m].sum()), 1e-9)) for k in DYN},
                          "trend": {k: e[k] for k in ("slope_per_decade", "ci95", "pct_per_decade", "p_value", "class", "significant")}})
    top = B[B["in_region"] & (B["dyn_class"] != "decline") & (B["pasture_km2"] >= core.cfg["confidence"]["min_pasture_km2"])]
    top = top.sort_values("score", ascending=False).head(10)
    top_zones = [{"sel": f"block:{int(b.block_id)}", "block_id": int(b.block_id), "district": b.district,
                  "score": round(float(b.score), 1), "level_class": b.level_class, "dynamics_class": b.dyn_class,
                  "lat": float(b.lat), "lon": float(b.lon), "pasture_km2": round(float(b.pasture_km2), 1)}
                 for b in top.itertuples(index=False)]
    return {"headline": {"pasture_km2": float(area[p].sum()), "assessed_km2": denom,
                         "dynamics_shares": dyn_shares, "level_shares": lvl_shares,
                         "period": [int(core.years[0]), int(core.years[-1])]},
            "matrix": matrix, "districts": dist_rows, "top_zones": top_zones, "decline_zones": zones[:10]}


def headline_sentence(ov: dict, core, lang: str) -> str:
    s = ov["headline"]["dynamics_shares"]
    ca = core.cfg.get("zones") == "ca_adm1"
    area = ("Central Asia" if ca else "Naryn region") if lang == "en" else ("Центральной Азии" if ca else "Нарынской области")
    return config.texts(lang)["headline"].format(y0=int(core.years[0]), g=round(100 * s["growth"]), area=area,
                                                 d=round(100 * s["decline"]), u=round(100 * s["unreliable"]))


# ---------- validation: known places ----------
def known_places(core) -> list[dict]:
    kp = config.optional("known_places.yaml") or {}
    out = []
    for pl in kp.get("places", []) or []:
        try:
            if "polygon" in pl:
                sel = polygon(core, pl["polygon"], "en")
            else:
                sel = point(core, pl["lat"], pl["lon"], pl.get("radius_km", 5), "en")
            card = build_card(core, sel, "en")
        except Exception as e:  # noqa: BLE001
            out.append({"name": pl.get("name"), "result": "not_evaluable", "error": str(e)})
            continue
        exp = pl.get("expect", {}) or {}
        got = {"status": card["status"], "level": (card["level"] or {}).get("class"),
               "dynamics": (card["dynamics"] or {}).get("class"),
               "dominant_mask": max(card["area"]["excluded_km2"], key=card["area"]["excluded_km2"].get) if card["area"] else None}
        checks = {}
        for k, allowed in exp.items():
            allowed = allowed if isinstance(allowed, list) else [allowed]
            checks[k] = got.get(k) in allowed
        res = "not_evaluable" if not checks else ("match" if all(checks.values()) else "mismatch")
        out.append({"name": pl.get("name"), "expect": exp, "got": got, "checks": checks, "result": res,
                    "rationale": pl.get("rationale"), "written_at": kp.get("written_at")})
    return out


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
