"""/health and /meta (F11, all)."""
from fastapi import APIRouter, Depends

from trendex_core import config, ext

from .. import deps
from ..schemas import Health

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health)
def health():
    try:
        c = deps.core()
    except Exception as e:  # noqa: BLE001
        return Health(status=f"no artifacts: {e}", data_mode=None, data_version=None, config_hash=None, computed_at=None)
    m = c.meta
    return Health(status="ok", data_mode=m.get("data_mode"), data_version=str(m.get("data_version")),
                  config_hash=m.get("config_hash"), computed_at=m.get("computed_at"), n_cells=c.N)


@router.get("/meta")
def meta(lang: str = Depends(deps.lang_q)):
    c = deps.core()
    cfg = c.cfg
    t = config.texts(lang)
    D = c.blocks
    districts = []
    for slug, names in cfg["district_names"].items():
        m = c.col("district") == slug
        lat, lon = c.col("lat")[m], c.col("lon")[m]
        districts.append({"id": slug, "sel": f"district:{slug}", "name": names.get(lang, names["en"]),
                          "names": names, "bbox": [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]})
    feats = {"core": True, "polygon": True, "compare": True, "weights": True}
    feats.update(ext.features(c))
    return {"data_mode": c.meta.get("data_mode"), "mock_banner": t["mock_banner"] if c.meta.get("data_mode") == "mock" else None,
            "years": [int(c.years[0]), int(c.years[-1])], "districts": districts,
            "labels": t["labels"], "actions": t["actions"], "action_note": t["action_note"],
            "matrix": config.matrix(), "weights_default": cfg["weights"],
            "level_thresholds": cfg["level_thresholds"], "features": feats,
            "config_hash": c.meta.get("config_hash"), "n_blocks": int(len(D)) if D is not None else 0}
