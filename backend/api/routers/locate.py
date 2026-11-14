"""Click helpers (F5): /locate and /point."""
import numpy as np
from fastapi import APIRouter, Query

from trendex_core.grid import haversine_km, lonlat_to_xy

from .. import deps

router = APIRouter(tags=["locate"])


def _nearest(c, lat, lon):
    x, y = lonlat_to_xy(lon, lat)
    r, cc = c.grid.local_rc(np.array([x]), np.array([y]))
    r, cc = int(r[0]), int(cc[0])
    if 0 <= r < c.grid.H and 0 <= cc < c.grid.W and c.index[r, cc] >= 0:
        return int(c.index[r, cc])
    return None


@router.get("/locate")
def locate(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    c = deps.core()
    i = _nearest(c, lat, lon)
    if i is None:
        return {"inside_aoi": False, "lat": lat, "lon": lon}
    row = c.cells.iloc[i]
    return {"inside_aoi": True, "in_region": bool(row["district"]), "cell_id": row["cell_id"],
            "block_id": int(row["block_id"]), "district": row["district"],
            "sel_block": f"block:{int(row['block_id'])}",
            "sel_district": f"district:{row['district']}" if row["district"] else None,
            "sel_point": f"point:{lat:.5f},{lon:.5f},5"}


@router.get("/point")
def point(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    c = deps.core()
    i = _nearest(c, lat, lon)
    if i is None:
        return {"inside_aoi": False}
    row = c.cells.iloc[i]
    keys = ["cell_id", "district", "block_id", "status", "elev_mean", "slope_mean", "lc_major", "score", "level_class",
            "trend_class", "trend_pct_decade", "trend_p", "trend_q", "season_class", "season_pct", "green", "valid_frac"]
    out = {k: row[k] for k in keys if k in row}
    out["series"] = [None if not np.isfinite(v) else float(v) for v in c.S[i]]
    out["years"] = [int(c.years[0]), int(c.years[-1])]
    from trendex_core.core import clean
    return clean({"inside_aoi": True, **out})
