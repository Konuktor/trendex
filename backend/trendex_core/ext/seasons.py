"""F14: spring–autumn season variant of level and dynamics, plus MODIS snow cover.

- Level and trend recomputed for spring_autumn_months (Apr, May, Sep, Oct) with the same open formula.
- Snow: share of 8-day MOD10A2 periods with snow in May (mean over years) and the Apr–May trend.
Cards get extras.season_variant and extras.snow; dynamic (Edge) cards get the level part from cells.bin.
"""
from __future__ import annotations

import logging

import numpy as np

from .. import config, formula
from ..card import series_trend
from ..formula import COMPONENTS
from ..stats import trend as T

FEATURE = "seasons"
log = logging.getLogger("trendex.ext.seasons")
TXT = {
    "en": {"sa": "Spring–autumn (Apr, May, Sep, Oct): {lvl}, {dyn}",
           "snow": "May snow cover: {pct:.0f}% of 8-day periods on average (more than on {p}% of pastures); trend {dyn}"},
    "ru": {"sa": "Весна–осень (апр, май, сен, окт): {lvl}, {dyn}",
           "snow": "Снег в мае: в среднем {pct:.0f}% восьмидневных периодов (больше, чем на {p}% пастбищ); тренд: {dyn}"},
}


def available(core) -> bool:
    return "score_sa" in core.cells


def build_step(core, cube):
    cfg = core.cfg
    months = cfg["spring_autumn_months"]
    S_sa, _ = formula.season_mean(cube.ndvi, months, 2)
    clim = cube.extra.get("_clim")
    if clim is None:
        clim = formula.climatology(cube.ndvi)
    comps = formula.raw_components(S_sa, clim, core.col("slope_mean"), cfg["season_months"])
    ref = core.pasture & core.in_region
    pct = {}
    for k in COMPONENTS:
        pk = formula.percentiles(comps[k], ref)
        pk[~core.pasture] = np.nan
        pct[k] = pk
    score = formula.score_from_pct(pct, cfg["weights"])
    core.cells["score_sa"] = score
    core.cells["level_class_sa"] = formula.level_class(score, cfg["level_thresholds"])
    _, _, _, p = T.mk_vectorized(S_sa, core.years)
    q = np.full(core.N, np.nan)
    q[ref] = T.bh_fdr(np.where(ref, p, np.nan))[ref]
    sl = T.sen_vectorized(S_sa, core.years)
    core.cells["trend_class_sa"] = T.classify(sl, q, np.isfinite(S_sa).sum(axis=1), cfg["trend"]["fdr_q"], cfg["min_valid_years"])
    core.extra["S_sa"] = S_sa
    art = core.extra["_art"]
    art.mkdir(parents=True, exist_ok=True)
    np.save(art / "S_sa.npy", S_sa)
    core.extra.setdefault("bin_fields", {})["score_sa"] = score.astype(np.float32)

    if "snow" in cube.extra:
        snow = cube.extra["snow"]
        may = snow[:, :, 4]
        with np.errstate(invalid="ignore"):
            core.cells["snow_may"] = np.nanmean(may, axis=1).astype(np.float32)
            am = np.nanmean(snow[:, :, 3:5], axis=2).astype(np.float32)
        core.extra["snow_am"] = am
        np.save(art / "snow_am.npy", am)
        core.cells["snow_may_pct"] = formula.percentiles(core.col("snow_may").astype(float), ref)
        core.extra["bin_fields"]["snow_may"] = core.col("snow_may").astype(np.float32)
        core.extra["bin_fields"]["snow_may_pct"] = core.col("snow_may_pct").astype(np.float32)
    else:
        log.warning("cube has no snow; snow part of F14 skipped")
    core._cache.clear()


def load(core, art):
    for name in ("S_sa", "snow_am"):
        p = art / f"{name}.npy"
        if p.exists():
            core.extra[name] = np.load(p)


def _area_vals(arr, mask):
    sub = arr[mask].astype(np.float64)
    n = np.isfinite(sub).sum(axis=0)
    with np.errstate(invalid="ignore"):
        v = np.nanmean(sub, axis=0)
    v[n < max(1, 0.5 * len(sub))] = np.nan
    return v


def card_extra(core, sel, ctx):
    if "score_sa" not in core.cells or not ctx["pasture"].any():
        return None
    p = ctx["pasture"]
    lang = ctx["lang"]
    t = config.texts(lang)["labels"]
    score = float(np.nanmean(core.col("score_sa")[p]))
    lvl = formula.class_of_score(score, core.cfg["level_thresholds"])
    out = {"season": "spring_autumn", "months": core.cfg["spring_autumn_months"], "score": round(score, 1),
           "level_class": lvl, "level_label": t["level"].get(lvl) if lvl else None}
    if "S_sa" in core.extra:
        tr = series_trend(core, _area_vals(core.extra["S_sa"], p))
        out.update({"dynamics_class": tr["class"], "dynamics_label": t["dynamics"][tr["class"]],
                    "slope_per_decade": tr["slope"] * 10, "ci95": [tr["ci_lo"] * 10, tr["ci_hi"] * 10], "p_value": tr["p"]})
    out["text"] = TXT[lang]["sa"].format(lvl=(out["level_label"] or "—").lower(), dyn=out.get("dynamics_label", "—").lower())
    return "season_variant", out


def snow_extra(core, sel, ctx):
    if "snow_may" not in core.cells or not ctx["pasture"].any():
        return None
    p = ctx["pasture"]
    lang = ctx["lang"]
    may = float(np.nanmean(core.col("snow_may")[p]))
    pp = float(np.nanmean(core.col("snow_may_pct")[p]))
    out = {"may_share": may, "percentile": None if not np.isfinite(pp) else round(100 * pp, 1)}
    dyn = "—"
    if "snow_am" in core.extra:
        tr = series_trend(core, _area_vals(core.extra["snow_am"], p))
        out.update({"trend_class": tr["class"], "slope_per_decade": tr["slope"] * 10, "p_value": tr["p"]})
        dyn = config.texts(lang)["labels"]["dynamics"][tr["class"]].lower()
    out["text"] = TXT[lang]["snow"].format(pct=100 * may if np.isfinite(may) else 0, p=round(100 * pp) if np.isfinite(pp) else 0, dyn=dyn)
    return out


def layers(core):
    if "snow_may" not in core.cells:
        return []
    from ..layers import binned
    pal = config.palette()["continuous"]["sequential"]
    v = np.where(core.pasture, core.col("snow_may").astype(float), np.nan)
    specs = [("snow_may", "binned", binned(v, [0.1, 0.25, 0.5, 0.75]),
              list(zip(["< 10%", "10–25%", "25–50%", "50–75%", "> 75%"], ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"])))]
    lc = np.where(core.pasture, core.col("level_class_sa"), None)
    lp = config.palette()["level_class"]
    from ..layers import categorical
    specs.append(("level_spring_autumn", "categorical", categorical(lc, list(lp)), list(lp.items())))
    return specs
