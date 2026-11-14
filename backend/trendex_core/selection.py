"""Turn a selection (district / block / point / polygon / filter) into a boolean cell mask."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely.geometry import shape

from .grid import haversine_km

MAX_RADIUS_KM = 50.0
MAX_POLYGON_KM2 = 5000.0


class SelError(ValueError):
    status = 422


class NotFound(LookupError):
    status = 404


@dataclass
class Selection:
    type: str
    id: str | None
    name: str
    mask: np.ndarray
    params: dict = field(default_factory=dict)

    @property
    def sel(self) -> str:
        return f"{self.type}:{self.id}" if self.id is not None else self.type


def district_name(core, slug: str, lang: str) -> str:
    names = core.cfg["district_names"].get(slug, {})
    base = names.get(lang) or names.get("en") or slug
    return f"{base} район" if lang == "ru" else f"{base} district"


def block_name(core, block_id, lang: str) -> str:
    from . import config
    t = config.texts(lang)["alternatives"]
    m = core.col("block_id") == int(block_id)
    d = core.col("district")[m]
    d = [v for v in d if v]
    if not d:
        return t["name_buffer"].format(id=block_id)
    dist = max(set(d), key=d.count)
    return t["name"].format(id=block_id, district=district_name(core, dist, lang))


def parse(core, sel: str, lang: str = "en") -> Selection:
    if not sel or ":" not in sel:
        raise SelError("sel must look like district:<slug>, block:<id> or point:<lat>,<lon>[,<radius_km>]")
    kind, val = sel.split(":", 1)
    kind = kind.strip().lower()
    if kind == "district":
        slug = val.strip().lower()
        if slug not in core.cfg["district_names"]:
            raise NotFound(f"unknown district '{slug}'")
        return Selection("district", slug, district_name(core, slug, lang), core.col("district") == slug)
    if kind == "block":
        try:
            bid = int(val)
        except ValueError as e:
            raise SelError("block id must be an integer") from e
        m = core.col("block_id") == bid
        if not m.any():
            raise NotFound(f"unknown block {bid}")
        return Selection("block", str(bid), block_name(core, bid, lang), m)
    if kind == "point":
        try:
            parts = [float(v) for v in val.split(",")]
            lat, lon = parts[0], parts[1]
            r = parts[2] if len(parts) > 2 else 5.0
        except (ValueError, IndexError) as e:
            raise SelError("point must be point:<lat>,<lon>[,<radius_km>]") from e
        return point(core, lat, lon, r, lang)
    raise SelError(f"unknown selection type '{kind}'")


def point(core, lat: float, lon: float, radius_km: float = 5.0, lang: str = "en") -> Selection:
    if not (0 < radius_km <= MAX_RADIUS_KM):
        raise SelError(f"radius must be in (0, {MAX_RADIUS_KM}] km")
    d = haversine_km(core.col("lat"), core.col("lon"), lat, lon)
    m = d <= radius_km
    if not m.any() and d.min() <= 1.0:  # tiny radius: take the nearest cell
        m = d == d.min()
    nm = (f"Точка {lat:.3f}, {lon:.3f} (радиус {radius_km:g} км)" if lang == "ru"
          else f"Point {lat:.3f}, {lon:.3f} (radius {radius_km:g} km)")
    return Selection("point", f"{lat:.5f},{lon:.5f},{radius_km:g}", nm, m, {"lat": lat, "lon": lon, "radius_km": radius_km})


def polygon(core, geometry: dict, lang: str = "en") -> Selection:
    try:
        g = shape(geometry).buffer(0)
    except Exception as e:  # noqa: BLE001
        raise SelError(f"invalid GeoJSON geometry: {e}") from e
    if g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon"):
        raise SelError("geometry must be a Polygon or MultiPolygon in EPSG:4326")
    from .io.boundaries import to_sinu
    km2 = to_sinu(g).area / 1e6
    if km2 > MAX_POLYGON_KM2:
        raise SelError(f"polygon is {km2:.0f} km²; max {MAX_POLYGON_KM2:.0f} km²")
    shapely.prepare(g)
    m = shapely.contains_xy(g, core.col("lon"), core.col("lat"))
    nm = "Нарисованный участок" if lang == "ru" else "Drawn area"
    return Selection("polygon", None, nm, m, {"area_km2": km2})


def from_filter(core, f: dict, lang: str = "en", name: str | None = None) -> Selection:
    """Filter from the text query (F13): district / point+radius, elevation band."""
    m = np.ones(core.N, dtype=bool)
    if f.get("district"):
        m &= core.col("district") == f["district"]
    if f.get("lat") is not None and f.get("lon") is not None:
        r = min(float(f.get("radius_km") or 10.0), MAX_RADIUS_KM)
        m &= haversine_km(core.col("lat"), core.col("lon"), f["lat"], f["lon"]) <= r
    elev = core.col("elev_mean")
    if f.get("elev_min") is not None:
        m &= elev >= float(f["elev_min"])
    if f.get("elev_max") is not None:
        m &= elev <= float(f["elev_max"])
    if not f.get("district") and f.get("lat") is None:
        m &= core.in_region
    return Selection("filter", None, name or ("Фильтр" if lang == "ru" else "Filter"), m, dict(f))
