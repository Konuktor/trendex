"""The core open formula: mask (F1), summer series, level (F2), trend (F3), season (block 5), sensitivity (F10)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .stats import trend as T

COMPONENTS = ("green", "stability", "season", "terrain")
LEVELS = ("suitable", "limited", "low")


# ---------- mask ----------
def mask_status(cells: pd.DataFrame, cfg: dict) -> np.ndarray:
    status = np.full(len(cells), "pasture", dtype=object)
    lc = cells["lc_major"].to_numpy()
    for reason, classes in cfg["exclude"].items():
        status[np.isin(lc, classes) & (status == "pasture")] = reason
    # conditional exclusions, e.g. barren only in lowland desert: {bare: {classes: [16], below_elev_m: 1500}}
    elev = cells["elev_mean"].to_numpy() if "elev_mean" in cells else None
    for reason, rule in (cfg.get("exclude_where") or {}).items():
        if "below_elev_m" not in rule or elev is None:
            continue  # greenness-only rules run later in mask_low_green
        hit = np.isin(lc, rule["classes"]) & (status == "pasture") & (elev < float(rule["below_elev_m"]))
        status[hit] = reason
    slope = cells["slope_mean"].to_numpy()
    status[(slope > cfg["max_slope_deg"]) & (status == "pasture")] = "steep"
    return status


def mask_low_green(status: np.ndarray, cells: pd.DataFrame, green: np.ndarray, cfg: dict) -> np.ndarray:
    """Second pass of exclude_where rules that need greenness: {bare: {classes: [16], max_green: 0.10}} also
    excludes those classes where the median summer NDVI stays below max_green (bare even if high up)."""
    lc = cells["lc_major"].to_numpy()
    for reason, rule in (cfg.get("exclude_where") or {}).items():
        if "max_green" not in rule:
            continue
        hit = np.isin(lc, rule["classes"]) & (status == "pasture") & (green < float(rule["max_green"]))
        status[hit] = reason
    return status


# ---------- series ----------
def season_mean(ndvi: np.ndarray, months, min_valid: int) -> tuple[np.ndarray, np.ndarray]:
    """Per cell-year mean over `months` (1-based), NaN if fewer than min_valid valid months.

    Returns (S[N,Y], valid_frac[N]) where valid_frac = share of valid cell-months."""
    sub = ndvi[:, :, np.asarray(months) - 1]
    cnt = np.isfinite(sub).sum(axis=2)
    import warnings
    with warnings.catch_warnings(), np.errstate(invalid="ignore"):
        warnings.simplefilter("ignore")
        S = np.nanmean(sub, axis=2)  # sub already holds NaN where invalid
    S[cnt < min_valid] = np.nan
    valid_frac = np.isfinite(sub).mean(axis=(1, 2))
    return S.astype(np.float32), valid_frac.astype(np.float32)


def climatology(ndvi: np.ndarray, chunk: int = 300_000) -> np.ndarray:
    """Per-cell median NDVI by calendar month (N x 12), computed in row chunks to bound memory."""
    import warnings
    out = np.full((ndvi.shape[0], ndvi.shape[2]), np.nan, dtype=np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for i in range(0, ndvi.shape[0], chunk):
            out[i:i + chunk] = np.nanmedian(ndvi[i:i + chunk], axis=1)
    return out


def season_length(clim: np.ndarray, months) -> np.ndarray:
    """Months in `months` where climatological NDVI >= min + 0.5 (max - min) (half-amplitude rule)."""
    sub = clim[:, np.asarray(months) - 1]
    with np.errstate(invalid="ignore"):
        lo, hi = np.nanmin(sub, axis=1), np.nanmax(sub, axis=1)
        thr = lo + 0.5 * (hi - lo)
        n = (sub >= thr[:, None]).sum(axis=1).astype(np.float32)
    n[~np.isfinite(hi)] = np.nan
    return n


# ---------- level ----------
def raw_components(S: np.ndarray, clim: np.ndarray, slope: np.ndarray, season_months) -> dict:
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        green = np.nanmedian(S, axis=1)
        mean = np.nanmean(S, axis=1)
        std = np.nanstd(S, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        cv = std / mean
    cv[~(mean > 0)] = np.nan
    return {"green": green, "stability": -cv, "season": season_length(clim, season_months),
            "terrain": -np.asarray(slope, dtype=float), "_cv": cv, "_mean": mean}


def percentiles(values: np.ndarray, ref_mask: np.ndarray) -> np.ndarray:
    """Percentile (0-1) of every value within the reference set (mid-rank for ties)."""
    ref = np.sort(values[ref_mask & np.isfinite(values)])
    out = np.full(len(values), np.nan, dtype=np.float32)
    if len(ref) == 0:
        return out
    ok = np.isfinite(values)
    lo = np.searchsorted(ref, values[ok], side="left")
    hi = np.searchsorted(ref, values[ok], side="right")
    out[ok] = ((lo + hi) / 2.0) / len(ref)
    return out


def score_from_pct(pct: dict, weights: dict) -> np.ndarray:
    num = np.zeros(len(next(iter(pct.values()))), dtype=float)
    den = np.zeros_like(num)
    for k in COMPONENTS:
        w = float(weights.get(k, 0.0))
        if w <= 0:
            continue
        p = pct[k]
        ok = np.isfinite(p)
        num[ok] += w * p[ok]
        den[ok] += w
    with np.errstate(invalid="ignore", divide="ignore"):
        s = 100.0 * num / den
    s[den == 0] = np.nan
    return s.astype(np.float32)


def level_class(score: np.ndarray, thr: dict) -> np.ndarray:
    out = np.full(len(score), None, dtype=object)
    ok = np.isfinite(score)
    out[ok & (score >= thr["suitable"])] = "suitable"
    out[ok & (score < thr["suitable"]) & (score >= thr["limited"])] = "limited"
    out[ok & (score < thr["limited"])] = "low"
    return out


def class_of_score(score: float, thr: dict) -> str | None:
    if score is None or not np.isfinite(score):
        return None
    return "suitable" if score >= thr["suitable"] else ("limited" if score >= thr["limited"] else "low")


# ---------- season (block 5) ----------
def season_percentile(series: np.ndarray) -> tuple[float, float]:
    """Last value vs the values before it: (value, percentile 0-100)."""
    s = np.asarray(series, dtype=float)
    last = s[-1]
    hist = s[:-1][np.isfinite(s[:-1])]
    if not np.isfinite(last) or len(hist) < 5:
        return float(last) if np.isfinite(last) else np.nan, np.nan
    pct = 100.0 * (np.sum(hist < last) + 0.5 * np.sum(hist == last)) / len(hist)
    return float(last), float(pct)


def season_class(pct: float, terciles) -> str | None:
    if pct is None or not np.isfinite(pct):
        return None
    return "below" if pct < terciles[0] else ("above" if pct > terciles[1] else "within")


def season_pct_cells(S: np.ndarray) -> np.ndarray:
    last = S[:, -1:]
    hist = S[:, :-1]
    n = np.isfinite(hist).sum(axis=1)
    with np.errstate(invalid="ignore"):
        below = (hist < last).sum(axis=1) + 0.5 * (hist == last).sum(axis=1)
        pct = 100.0 * below / n
    pct[(n < 5) | ~np.isfinite(S[:, -1])] = np.nan
    return pct.astype(np.float32)


# ---------- sensitivity (F10) ----------
def sensitivity(pct: dict, cfg: dict, ref_mask: np.ndarray, base_class: np.ndarray, district: np.ndarray) -> tuple[dict, np.ndarray]:
    sets = cfg["sensitivity_sets"]
    flips = np.zeros(len(base_class), dtype=float)
    per_set = {}
    valid = ref_mask & (base_class != None)  # noqa: E711
    for name, w in sets.items():
        cls = level_class(score_from_pct(pct, w), cfg["level_thresholds"])
        changed = (cls != base_class) & valid
        flips += changed
        by_d = {}
        for d in sorted(set(district[valid & (district != None)])):  # noqa: E711
            m = valid & (district == d)
            by_d[d] = float(changed[m].mean()) if m.any() else None
        per_set[name] = {"weights": w, "changed_share": float(changed[valid].mean()) if valid.any() else None,
                         "by_district": by_d}
    flip_share = flips / max(len(sets), 1)
    flip_share[~valid] = np.nan
    summary = {"sets": per_set,
               "any_change_share": float((flip_share[valid] > 0).mean()) if valid.any() else None,
               "mean_changed_share": float(np.nanmean([v["changed_share"] for v in per_set.values()]))}
    return summary, flip_share.astype(np.float32)


def cell_trends(S: np.ndarray, years: np.ndarray, ref_mask: np.ndarray, cfg: dict, n_jobs: int = -1) -> dict:
    """Per-cell trend with BH across reference (oblast pasture) cells."""
    run = np.flatnonzero(np.isfinite(S).sum(axis=1) >= 8)
    N = len(S)
    out = {k: np.full(N, np.nan) for k in ("slope", "intercept", "ci_lo", "ci_hi", "p", "z", "tau")}
    out["n"] = np.isfinite(S).sum(axis=1).astype(float)
    res = T.trend_many(S[run], years, method=cfg["trend"]["method"], n_jobs=n_jobs)
    for k in ("slope", "intercept", "ci_lo", "ci_hi", "p", "z", "tau"):
        out[k][run] = res[k]
    q = np.full(N, np.nan)
    q_ref = T.bh_fdr(np.where(ref_mask, out["p"], np.nan))
    q[ref_mask] = q_ref[ref_mask]
    # buffer cells: BH would not be comparable; use their own BH set so they still get a class
    other = ~ref_mask & np.isfinite(out["p"])
    if other.any():
        q_o = T.bh_fdr(np.where(other, out["p"], np.nan))
        q[other] = q_o[other]
    out["q"] = q
    out["class"] = T.classify(out["slope"], q, out["n"], cfg["trend"]["fdr_q"], cfg["min_valid_years"])
    return out
