"""Local FastAPI mirrors of the P1 routes (api/routers/p1_extras.py)."""
import re

import pytest
from fastapi.testclient import TestClient

from api.main import app

FORBIDDEN = re.compile(r"degradat|\bcause|деградац|причин", re.I)


@pytest.fixture(scope="module")
def cl():
    with TestClient(app) as c:
        yield c


def test_capacity(cl):
    r = cl.post("/api/capacity", json={"sel": "district:naryn", "lang": "ru"})
    assert r.status_code == 200
    j = r.json()
    assert j["label"] == "сценарий, не оценка" and j["unsourced"] and j["low"] <= j["central"] <= j["high"]
    assert not FORBIDDEN.search(r.text)
    assert cl.post("/api/capacity", json={"sel": "district:nope"}).status_code == 404


def test_passport(cl):
    r = cl.get("/api/passport.pdf?sel=district:kochkor&lang=ru")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    r = cl.get("/api/passport.csv?sel=point:41.5,75.5,5")
    assert r.status_code == 200 and "year,ndvi_may_sep_mean" in r.text
    assert cl.get("/api/passport.pdf?sel=garbage").status_code == 422
