"""Trend statistics, shared by the formula (F3) and the ML session's residual trends.

One implementation, copied (not forked) into the ML repo.

- trend_1d:    Sen slope + Mann-Kendall (Hamed-Rao autocorrelation correction by default) + 95% CI (Gilbert 1987).
- trend_many:  trend_1d over rows of a 2-D array (joblib).
- mk_vectorized / sen_vectorized: fast numpy versions (original MK, no autocorrelation correction),
               used for placebo permutations and sensitivity loops.
- bh_fdr:      Benjamini-Hochberg q-values.
- classify:    growth / decline / unreliable / insufficient.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pymannkendall as pmk
from scipy.stats import norm

CLASSES = ("growth", "decline", "unreliable", "insufficient")


def _sen_ci(y: np.ndarray, t: np.ndarray, alpha: float = 0.05) -> tuple[float, float, float]:
    """Sen slope and its (1-alpha) CI by the rank method (Gilbert 1987). y, t without NaN."""
    n = len(y)
    i, j = np.triu_indices(n, k=1)
    dt = t[j] - t[i]
    slopes = np.sort((y[j] - y[i]) / dt)
    m = len(slopes)
    med = float(np.median(slopes))
    # variance of S without tie correction (ties are rare for float NDVI means)
    var_s = n * (n - 1) * (2 * n + 5) / 18.0
    c = norm.ppf(1 - alpha / 2) * math.sqrt(var_s)
    lo_idx = int(math.floor((m - c) / 2.0))
    hi_idx = int(math.ceil((m + c) / 2.0))
    lo_idx = min(max(lo_idx, 0), m - 1)
    hi_idx = min(max(hi_idx, 0), m - 1)
    return med, float(slopes[lo_idx]), float(slopes[hi_idx])


def trend_1d(y, years, method: str = "hamed_rao", alpha: float = 0.05, min_n: int = 8) -> dict:
    """Trend of one series. NaNs are dropped. Returns slope per time unit (per year)."""
    y = np.asarray(y, dtype=float)
    t = np.asarray(years, dtype=float)
    ok = np.isfinite(y)
    y, t = y[ok], t[ok]
    n = int(len(y))
    out = {"slope": np.nan, "intercept": np.nan, "ci_lo": np.nan, "ci_hi": np.nan,
           "p": np.nan, "z": np.nan, "tau": np.nan, "n": n, "method": method}
    if n < min_n or np.nanstd(y) == 0:
        if n >= min_n:
            out.update(slope=0.0, intercept=float(np.median(y)), ci_lo=0.0, ci_hi=0.0, p=1.0, z=0.0, tau=0.0)
        return out
    slope, lo, hi = _sen_ci(y, t, alpha)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if method == "hamed_rao":
            r = pmk.hamed_rao_modification_test(y)
        else:
            r = pmk.original_test(y)
    p = float(r.p)
    if not np.isfinite(p):  # Hamed-Rao can fail on degenerate series; fall back to original MK
        r = pmk.original_test(y)
        p = float(r.p)
    intercept = float(np.median(y - slope * t))
    out.update(slope=slope, intercept=intercept, ci_lo=lo, ci_hi=hi, p=p, z=float(r.z), tau=float(r.Tau))
    return out


def _trend_rows(Y, years, method, alpha, min_n):
    return [trend_1d(row, years, method, alpha, min_n) for row in Y]


def trend_many(Y, years, method: str = "hamed_rao", alpha: float = 0.05, min_n: int = 8,
               n_jobs: int = -1, chunk: int = 2000):
    """trend_1d for every row of Y (n_series, n_years). Returns a dict of 1-D arrays."""
    import pandas as pd
    from joblib import Parallel, delayed

    Y = np.asarray(Y, dtype=float)
    chunks = [Y[i:i + chunk] for i in range(0, len(Y), chunk)]
    if len(chunks) <= 1 or n_jobs == 1:
        rows = _trend_rows(Y, years, method, alpha, min_n)
    else:
        parts = Parallel(n_jobs=n_jobs)(delayed(_trend_rows)(c, years, method, alpha, min_n) for c in chunks)
        rows = [r for p in parts for r in p]
    df = pd.DataFrame(rows)
    return {k: df[k].to_numpy() for k in df.columns}


def sen_vectorized(Y, years) -> np.ndarray:
    """Sen slope for each row (NaN-aware)."""
    Y = np.asarray(Y, dtype=np.float32)
    t = np.asarray(years, dtype=np.float32)
    i, j = np.triu_indices(len(t), k=1)
    s = (Y[:, j] - Y[:, i]) / (t[j] - t[i])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return np.nanmedian(s, axis=1)


def mk_vectorized(Y, years=None):
    """Original Mann-Kendall for each row (NaN-aware, no tie/autocorrelation correction).

    Returns (S, var_s, z, p)."""
    Y = np.asarray(Y, dtype=np.float32)
    n_t = Y.shape[1]
    i, j = np.triu_indices(n_t, k=1)
    d = Y[:, j] - Y[:, i]
    valid = np.isfinite(d)
    S = np.where(valid, np.sign(d), 0).sum(axis=1).astype(float)
    n = np.isfinite(Y).sum(axis=1).astype(float)
    var_s = n * (n - 1) * (2 * n + 5) / 18.0
    with np.errstate(invalid="ignore", divide="ignore"):
        z = np.where(S > 0, (S - 1) / np.sqrt(var_s), np.where(S < 0, (S + 1) / np.sqrt(var_s), 0.0))
    p = 2 * (1 - norm.cdf(np.abs(z)))
    p = np.where(n >= 3, p, np.nan)
    return S, var_s, z, p


def bh_fdr(p) -> np.ndarray:
    """Benjamini-Hochberg q-values; NaN p-values stay NaN and are not counted."""
    p = np.asarray(p, dtype=float)
    q = np.full_like(p, np.nan)
    ok = np.isfinite(p)
    pv = p[ok]
    m = len(pv)
    if m == 0:
        return q
    order = np.argsort(pv)
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    qv = np.empty(m)
    qv[order] = np.minimum(ranked, 1.0)
    q[ok] = qv
    return q


def classify(slope, p_or_q, n, alpha: float = 0.05, min_years: int = 18) -> np.ndarray:
    """growth / decline / unreliable / insufficient, element-wise."""
    slope = np.atleast_1d(np.asarray(slope, dtype=float))
    pq = np.atleast_1d(np.asarray(p_or_q, dtype=float))
    n = np.atleast_1d(np.asarray(n, dtype=float))
    out = np.full(slope.shape, "unreliable", dtype=object)
    sig = np.isfinite(pq) & (pq < alpha)
    out[sig & (slope > 0)] = "growth"
    out[sig & (slope < 0)] = "decline"
    out[(n < min_years) | ~np.isfinite(slope)] = "insufficient"
    return out


def per_decade(slope) -> np.ndarray:
    return np.asarray(slope, dtype=float) * 10.0


def pct_per_decade(slope, mean) -> np.ndarray:
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.asarray(slope, dtype=float) * 10.0 / np.asarray(mean, dtype=float) * 100.0
