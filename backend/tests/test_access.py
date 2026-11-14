"""F16 access: rasterize + distance transform on a synthetic OSM response (no network)."""
import numpy as np
import pytest

from trendex_core import config
from trendex_core.core import Core
from trendex_core.ext import access
from trendex_core.selection import parse


@pytest.fixture(scope="module")
def core():
    if not (config.ARTIFACTS / "core.json").exists():
        pytest.skip("artifacts not built")
    return Core.load(config.ARTIFACTS)


def _osm(core):
    lat, lon = core.col("lat"), core.col("lon")
    la, lo = float(np.median(lat)), float(np.median(lon))
    road = {"type": "way", "tags": {"highway": "track"},
            "geometry": [{"lat": la, "lon": lo - 0.5}, {"lat": la, "lon": lo + 0.5}]}
    lake = {"type": "way", "tags": {"natural": "water", "name": "Test-Kul", "name:ru": "Тест-Куль"},
            "geometry": [{"lat": la + 0.3, "lon": lo}, {"lat": la + 0.3, "lon": lo + 0.1}, {"lat": la + 0.4, "lon": lo + 0.1},
                         {"lat": la + 0.3, "lon": lo}]}
    town = {"type": "node", "lat": la - 0.2, "lon": lo, "tags": {"place": "village", "name": "Testovka", "name:ky": "Тестовка"}}
    return {"elements": [road, lake, town]}, la, lo


def test_distances_and_hooks(core):
    osm, la, lo = _osm(core)
    feats = access.compute(core, osm)
    d = core.col("dist_road_km")
    assert d.dtype == np.float32 and len(d) == core.N and np.isfinite(d).all()
    lat, lon = core.col("lat"), core.col("lon")
    on_road = (np.abs(lat - la) < 0.003) & (np.abs(lon - lo) < 0.3)
    assert on_road.any() and d[on_road].max() < 1.0
    # a cell ~0.1 deg (~11 km) north of the road is ~11 km away
    far = (np.abs(lat - (la + 0.1)) < 0.004) & (np.abs(lon - lo) < 0.2)
    assert far.any() and 9 < float(np.median(d[far])) < 13
    s = core.col("dist_settlement_km")
    i = int(np.argmin(s))
    assert abs(lat[i] - (la - 0.2)) < 0.02 and s[i] < 1.0
    assert np.nanmin(core.col("dist_water_km")) == 0.0

    gz = access.gazetteer(core, feats)
    names = {g["name"] for g in gz}
    assert {"Test-Kul", "Testovka"} <= names
    assert any(g["names"].get("name:ky") == "Тестовка" for g in gz)

    core.extra["access_meta"] = {"settlement_p75_km": 1.0}
    access._publish(core)
    assert set(access.FIELDS) <= set(core.extra["bin_fields"])
    assert core.extra["bin_fields"]["dist_road_km"].dtype == np.float32

    sel = parse(core, "district:naryn", "ru")
    p = sel.mask & core.pasture
    k, v = access.card_extra(core, sel, {"pasture": p, "lang": "ru"})
    assert k == "access" and v["road_km"] is not None and "OpenStreetMap" in v["note"]

    specs = access.layers(core)
    keys = [s[0] for s in specs]
    assert keys == ["access_road", "underused"]
    for key, kind, codes, legend in specs:
        assert codes.dtype == np.uint8 and len(codes) == core.N and codes.max() <= len(legend)


def test_bbox_and_query():
    b = access.bbox_of(np.array([73.39, 78.28]), np.array([40.1, 42.63]))
    assert b == (39.9, 73.1, 42.9, 78.5)
    q = access.overpass_query(b)
    assert "highway" in q and "waterway" in q and 'place' in q and "out geom" in q
