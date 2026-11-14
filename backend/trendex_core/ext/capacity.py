"""F22 capacity scenario: heads = A_ha·B·u / (I·D), B = a + b·NDVI_peak, as low / central / high.

Every default lives in configs/capacity.yaml and is a placeholder until the team sources it; the result is
always labelled "scenario, not an estimate" and lists the unsourced parameters. The Edge Function computes it
(supabase/functions/trendex-api/capacity.ts) from export/v1/capacity.json; scenario() here is the reference.
"""
from __future__ import annotations

import json
from pathlib import Path

from .. import config

FEATURE = "capacity"
PARAMS = ("a", "b", "u", "I", "D")


def cfg() -> dict | None:
    return config.optional("capacity.yaml")


def available(core) -> bool:
    return cfg() is not None


def export(core, out_dir) -> None:
    c = cfg()
    if c:
        (Path(out_dir) / "capacity.json").write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")


def _sig(x: float | None, n: int = 2) -> float | None:
    if x is None or x != x:
        return None
    if x == 0:
        return 0.0
    from math import floor, log10
    return round(x, -int(floor(log10(abs(x)))) + (n - 1))


def merge(c: dict, assumptions: dict | None) -> tuple[dict, list]:
    """Defaults + user overrides. A number fixes low = central = high; a dict overrides some ends."""
    out, unsourced = {}, []
    for k in PARAMS:
        p = dict(c["parameters"][k])
        o = (assumptions or {}).get(k)
        if isinstance(o, (int, float)) and not isinstance(o, bool):
            p.update(low=float(o), central=float(o), high=float(o), source="user", placeholder=False)
        elif isinstance(o, dict):
            p.update({e: float(o[e]) for e in ("low", "central", "high") if isinstance(o.get(e), (int, float))})
            p.update(source=str(o.get("source") or "user"), placeholder=False)
        if p.get("placeholder") or not p.get("source"):
            unsourced.append(k)
        out[k] = p
    return out, unsourced


def scenario(card: dict, assumptions: dict | None = None, lang: str = "en") -> dict:
    c = cfg()
    P, unsourced = merge(c, assumptions)
    pasture_km2 = (card.get("area") or {}).get("pasture_km2") or 0.0
    ndvi = (card.get("dynamics") or {}).get("mean")
    A = pasture_km2 * 100.0

    def end(name: str, scen: str):  # low scenario takes the end of each parameter that lowers heads
        p = P[name]
        if scen == "central":
            return p["central"]
        want_up = scen == "high"
        up = p.get("heads_effect", "up") == "up"
        return max(p["low"], p["high"]) if want_up == up else min(p["low"], p["high"])

    heads, biomass = {}, {}
    for s in ("low", "central", "high"):
        if ndvi is None or A <= 0:
            heads[s] = biomass[s] = None
            continue
        B = max(0.0, end("a", s) + end("b", s) * ndvi)
        biomass[s] = round(B, 0)
        heads[s] = _sig(A * B * end("u", s) / (end("I", s) * end("D", s)))
    return {"label": c["label"][lang], "formula": c["formula"], "head_unit": c["head_unit"][lang],
            "low": heads["low"], "central": heads["central"], "high": heads["high"], "biomass_kg_dm_ha": biomass,
            "inputs": {"sel": (card.get("selection") or {}).get("sel"), "name": (card.get("selection") or {}).get("name"),
                       "pasture_km2": pasture_km2, "A_ha": A, "ndvi_peak": ndvi, "ndvi_peak_source": c["ndvi_peak_source"]},
            "assumptions": P, "unsourced": unsourced, "caveats": c["caveats"][lang],
            "data_mode": (card.get("meta") or {}).get("data_mode")}
