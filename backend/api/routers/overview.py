"""/overview (F7, F8): headline, 3x3 matrix, district table, top and decline zones."""
import copy

from fastapi import APIRouter, Depends

from trendex_core import config, products
from trendex_core.selection import district_name

from .. import deps

router = APIRouter(tags=["overview"])


@router.get("/overview")
def overview(lang: str = Depends(deps.lang_q)):
    c = deps.core()
    t = config.texts(lang)
    ov = copy.deepcopy(deps.art_json("overview.json"))
    ov["headline"]["sentence"] = products.headline_sentence(ov, c, lang)
    for row in ov["matrix"]:
        row["action"] = t["actions"][row["action_key"]]
        row["level_label"] = t["labels"]["level"][row["level"]]
        row["dynamics_label"] = t["labels"]["dynamics"][row["dynamics"]]
    pd_ = c.extra.get("precip_districts", {})
    for row in ov["districts"]:
        row["name"] = district_name(c, row["id"], lang)
        row["sel"] = f"district:{row['id']}"
        row["precip_trend"] = pd_.get(row["id"])  # F23 toggle; None until built
    for z in ov["top_zones"]:
        z["district_name"] = district_name(c, z["district"], lang) if z.get("district") else None
    for z in ov["decline_zones"]:
        z["action"] = t["actions"][z["action_key"]]
        z["district_name"] = district_name(c, z["district"], lang) if z.get("district") else None
    ov["data_mode"] = c.meta.get("data_mode")
    ov["layers_default"] = "trend_class"
    return ov
