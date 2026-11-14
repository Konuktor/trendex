"""/compare (F18): two cards side by side plus a diff; /level/recompute (F18 weight sliders)."""
import numpy as np
from fastapi import APIRouter, Depends, Query

from trendex_core import card as C, formula, selection as SEL
from trendex_core.core import clean

from .. import deps
from ..schemas import RecomputeRequest

router = APIRouter(tags=["compare"])


@router.get("/compare")
@deps.http_errors
def compare(a: str = Query(...), b: str = Query(...), lang: str = Depends(deps.lang_q), weights: str | None = None):
    c = deps.core()
    w = deps.parse_weights(weights)
    ca = C.build_card(c, SEL.parse(c, a, lang), lang, w)
    cb = C.build_card(c, SEL.parse(c, b, lang), lang, w)

    def g(card, *path):
        for p in path:
            card = (card or {}).get(p)
        return card
    diff = {"score_delta": (g(ca, "level", "score") or 0) - (g(cb, "level", "score") or 0) if g(ca, "level") and g(cb, "level") else None,
            "pct_per_decade_delta": (g(ca, "dynamics", "pct_per_decade") - g(cb, "dynamics", "pct_per_decade"))
            if g(ca, "dynamics", "pct_per_decade") is not None and g(cb, "dynamics", "pct_per_decade") is not None else None,
            "better_on": []}
    for comp_a, comp_b in zip((g(ca, "level", "components") or []), (g(cb, "level", "components") or [])):
        if comp_a["percentile"] is not None and comp_b["percentile"] is not None:
            diff["better_on"].append({"key": comp_a["key"], "winner": "a" if comp_a["percentile"] > comp_b["percentile"] else "b",
                                      "delta": comp_a["percentile"] - comp_b["percentile"]})
    return {"a": ca, "b": cb, "diff": diff}


@router.post("/level/recompute")
def recompute(req: RecomputeRequest):
    c = deps.core()
    w = deps.parse_weights(",".join(f"{k}:{v}" for k, v in req.weights.items()))
    s = formula.score_from_pct(c.pct(), w)
    cls = formula.level_class(s, c.cfg["level_thresholds"])
    p = c.pasture & c.in_region
    base = c.col("level_class")
    area = c.col("area_km2")
    tot = float(area[p].sum()) or 1.0
    shares = {k: float(area[p & (cls == k)].sum()) / tot for k in ("suitable", "limited", "low")}
    changed = float(area[p & (cls != base)].sum()) / tot
    dist = {}
    for slug in c.cfg["district_names"]:
        m = p & (c.col("district") == slug)
        dist[slug] = {"score": float(np.nanmean(s[m])) if m.any() else None,
                      "class": formula.class_of_score(float(np.nanmean(s[m])), c.cfg["level_thresholds"]) if m.any() else None,
                      "changed_share": float(area[m & (cls != base)].sum()) / max(float(area[m].sum()), 1e-9)}
    return clean({"weights": w, "level_shares": shares, "changed_share_vs_default": changed, "districts": dist,
                  "layer_url": "/api/layers/level_class.png?weights=" + ",".join(f"{k}:{v}" for k, v in w.items()),
                  "data_mode": c.meta.get("data_mode")})
