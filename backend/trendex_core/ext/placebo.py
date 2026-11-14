"""F19: placebo test of the per-cell trend classes (permuting the years).

The same permutation of the year axis is applied to every cell, so spatial correlation is kept
while any real time trend is destroyed. It does not preserve temporal autocorrelation (stated on Methods).
Uses the fast original MK (mk_vectorized) for both the observed and the permuted runs, so they are comparable.
"""
from __future__ import annotations

import numpy as np

from ..stats import trend as T

FEATURE = "placebo"


def build_step(core, cube):
    cfg = core.cfg.get("placebo", {"n_perm": 100, "seed": 42})
    m = core.pasture & core.in_region
    S = core.S[m]
    S = S[np.isfinite(S).sum(axis=1) >= core.cfg["min_valid_years"]]
    rng = np.random.default_rng(cfg["seed"])
    if cfg.get("max_cells") and len(S) > cfg["max_cells"]:  # Central Asia: random subsample keeps it tractable
        S = S[np.sort(rng.choice(len(S), cfg["max_cells"], replace=False))]

    def shares(Y):
        _, _, _, p = T.mk_vectorized(Y)
        q = T.bh_fdr(p)
        return float(np.nanmean(p < 0.05)), float(np.nanmean(q < 0.05))

    obs_p, obs_q = shares(S)
    perm_p, perm_q = [], []
    for _ in range(int(cfg["n_perm"])):
        a, b = shares(S[:, rng.permutation(S.shape[1])])
        perm_p.append(a)
        perm_q.append(b)
    perm_p, perm_q = np.array(perm_p), np.array(perm_q)
    core.extra["placebo"] = {
        "n_cells": int(len(S)), "n_perm": int(cfg["n_perm"]), "seed": int(cfg["seed"]), "test": "original Mann-Kendall",
        "observed_share_p05": obs_p, "observed_share_bh05": obs_q,
        "placebo_mean_share_p05": float(perm_p.mean()), "placebo_p95_share_p05": float(np.percentile(perm_p, 95)),
        "placebo_mean_share_bh05": float(perm_q.mean()), "placebo_max_share_bh05": float(perm_q.max()),
        "empirical_p": float((1 + np.sum(perm_p >= obs_p)) / (1 + len(perm_p))),
        "note": {"en": "Years shuffled with one permutation for all cells (keeps spatial correlation, breaks time order "
                       "and autocorrelation). If real trends exist, the observed share should exceed the shuffled ones.",
                 "ru": "Годы перемешаны одной перестановкой для всех ячеек (сохраняет пространственную связь, ломает "
                       "порядок во времени и автокорреляцию). Если тренды реальны, наблюдаемая доля выше перемешанных."},
    }
