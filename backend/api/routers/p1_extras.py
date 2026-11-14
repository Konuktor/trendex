"""Local mirrors of P1 Edge routes (F22 capacity, F18 passports). The text query (F13) runs only in the Edge Function."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from trendex_core.card import build_card
from trendex_core.ext import capacity, passport
from trendex_core.selection import parse

from .. import deps

router = APIRouter(tags=["p1"])


class CapacityRequest(BaseModel):
    sel: str
    assumptions: Optional[dict[str, Any]] = None
    lang: str = "en"


@router.post("/capacity")
@deps.http_errors
def capacity_scenario(body: CapacityRequest):
    if capacity.cfg() is None:
        raise HTTPException(503, "configs/capacity.yaml missing")
    lang = body.lang if body.lang in ("en", "ru") else "en"
    core = deps.core()
    return capacity.scenario(build_card(core, parse(core, body.sel, lang), lang), body.assumptions, lang)


@router.get("/passport.{fmt}")
@deps.http_errors
def passport_file(fmt: str, sel: str = Query(...), lang: str = Depends(deps.lang_q)):
    if fmt not in ("pdf", "csv"):
        raise HTTPException(404, "use passport.pdf or passport.csv")
    core = deps.core()
    card = build_card(core, parse(core, sel, lang), lang)
    name = f"trendex_passport_{sel.replace(':', '_').replace(',', '_')}_{lang}.{fmt}"
    if fmt == "csv":
        return Response(passport.csv_bytes(card, lang), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})
    from trendex_core import config
    png = passport._Chart().png(card.get("dynamics"))
    banner = config.texts(lang)["mock_banner"] if core.meta.get("data_mode") == "mock" else None
    return Response(passport.pdf_bytes(card, lang, png, banner), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{name}"'})
