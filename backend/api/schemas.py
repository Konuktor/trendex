"""API contract v1. Every P1 field exists from day one as Optional (None = not ready -> UI hides it).

Owner: workstream A. Parallel sessions request changes here instead of editing it.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

LevelClass = Literal["suitable", "limited", "low"]
DynClass = Literal["growth", "decline", "unreliable", "insufficient"]
SeasonClass = Literal["below", "within", "above"]
ConfLevel = Literal["high", "medium", "low"]
DataMode = Literal["mock", "real"]


class Loose(BaseModel):
    model_config = ConfigDict(extra="allow")


class LatLon(BaseModel):
    lat: float
    lon: float


class SelectionOut(Loose):
    type: Literal["district", "block", "point", "polygon", "filter"]
    id: Optional[str] = None
    sel: str
    name: str
    centroid: Optional[LatLon] = None
    districts: list[str] = []
    params: dict[str, Any] = {}


class AreaOut(Loose):
    total_km2: float
    pasture_km2: float
    excluded_km2: dict[str, float]
    insufficient_km2: float
    n_cells: int


class Component(Loose):
    key: Literal["green", "stability", "season", "terrain"]
    label: str
    percentile: Optional[float] = Field(None, description="0-100, relative to Naryn pastures")
    raw: Optional[float] = None
    unit: str


class LevelOut(Loose):
    class_: LevelClass = Field(alias="class")
    label: str
    score: float = Field(description="0-100")
    class_shares: dict[str, float]
    components: list[Component]
    relative_note: str


class SeriesPoint(BaseModel):
    year: int
    value: Optional[float] = None
    n_valid_cells: int = 0


class DynamicsOut(Loose):
    class_: DynClass = Field(alias="class")
    label: str
    period: list[int]
    slope_per_decade: Optional[float] = Field(None, description="NDVI units per decade (Sen slope)")
    ci95: Optional[list[float]] = Field(None, description="95% CI of slope, NDVI per decade")
    pct_per_decade: Optional[float] = None
    p_value: Optional[float] = None
    method: str
    n_years: int
    mean: Optional[float] = None
    series: list[SeriesPoint]
    fit: dict[str, Optional[float]]
    cell_shares: dict[str, float]


class Reason(BaseModel):
    key: str
    text: str


class ReasonsOut(BaseModel):
    pro: list[Reason] = []
    con: list[Reason] = []


class ConfidenceOut(BaseModel):
    level: ConfLevel
    label: str
    factors: list[Reason]


class VsExpected(Loose):
    class_: Optional[SeasonClass] = Field(None, alias="class")
    expected: Optional[float] = None
    p10: Optional[float] = None
    p90: Optional[float] = None
    text: Optional[str] = None


class SeasonOut(Loose):
    year: int
    value: Optional[float] = None
    percentile: Optional[float] = None
    class_: SeasonClass = Field(alias="class")
    label: str
    baseline: list[int]
    text: str
    vs_expected: Optional[VsExpected] = None


class AltItem(Loose):
    sel: str
    name: str
    distance_km: float
    score: float
    level_class: LevelClass
    level_label: str
    dynamics_class: DynClass
    dynamics_label: str
    centroid: LatLon
    pasture_km2: float
    reasons: list[str]


class AlternativesOut(BaseModel):
    radius_km: float
    items: list[AltItem] = []
    note: Optional[str] = None


class ActionOut(Loose):
    key: str
    text: str
    note: str
    cell: Optional[dict[str, Optional[str]]] = None


# ---- P1 extras (all optional) ----
class TrendLite(Loose):
    slope_per_decade: Optional[float] = None
    ci95: Optional[list[float]] = None
    p_value: Optional[float] = None
    class_: Optional[DynClass] = Field(None, alias="class")
    unit: Optional[str] = None
    text: Optional[str] = None


class AccessOut(Loose):
    road_km: Optional[float] = None
    water_km: Optional[float] = None
    settlement_km: Optional[float] = None
    note: Optional[str] = None


class Flag(Loose):
    key: str
    text: str
    share: Optional[float] = None


class Extras(Loose):
    precip: Optional[TrendLite] = None            # F23
    beyond_weather: Optional[TrendLite] = None    # F15 / S5
    flags: Optional[list[Flag]] = None            # F15 suspicious growth etc.
    access: Optional[AccessOut] = None            # F16
    season_variant: Optional[dict[str, Any]] = None   # F14
    snow: Optional[dict[str, Any]] = None             # F14
    capacity_hint: Optional[dict[str, Any]] = None    # F22


class CardMeta(Loose):
    lang: str
    data_mode: Optional[DataMode] = None
    data_version: Optional[str] = None
    config_hash: Optional[str] = None
    weights: dict[str, float]
    season: str
    computed_at: Optional[str] = None
    generated_at: str


class Card(Loose):
    selection: SelectionOut
    status: Literal["ok", "excluded", "insufficient", "outside_aoi"]
    area: Optional[AreaOut] = None
    level: Optional[LevelOut] = None            # block 1
    dynamics: Optional[DynamicsOut] = None      # block 2
    reasons: ReasonsOut                          # block 3
    confidence: Optional[ConfidenceOut] = None  # block 4
    season: Optional[SeasonOut] = None          # block 5
    alternatives: Optional[AlternativesOut] = None  # block 6
    action: Optional[ActionOut] = None          # block 7
    not_considered: list[str]                   # block 8
    extras: Extras = Extras()
    meta: CardMeta


class CardRequest(BaseModel):
    type: Literal["polygon", "filter", "district", "block", "point"] = "polygon"
    geometry: Optional[dict[str, Any]] = None
    filter: Optional[dict[str, Any]] = None
    sel: Optional[str] = None
    lang: Literal["en", "ru"] = "en"
    weights: Optional[dict[str, float]] = None
    season: str = "summer"


class Health(BaseModel):
    status: str
    data_mode: Optional[str]
    data_version: Optional[str]
    config_hash: Optional[str]
    computed_at: Optional[str]
    n_cells: Optional[int] = None


class QueueZone(Loose):
    rank: int
    zone_id: str
    district: Optional[str]
    district_name: Optional[str] = None
    lat: float
    lon: float
    area_km2: float
    n_cells: int
    level: LevelClass
    score: float
    dynamics: DynClass
    slope_per_decade: Optional[float]
    ci_lo: Optional[float]
    ci_hi: Optional[float]
    p_value: Optional[float]
    pct_per_decade: Optional[float]
    confidence: ConfLevel
    action_key: str
    action: Optional[str] = None
    blocks: list[int]


class RecomputeRequest(BaseModel):
    weights: dict[str, float]
    lang: Literal["en", "ru"] = "en"


# Responses that are large / evolving are returned as loose dicts (documented in docs/API.md):
# /overview, /trends, /methods, /layers, /meta, /query, /capacity, /ml/*, /forecast
