"""/trends (F8, F23): series 2000-2025 with Sen slope, 95% CI, Mann-Kendall p. Non-significant shown as results."""
import copy

from fastapi import APIRouter, Depends, HTTPException, Query

from trendex_core import config
from trendex_core.selection import district_name

from .. import deps

router = APIRouter(tags=["trends"])


def _label(e, lang):
    t = config.texts(lang)
    e = copy.deepcopy(e)
    e["label"] = t["labels"]["dynamics"].get(e.get("class"), e.get("class"))
    return e


@router.get("/trends")
def trends(scope: str = Query("all", pattern="^(all|oblast|district)$"), id: str | None = None,
           variable: str = Query("ndvi", pattern="^(ndvi|precip)$"), lang: str = Depends(deps.lang_q)):
    c = deps.core()
    name = "trends.json" if variable == "ndvi" else "precip_trends.json"
    try:
        T = deps.art_json(name)
    except HTTPException:
        raise HTTPException(503, f"variable '{variable}' not available yet") from None
    for e in T["districts"]:
        e["name"] = district_name(c, e["id"], lang)
    T["oblast"]["name"] = "Нарынская область" if lang == "ru" else "Naryn region"
    if scope == "oblast":
        return _label(T["oblast"], lang)
    if scope == "district":
        for e in T["districts"]:
            if e["id"] == id:
                return _label(e, lang)
        raise HTTPException(404, f"unknown district {id}")
    return {"variable": variable, "data_mode": c.meta.get("data_mode"), "oblast": _label(T["oblast"], lang),
            "districts": [_label(e, lang) for e in T["districts"]]}
