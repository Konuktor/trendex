"""District boundaries (geoBoundaries gbOpen KGZ ADM2, CC BY 4.0)."""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np
import shapely
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform, unary_union

from .. import config
from ..grid import _to_sinu

ADM2 = config.DATA / "boundaries" / "KGZ_ADM2.geojson"


@lru_cache
def districts_ll() -> dict:
    """slug -> shapely geometry (EPSG:4326)."""
    cfg = config.core()
    names = cfg["districts"]
    gj = json.loads(ADM2.read_text(encoding="utf-8"))
    out = {}
    for f in gj["features"]:
        nm = f["properties"]["shapeName"]
        if nm in names:
            out[names[nm]] = shape(f["geometry"]).buffer(0)
    missing = set(names.values()) - set(out)
    if missing:
        raise RuntimeError(f"districts missing in {ADM2.name}: {missing}")
    return out


def to_sinu(geom):
    return shp_transform(lambda x, y, z=None: _to_sinu.transform(x, y), geom)


@lru_cache
def districts_sinu() -> dict:
    return {k: to_sinu(g) for k, g in districts_ll().items()}


@lru_cache
def region_ll():
    return unary_union(list(districts_ll().values()))


def aoi_ll(buffer_km: float = 20.0):
    reg = to_sinu(region_ll()).buffer(buffer_km * 1000.0)
    from ..grid import _to_ll
    return shp_transform(lambda x, y, z=None: _to_ll.transform(x, y), reg)


def zones_ll() -> dict:
    """code -> geometry (EPSG:4326) for the active profile: Naryn districts or Central Asia ADM1 regions."""
    if config.core().get("zones") == "ca_adm1":
        from .regions import regions
        return {r["code"]: r["geom"] for r in regions()}
    return districts_ll()


def assign_zone(x, y, lon=None, lat=None) -> np.ndarray:
    """Zone code per cell for the active profile (district for Naryn, ADM1 region for Central Asia)."""
    if config.core().get("zones") == "ca_adm1":
        from .regions import assign
        return assign(lon, lat)
    return assign_district(x, y)


def assign_district(x, y) -> np.ndarray:
    """District slug for sinusoidal points; None outside Naryn region."""
    x = np.asarray(x)
    y = np.asarray(y)
    out = np.full(len(x), None, dtype=object)
    for slug, g in districts_sinu().items():
        shapely.prepare(g)
        inside = shapely.contains_xy(g, x, y)
        out[inside & (out == None)] = slug  # noqa: E711
    return out


def districts_geojson(props: dict | None = None, tolerance: float = 0.003) -> dict:
    feats = []
    for slug, g in zones_ll().items():
        p = {"id": slug}
        if props and slug in props:
            p.update(props[slug])
        feats.append({"type": "Feature", "properties": p,
                      "geometry": mapping(g.simplify(tolerance, preserve_topology=True))})
    return {"type": "FeatureCollection", "features": feats}
