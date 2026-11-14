"""F23: second variable, IMERG precipitation trends next to NDVI ("not only rain" toggle).

Per cell: Apr–Sep total precipitation per year (IMERG Final V07 via the cube, mm/month).
IMERG starts 2000-06, so 2000 is NaN and the series runs 2001–2025.
"""
from __future__ import annotations

import json
import logging

import numpy as np

from .. import config
from ..card import series_trend
from ..core import clean
from ..selection import district_name
from ..stats import trend as T

FEATURE = "precip"
MONTHS = [4, 5, 6, 7, 8, 9]
log = logging.getLogger("trendex.ext.precip")
TXT = {
    "en": {"growth": "Apr–Sep precipitation rose: {s:+.0f} mm per decade (95% CI {lo:+.0f} to {hi:+.0f})",
           "decline": "Apr–Sep precipitation fell: {s:+.0f} mm per decade (95% CI {lo:+.0f} to {hi:+.0f})",
           "unreliable": "No reliable trend in Apr–Sep precipitation ({s:+.0f} mm per decade, 95% CI {lo:+.0f} to {hi:+.0f})",
           "insufficient": "Not enough precipitation data"},
    "ru": {"growth": "Осадки апрель–сентябрь выросли: {s:+.0f} мм за десятилетие (95% ДИ от {lo:+.0f} до {hi:+.0f})",
           "decline": "Осадки апрель–сентябрь снизились: {s:+.0f} мм за десятилетие (95% ДИ от {lo:+.0f} до {hi:+.0f})",
           "unreliable": "Надёжного тренда осадков апрель–сентябрь нет ({s:+.0f} мм за десятилетие, 95% ДИ от {lo:+.0f} до {hi:+.0f})",
           "insufficient": "Недостаточно данных по осадкам"},
}


def available(core) -> bool:
    return "precip_S" in core.extra


def _series(P: np.ndarray) -> np.ndarray:
    sub = P[:, :, np.array(MONTHS) - 1]
    tot = np.nansum(sub, axis=2)
    tot[np.isfinite(sub).sum(axis=2) < len(MONTHS)] = np.nan
    return tot.astype(np.float32)


def _entry(core, PS, mask, name, scope, id_):
    sub = PS[mask].astype(np.float64)
    n = np.isfinite(sub).sum(axis=0)
    with np.errstate(invalid="ignore"):
        vals = np.nanmean(sub, axis=0) if len(sub) else np.full(PS.shape[1], np.nan)
    vals[n < max(1, 0.5 * len(sub))] = np.nan
    tr = series_trend(core, vals)
    return {"scope": scope, "id": id_, "name": name, "variable": "precip", "unit": "mm (Apr–Sep total)",
            "series": [{"year": int(y), "value": (float(v) if np.isfinite(v) else None), "n_valid_cells": int(k)}
                       for y, v, k in zip(core.years, vals, n)],
            "slope_per_decade": tr["slope"] * 10, "ci95": [tr["ci_lo"] * 10, tr["ci_hi"] * 10],
            "pct_per_decade": tr["pct_per_decade"], "p_value": tr["p"], "class": tr["class"],
            "significant": tr["class"] in ("growth", "decline"), "method": f"Sen slope + Mann-Kendall ({tr['method']})",
            "n_years": int(tr["n"]), "fit": {"intercept": tr["intercept"], "slope": tr["slope"]}, "mean": tr["mean"]}


def build_step(core, cube):
    if "precip" not in cube.extra:
        log.warning("cube has no precip; F23 skipped")
        return
    PS = _series(cube.extra["precip"])
    core.extra["precip_S"] = PS
    p = core.pasture & core.in_region
    out = {"oblast": _entry(core, PS, p, "Naryn region", "oblast", "naryn-region"), "districts": []}
    for slug in core.cfg["district_names"]:
        m = p & (core.col("district") == slug)
        if m.any():
            out["districts"].append(_entry(core, PS, m, district_name(core, slug, "en"), "district", slug))
    # per-cell trend for the map: fast vectorized MK + BH across oblast pasture cells
    run = core.pasture
    _, _, _, pv = T.mk_vectorized(PS[run], core.years)
    slope = T.sen_vectorized(PS[run], core.years)
    q = np.full(core.N, np.nan)
    pr = np.full(core.N, np.nan)
    pr[run] = pv
    q[run] = T.bh_fdr(np.where(core.in_region[run], pv, np.nan))
    sl = np.full(core.N, np.nan)
    sl[run] = slope
    n = np.isfinite(PS).sum(axis=1)
    core.cells["precip_trend_class"] = T.classify(sl, q, n, core.cfg["trend"]["fdr_q"], core.cfg["min_valid_years"])
    core.cells.loc[~run, "precip_trend_class"] = None
    core.cells["precip_slope_decade"] = sl * 10
    art = core.extra["_art"]
    art.mkdir(parents=True, exist_ok=True)
    np.save(art / "precip_S.npy", PS)
    (art / "precip_trends.json").write_text(json.dumps(clean(out), ensure_ascii=False, indent=1))
    # district table column for the overview toggle
    core.extra["precip_districts"] = {e["id"]: {k: e[k] for k in ("slope_per_decade", "ci95", "p_value", "class")} for e in out["districts"]}
    q16 = np.where(np.isfinite(PS), np.round(PS), -32768).astype(np.int16)  # mm, int16 keeps cells.bin small
    core.extra.setdefault("bin_fields", {})["precip_S"] = q16.ravel()
    core.extra.setdefault("bin_meta", {})["precip_S"] = {"dtype": "int16", "nan": -32768, "scale": 1, "unit": "mm Apr-Sep"}


def load(core, art):
    p = art / "precip_S.npy"
    if p.exists():
        core.extra["precip_S"] = np.load(p)
    j = art / "precip_trends.json"
    if j.exists():
        out = json.loads(j.read_text())
        core.extra["precip_districts"] = {e["id"]: {k: e[k] for k in ("slope_per_decade", "ci95", "p_value", "class")} for e in out["districts"]}


def card_extra(core, sel, ctx):
    PS = core.extra.get("precip_S")
    if PS is None or not ctx["pasture"].any():
        return None
    sub = PS[ctx["pasture"]].astype(np.float64)
    n = np.isfinite(sub).sum(axis=0)
    with np.errstate(invalid="ignore"):
        vals = np.nanmean(sub, axis=0)
    vals[n < max(1, 0.5 * len(sub))] = np.nan
    tr = series_trend(core, vals)
    lang = ctx["lang"]
    s, lo, hi = tr["slope"] * 10, tr["ci_lo"] * 10, tr["ci_hi"] * 10
    text = TXT[lang][tr["class"]].format(s=s, lo=lo, hi=hi) if np.isfinite(s) else TXT[lang]["insufficient"]
    return "precip", {"slope_per_decade": s, "ci95": [lo, hi], "p_value": tr["p"], "class": tr["class"],
                      "unit": "mm per decade (Apr–Sep total)", "mean_mm": tr["mean"], "text": text,
                      "series": [None if not np.isfinite(v) else round(float(v), 1) for v in vals]}


def layers(core):
    if "precip_trend_class" not in core.cells:
        return []
    from ..layers import categorical
    legend = [("wetter", "#2166ac"), ("drier", "#b35806"), ("unreliable", "#d9d9d9")]
    v = core.col("precip_trend_class")
    v = np.where(v == "growth", "wetter", np.where(v == "decline", "drier", np.where(v == "unreliable", "unreliable", None)))
    return [("precip_trend", "categorical", categorical(v, [k for k, _ in legend]), legend)]
