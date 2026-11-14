"""/queue and /queue.csv (F21): zones with a good/medium level and a steady decline, for field checks."""
import copy

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from trendex_core import config, products
from trendex_core.selection import district_name

from .. import deps
from ..schemas import QueueZone

router = APIRouter(tags=["queue"])


def _filtered(district, level, limit):
    zones = deps.art_json("queue.json")
    out = [z for z in zones if (not district or z["district"] == district) and (not level or z["level"] == level)]
    return out[:limit] if limit else out


@router.get("/queue", response_model=list[QueueZone])
def queue(district: str | None = None, level: str | None = Query(None, pattern="^(suitable|limited)$"),
          limit: int | None = Query(None, ge=1, le=1000), lang: str = Depends(deps.lang_q)):
    c = deps.core()
    t = config.texts(lang)
    out = []
    for z in copy.deepcopy(_filtered(district, level, limit)):
        z["action"] = t["actions"][z["action_key"]]
        z["district_name"] = district_name(c, z["district"], lang) if z["district"] else None
        out.append(z)
    return out


@router.get("/queue.csv", responses={200: {"content": {"text/csv": {}}}})
def queue_csv(district: str | None = None, level: str | None = Query(None, pattern="^(suitable|limited)$"),
              limit: int | None = Query(None, ge=1, le=1000), lang: str = Depends(deps.lang_q)):
    c = deps.core()
    data = products.queue_csv(_filtered(district, level, limit), c, lang)
    return Response(data, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="trendex_inspection_queue_{lang}.csv"'})
