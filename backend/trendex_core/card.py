"""build_card(): the 8-block answer for any selection (F4, F6)."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from . import config, ext
from .core import clean
from .formula import COMPONENTS, class_of_score, level_class, score_from_pct, season_class, season_percentile
from .grid import haversine_km
from .selection import Selection
from .stats import trend as T

LEVEL_RANK = {"suitable": 2, "limited": 1, "low": 0}
EXCL_REASONS = ("water", "snow_ice", "urban", "cropland", "forest", "steep")


def area_series(core, m: np.ndarray, min_frac: float = 0.5, S: np.ndarray | None = None):
    """Mean summer NDVI per year over cells m; NaN in years where fewer than min_frac of cells are valid."""
    S = core.S if S is None else S
    sub = S[m].astype(np.float64)  # float64: Hamed-Rao is sensitive to 1e-7 noise; keeps Python == TS
    n_valid = np.isfinite(sub).sum(axis=0)
    with np.errstate(invalid="ignore"):
        vals = np.nanmean(np.where(np.isfinite(sub), sub, np.nan), axis=0) if len(sub) else np.full(S.shape[1], np.nan)
    vals[n_valid < max(1, min_frac * len(sub))] = np.nan
    return vals, n_valid


def series_trend(core, vals: np.ndarray) -> dict:
    cfg = core.cfg
    r = T.trend_1d(vals, core.years, method=cfg["trend"]["method"])
    cls = T.classify([r["slope"]], [r["p"]], [r["n"]], cfg["trend"]["alpha"], cfg["min_valid_years"])[0]
    mean = np.nanmean(vals) if np.isfinite(vals).any() else np.nan
    r["class"] = cls
    r["mean"] = mean
    r["pct_per_decade"] = float(T.pct_per_decade(r["slope"], mean)) if np.isfinite(r["slope"]) else np.nan
    return r


def _shares(values: np.ndarray, keys) -> dict:
    n = len(values)
    return {k: (float(np.sum(values == k)) / n if n else 0.0) for k in keys}


def _base_card(core, sel: Selection, lang: str) -> dict:
    return {"selection": {"type": sel.type, "id": sel.id, "sel": sel.sel, "name": sel.name, "centroid": None,
                          "districts": [], "params": sel.params},
            "status": "ok", "area": None, "level": None, "dynamics": None, "reasons": {"pro": [], "con": []},
            "confidence": None, "season": None, "alternatives": None, "action": None,
            "not_considered": list(config.texts(lang)["not_considered"]), "extras": {}, "meta": {}}


def _meta(core, lang, weights, season) -> dict:
    return {"lang": lang, "data_mode": core.meta.get("data_mode"), "data_version": core.meta.get("data_version"),
            "config_hash": core.meta.get("config_hash"), "weights": weights or core.cfg["weights"],
            "season": season, "computed_at": core.meta.get("computed_at"),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def build_card(core, sel: Selection, lang: str = "en", weights: dict | None = None, season: str = "summer") -> dict:
    cfg = core.cfg
    t = config.texts(lang)
    card = _base_card(core, sel, lang)
    card["meta"] = _meta(core, lang, weights, season)
    m = sel.mask
    if not m.any():
        card["status"] = "outside_aoi"
        return clean(card)

    area = core.col("area_km2")
    status = core.col("status")
    lat, lon = core.col("lat"), core.col("lon")
    card["selection"]["centroid"] = {"lat": float(lat[m].mean()), "lon": float(lon[m].mean())}
    card["selection"]["districts"] = sorted({d for d in core.col("district")[m] if d})

    total = float(area[m].sum())
    excl = {r: float(area[m & (status == r)].sum()) for r in EXCL_REASONS}
    p = m & (status == "pasture")
    pasture_km2 = float(area[p].sum())
    insufficient_km2 = float(area[m & (status == "insufficient")].sum())
    card["area"] = {"total_km2": total, "pasture_km2": pasture_km2, "excluded_km2": excl,
                    "insufficient_km2": insufficient_km2, "n_cells": int(m.sum())}

    if not p.any():
        card["status"] = "insufficient" if insufficient_km2 >= sum(excl.values()) else "excluded"
        key = card["status"]
        card["action"] = {"key": key, "text": t["actions"][key], "note": t["action_note"], "cell": None}
        card["extras"] = ext.card_extras(core, sel, {"card": card, "mask": m, "pasture": p, "lang": lang})
        return clean(card)

    # ---- block 1: level ----
    if weights:
        score_all = score_from_pct(core.pct(), weights)
        cls_all = level_class(score_all, cfg["level_thresholds"])
    else:
        score_all, cls_all = core.col("score"), core.col("level_class")
    score = float(np.nanmean(score_all[p]))
    lvl = class_of_score(score, cfg["level_thresholds"])
    comps = []
    comp_pct = {}
    raw_cols = {"green": ("green", "NDVI"), "stability": ("cv", "CV"), "season": ("season_len", "months"),
                "terrain": ("slope_mean", "deg")}
    for k in COMPONENTS:
        pk = core.col(f"pct_{k}")[p]
        pv = float(np.nanmean(pk)) if np.isfinite(pk).any() else np.nan
        comp_pct[k] = pv
        rc, unit = raw_cols[k]
        rv = core.col(rc)[p]
        comps.append({"key": k, "label": t["labels"]["component"][k],
                      "percentile": None if not np.isfinite(pv) else round(100 * pv, 1),
                      "raw": float(np.nanmean(rv)) if np.isfinite(rv).any() else None, "unit": unit})
    card["level"] = {"class": lvl, "label": t["labels"]["level"][lvl], "score": round(score, 1),
                     "class_shares": _shares(cls_all[p], ("suitable", "limited", "low")),
                     "components": comps, "relative_note": t["relative_note"]}

    # ---- block 2: dynamics ----
    vals, n_valid = area_series(core, p)
    tr = series_trend(core, vals)
    dyn = tr["class"]
    cell_cls = core.col("trend_class")[m & ((status == "pasture") | (status == "insufficient"))]
    card["dynamics"] = {
        "class": dyn, "label": t["labels"]["dynamics"][dyn], "period": [int(core.years[0]), int(core.years[-1])],
        "slope_per_decade": tr["slope"] * 10 if np.isfinite(tr["slope"]) else None,
        "ci95": [tr["ci_lo"] * 10, tr["ci_hi"] * 10] if np.isfinite(tr["ci_lo"]) else None,
        "pct_per_decade": tr["pct_per_decade"], "p_value": tr["p"], "method": f"Sen slope + Mann-Kendall ({tr['method']})",
        "n_years": int(tr["n"]), "mean": tr["mean"],
        "series": [{"year": int(y), "value": (float(v) if np.isfinite(v) else None), "n_valid_cells": int(n)}
                   for y, v, n in zip(core.years, vals, n_valid)],
        "fit": {"intercept": tr["intercept"], "slope": tr["slope"]},
        "cell_shares": _shares(cell_cls, ("growth", "decline", "unreliable", "insufficient")),
    }

    # ---- block 3: reasons ----
    pro, con = [], []
    ranked = sorted([(k, v) for k, v in comp_pct.items() if np.isfinite(v)], key=lambda kv: -kv[1])
    slope_deg = float(np.nanmean(core.col("slope_mean")[p]))
    for k, v in ranked:
        fmt = {"p": round(100 * v), "q": round(100 * (1 - v)), "slope": round(slope_deg, 1)}
        if v >= 0.6 and len(pro) < 2:
            pro.append({"key": f"{k}_pro", "text": t["reasons"][f"{k}_pro"].format(**fmt)})
    for k, v in reversed(ranked):
        fmt = {"p": round(100 * v), "q": round(100 * (1 - v)), "slope": round(slope_deg, 1)}
        if v <= 0.4 and len(con) < 2:
            con.append({"key": f"{k}_con", "text": t["reasons"][f"{k}_con"].format(**fmt)})
    if dyn in ("growth", "decline"):
        key = "trend_pro" if dyn == "growth" else "trend_con"
        item = {"key": key, "text": t["reasons"][key].format(y0=int(core.years[0]), pct=tr["pct_per_decade"],
                                                            lo=tr["ci_lo"] * 10, hi=tr["ci_hi"] * 10)}
        (pro if dyn == "growth" else con).insert(0, item)
    excl_share = sum(excl.values()) / total if total else 0
    if excl_share > 0.3:
        con.append({"key": "excluded_con", "text": t["reasons"]["excluded_con"].format(share=round(100 * excl_share))})
    card["reasons"] = {"pro": pro[:3], "con": con[:3]}

    # ---- block 4: confidence ----
    cc = cfg["confidence"]
    factors = []
    if pasture_km2 < cc["min_pasture_km2"]:
        factors.append({"key": "small_area", "text": t["confidence"]["small_area"].format(km2=round(pasture_km2, 1))})
    if excl_share > cc["max_excluded_share"]:
        factors.append({"key": "excluded_share", "text": t["confidence"]["excluded_share"]})
    vf = float(np.nanmean(core.col("valid_frac")[p]))
    if vf < cc["min_valid_frac"]:
        factors.append({"key": "valid_frac", "text": t["confidence"]["valid_frac"].format(pct=round(100 * vf))})
    fl = core.col("flip_share")[p]
    flip_any = float(np.mean(fl > 0)) if len(fl) else 0.0
    if flip_any > cc["max_flip_share"]:
        factors.append({"key": "flip_share", "text": t["confidence"]["flip_share"].format(pct=round(100 * flip_any))})
    conf = "high" if not factors else ("medium" if len(factors) == 1 else "low")
    card["confidence"] = {"level": conf, "label": t["labels"]["confidence"][conf],
                          "factors": factors or [{"key": "none", "text": t["confidence"]["none"]}]}

    # ---- block 5: this season ----
    sv, sp = season_percentile(vals)
    sc = season_class(sp, cfg["season_terciles"])
    if sc:
        b0, b1 = int(core.years[0]), int(core.years[-2])
        label = t["labels"]["season"][sc]
        card["season"] = {"year": int(core.years[-1]), "value": sv, "percentile": sp, "class": sc, "label": label,
                          "baseline": [b0, b1], "vs_expected": None,
                          "text": t["season"]["text"].format(year=int(core.years[-1]), label_lc=label.lower(),
                                                             p=round(sp), b0=b0, b1=b1)}

    # ---- block 6: alternatives ----
    card["alternatives"] = alternatives(core, sel, m, score, lvl, pasture_km2, card["selection"]["centroid"], lang)

    # ---- block 7: action ----
    dyn_key = dyn if dyn in ("growth", "decline", "unreliable") else "insufficient"
    akey = config.matrix()[lvl][dyn_key]
    card["action"] = {"key": akey, "text": t["actions"][akey], "note": t["action_note"],
                      "cell": {"level": lvl, "dynamics": dyn}}

    # ---- extras (P1 plugins) ----
    card["extras"] = ext.card_extras(core, sel, {"card": card, "mask": m, "pasture": p, "lang": lang,
                                                 "series": vals, "season": season})
    sve = card["extras"].pop("season_vs_expected", None)  # ML (F9) fills block 5's vs_expected
    if sve and card["season"]:
        card["season"]["vs_expected"] = sve
    return clean(card)


def alternatives(core, sel: Selection, m, score, lvl, pasture_km2, centroid, lang) -> dict:
    cfg = core.cfg["alternatives"]
    t = config.texts(lang)["alternatives"]
    R = cfg["radius_km"]
    out = {"radius_km": R, "items": [], "note": None}
    if lvl == "suitable":
        out["note"] = t["not_needed"]
        return out
    B = core.blocks
    if B is None or not len(B):
        out["note"] = t["none"].format(r=R)
        return out
    d = haversine_km(B["lat"].to_numpy(), B["lon"].to_numpy(), centroid["lat"], centroid["lon"])
    near = d <= R
    if sel.type == "district":
        near |= (B["district"].to_numpy() == sel.id)
    own = set(np.unique(core.col("block_id")[m])) if sel.type == "block" else set()
    p75 = float(np.nanpercentile(B["pasture_km2"], 75))
    min_area = min(pasture_km2, p75)
    rank = B["level_class"].map(LEVEL_RANK).fillna(-1).to_numpy()
    ok = (near & B["in_region"].to_numpy() & (B["score"].to_numpy() > score) & (rank > LEVEL_RANK[lvl])
          & (B["pasture_km2"].to_numpy() >= min_area) & (B["dyn_class"].to_numpy() != "decline")
          & ~B["block_id"].isin(own).to_numpy())
    cand = B[ok].assign(distance_km=d[ok]).sort_values(["score", "distance_km"], ascending=[False, True]).head(cfg["max_n"])
    from .selection import block_name
    lt = config.texts(lang)["labels"]
    for _, b in cand.iterrows():
        reasons = [t["score"].format(d=b["score"] - score)]
        if np.isfinite(b.get("pct_green", np.nan)):
            reasons.append(t["green"].format(p=round(100 * b["pct_green"])))
        reasons.append(t["not_declining"])
        out["items"].append({"sel": f"block:{int(b['block_id'])}", "name": block_name(core, int(b["block_id"]), lang),
                             "distance_km": round(float(b["distance_km"]), 1), "score": round(float(b["score"]), 1),
                             "level_class": b["level_class"], "level_label": lt["level"][b["level_class"]],
                             "dynamics_class": b["dyn_class"], "dynamics_label": lt["dynamics"][b["dyn_class"]],
                             "centroid": {"lat": float(b["lat"]), "lon": float(b["lon"])},
                             "pasture_km2": round(float(b["pasture_km2"]), 1), "reasons": reasons})
    if not out["items"]:
        out["note"] = t["none"].format(r=R)
    return out
