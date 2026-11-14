import numpy as np
import pymannkendall as pmk

from trendex_core.stats import trend as T

YEARS = np.arange(2000, 2026)


def test_known_slope_recovered_within_ci():
    rng = np.random.default_rng(0)
    y = 0.4 + 0.004 * (YEARS - 2000) + rng.normal(0, 0.01, len(YEARS))
    r = T.trend_1d(y, YEARS)
    assert r["ci_lo"] <= 0.004 <= r["ci_hi"]
    assert r["p"] < 0.05 and r["slope"] > 0


def test_matches_pymannkendall_original():
    rng = np.random.default_rng(1)
    y = rng.normal(0.5, 0.05, len(YEARS)) + 0.002 * (YEARS - 2000)
    r = T.trend_1d(y, YEARS, method="original")
    ref = pmk.original_test(y)
    assert abs(r["p"] - ref.p) < 1e-9
    assert abs(r["slope"] - ref.slope) < 1e-9  # pmk Sen slope is per index step = per year here


def test_vectorized_mk_matches_original():
    rng = np.random.default_rng(2)
    Y = rng.normal(0.5, 0.05, (50, len(YEARS)))
    _, _, _, p = T.mk_vectorized(Y, YEARS)
    ref = np.array([pmk.original_test(row).p for row in Y])
    assert np.allclose(p, ref, atol=1e-6)


def test_nan_handling_and_insufficient():
    y = np.full(len(YEARS), np.nan)
    y[:5] = [0.1, 0.2, 0.3, 0.4, 0.5]
    r = T.trend_1d(y, YEARS)
    assert r["n"] == 5 and np.isnan(r["p"])
    cls = T.classify([r["slope"]], [r["p"]], [r["n"]])
    assert cls[0] == "insufficient"


def test_no_trend_false_positive_rate_near_alpha():
    rng = np.random.default_rng(3)
    Y = rng.normal(0.5, 0.05, (2000, len(YEARS)))
    _, _, _, p = T.mk_vectorized(Y, YEARS)
    rate = np.mean(p < 0.05)
    assert 0.02 < rate < 0.08


def test_bh_fdr_hand_example():
    p = np.array([0.01, 0.04, 0.03, 0.005, np.nan])
    q = T.bh_fdr(p)
    # sorted p: .005 .01 .03 .04 (m=4) -> .02 .02 .04 .04
    assert np.allclose(q[:4], [0.02, 0.04, 0.04, 0.02])
    assert np.isnan(q[4])


def test_classify():
    cls = T.classify([0.01, -0.01, 0.01, 0.01], [0.01, 0.01, 0.2, 0.01], [26, 26, 26, 10])
    assert list(cls) == ["growth", "decline", "unreliable", "insufficient"]


def test_trend_many_shapes():
    rng = np.random.default_rng(4)
    Y = rng.normal(0.5, 0.05, (30, len(YEARS)))
    out = T.trend_many(Y, YEARS, n_jobs=1)
    assert len(out["slope"]) == 30 and np.isfinite(out["p"]).all()
