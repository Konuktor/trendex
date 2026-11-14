"""District and block polygons with summary properties (F5, F7)."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import deps

router = APIRouter(tags=["zones"])


@router.get("/zones/{name}.geojson")
def zones(name: str):
    if name not in ("districts", "blocks"):
        raise HTTPException(404, "use districts or blocks")
    return FileResponse(deps.ART / "zones" / f"{name}.geojson", media_type="application/geo+json",
                        headers={"Cache-Control": "public, max-age=600"})
