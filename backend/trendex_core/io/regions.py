"""Central Asia regions: geoBoundaries gbOpen ADM0/ADM1 for KAZ, KGZ, TJK, TKM, UZB (simplified)."""
from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache

import numpy as np
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union

from .. import config

CA_DIR = config.DATA / "boundaries" / "ca"
COUNTRIES = {"KAZ": ("KZ", "Kazakhstan", "Казахстан"), "KGZ": ("KG", "Kyrgyzstan", "Кыргызстан"),
             "TJK": ("TJ", "Tajikistan", "Таджикистан"), "TKM": ("TM", "Turkmenistan", "Туркменистан"),
             "UZB": ("UZ", "Uzbekistan", "Узбекистан")}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


@lru_cache
def regions() -> list[dict]:
    """[{code, name, country (ISO3), iso2, countryName, countryNameRu, geom}] for every ADM1 region."""
    out = []
    for iso3, (iso2, en, ru) in COUNTRIES.items():
        gj = json.loads((CA_DIR / f"{iso3}_ADM1.geojson").read_text(encoding="utf-8"))
        seen = set()
        for f in gj["features"]:
            name = f["properties"].get("shapeName") or f["properties"].get("shapeISO") or "region"
            code = f"{iso2}-{slug(name)}"
            if code in seen:
                code = f"{code}-{len(seen)}"
            seen.add(code)
            out.append({"code": code, "name": name, "country": iso3, "iso2": iso2, "countryName": en,
                        "countryNameRu": ru, "geom": shape(f["geometry"]).buffer(0)})
    return out


@lru_cache
def ca_union():
    geoms = []
    for iso3 in COUNTRIES:
        gj = json.loads((CA_DIR / f"{iso3}_ADM0.geojson").read_text(encoding="utf-8"))
        geoms += [shape(f["geometry"]).buffer(0) for f in gj["features"]]
    return unary_union(geoms)


def assign(lon, lat) -> np.ndarray:
    """Region code for lon/lat points (EPSG:4326); None outside the five countries."""
    lon = np.asarray(lon, dtype=float)
    lat = np.asarray(lat, dtype=float)
    out = np.full(len(lon), None, dtype=object)
    for r in regions():
        g = r["geom"]
        b = g.bounds
        cand = np.flatnonzero((out == None) & (lon >= b[0]) & (lon <= b[2]) & (lat >= b[1]) & (lat <= b[3]))  # noqa: E711
        if not len(cand):
            continue
        shapely.prepare(g)
        hit = shapely.contains_xy(g, lon[cand], lat[cand])
        out[cand[hit]] = r["code"]
    return out


def district_names() -> dict:
    """Same shape as core_v1.yaml district_names: code -> {en, ru} (ADM1 names are kept as published)."""
    return {r["code"]: {"en": r["name"], "ru": r["name"], "country": r["country"]} for r in regions()}
