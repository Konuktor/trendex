"""Contract tests on whatever artifacts/ holds (mock or real)."""
import re
import time

import pytest
from fastapi.testclient import TestClient

from api.main import app

FORBIDDEN = re.compile(r"degradat|\bcause|деградац|причин", re.I)


@pytest.fixture(scope="module")
def cl():
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("url", ["/api/health", "/api/meta", "/api/overview?lang=ru", "/api/layers", "/api/trends",
                                 "/api/queue", "/api/methods", "/api/zones/blocks.geojson", "/api/card?sel=district:naryn",
                                 "/api/compare?a=district:naryn&b=district:kochkor"])
def test_ok(cl, url):
    r = cl.get(url)
    assert r.status_code == 200
    if "json" in r.headers["content-type"]:
        assert not FORBIDDEN.search(r.text)


def test_errors(cl):
    assert cl.get("/api/card?sel=district:nope").status_code == 404
    assert cl.get("/api/card?sel=garbage").status_code == 422
    assert cl.get("/api/card?sel=point:41,75,500").status_code == 422
    assert cl.get("/api/card?sel=point:10,10,5").json()["status"] == "outside_aoi"


def test_card_blocks_and_latency(cl):
    for sel in ("district:at-bashy", "point:41.5,75.5,5", "point:41.9,75.3,20"):
        t = time.time()
        c = cl.get(f"/api/card?sel={sel}&lang=en").json()
        assert time.time() - t < 0.5
        if c["status"] == "ok":
            for k in ("level", "dynamics", "confidence", "alternatives", "action"):
                assert c[k] is not None
            assert c["meta"]["data_mode"] in ("mock", "real")


def test_alternatives_rules(cl):
    q = cl.get("/api/zones/blocks.geojson").json()
    low = [f["properties"]["sel"] for f in q["features"] if f["properties"]["level_class"] == "low" and f["properties"]["in_region"]][:5]
    for sel in low:
        c = cl.get(f"/api/card?sel={sel}").json()
        for it in c["alternatives"]["items"]:
            assert it["distance_km"] <= c["alternatives"]["radius_km"]
            assert it["score"] > c["level"]["score"]
            assert it["dynamics_class"] != "decline"


def test_queue_csv_bom(cl):
    r = cl.get("/api/queue.csv?lang=ru")
    assert r.content.startswith("﻿".encode())
