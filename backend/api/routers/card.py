"""/card (F4, F6, F20): the 8-block answer for district / block / point (GET) or polygon / filter (POST)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from trendex_core import card as C, selection as SEL

from .. import deps
from ..schemas import Card, CardRequest

router = APIRouter(tags=["card"])


@router.get("/card", response_model=Card, response_model_by_alias=True)
@deps.http_errors
def get_card(sel: str = Query(..., examples=["district:at-bashy", "block:52202566", "point:41.42,75.98,5"]),
             lang: str = Depends(deps.lang_q), weights: str | None = None, season: str = "summer"):
    c = deps.core()
    s = SEL.parse(c, sel, lang)
    return C.build_card(c, s, lang, deps.parse_weights(weights), season)


@router.post("/card", response_model=Card, response_model_by_alias=True)
@deps.http_errors
def post_card(req: CardRequest):
    c = deps.core()
    if req.type == "polygon":
        if not req.geometry:
            raise HTTPException(422, "geometry required for type=polygon")
        s = SEL.polygon(c, req.geometry, req.lang)
    elif req.type == "filter":
        s = SEL.from_filter(c, req.filter or {}, req.lang)
    else:
        s = SEL.parse(c, req.sel or f"{req.type}:", req.lang)
    w = req.weights
    if w is not None:
        w = deps.parse_weights(",".join(f"{k}:{v}" for k, v in w.items()))
    return C.build_card(c, s, req.lang, w, req.season)
