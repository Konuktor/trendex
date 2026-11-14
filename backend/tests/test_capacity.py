"""F22 capacity scenario: formula, range ordering, placeholders always named."""
import json

from trendex_core.ext import capacity


def _card(km2=100.0, ndvi=0.4):
    return {"selection": {"sel": "district:naryn", "name": "Naryn"}, "area": {"pasture_km2": km2},
            "dynamics": {"mean": ndvi}, "meta": {"data_mode": "mock"}}


def test_formula_and_labels():
    c = capacity.cfg()
    P = c["parameters"]
    r = capacity.scenario(_card(), lang="ru")
    B = P["a"]["central"] + P["b"]["central"] * 0.4
    want = 100 * 100 * B * P["u"]["central"] / (P["I"]["central"] * P["D"]["central"])
    assert abs(r["central"] - want) / want < 0.05          # 2 significant digits
    assert r["low"] <= r["central"] <= r["high"]
    assert r["label"] == "сценарий, не оценка"
    assert set(r["unsourced"]) == {"a", "b", "u", "I", "D"}   # every default is a placeholder
    assert all(P[k]["placeholder"] and P[k]["source"] == "" for k in capacity.PARAMS)


def test_overrides_and_empty():
    r = capacity.scenario(_card(), {"u": 0.5, "I": {"low": 1.8, "high": 2.2, "source": "team note"}})
    assert r["assumptions"]["u"]["low"] == r["assumptions"]["u"]["high"] == 0.5
    assert "u" not in r["unsourced"] and "I" not in r["unsourced"] and "a" in r["unsourced"]
    assert r["assumptions"]["I"]["source"] == "team note"
    e = capacity.scenario(_card(km2=0))
    assert e["central"] is None


def test_export(tmp_path):
    capacity.export(None, tmp_path)
    d = json.loads((tmp_path / "capacity.json").read_text())
    assert d["label"]["en"] == "scenario, not an estimate" and set(d["parameters"]) == set(capacity.PARAMS)
