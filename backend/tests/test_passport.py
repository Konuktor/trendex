"""F18 passports: one-page PDF (Cyrillic font, chart) and CSV for a district and a block."""
import re

import pytest

from trendex_core import config
from trendex_core.core import Core
from trendex_core.ext import passport

FORBIDDEN = re.compile(r"degradat|\bcause|деградац|причин", re.I)


@pytest.fixture(scope="module")
def core():
    if not (config.ARTIFACTS / "core.json").exists():
        pytest.skip("artifacts not built")
    return Core.load(config.ARTIFACTS)


def test_texts_clean():
    for lang in passport.LANGS:
        assert not FORBIDDEN.search(repr(passport.T[lang]))


def test_district_and_block(core, tmp_path):
    chart = passport._Chart()
    sels = passport.targets(core)
    assert sels[0].startswith("district:") and any(s.startswith("block:") for s in sels)
    for s in (sels[0], next(s for s in sels if s.startswith("block:"))):
        passport._write(core, chart, s, tmp_path)
        kind, val = s.split(":")
        for lang in passport.LANGS:
            pdf = (tmp_path / kind / f"{val}_{lang}.pdf").read_bytes()
            assert pdf.startswith(b"%PDF") and len(pdf) > 20_000
            assert len(re.findall(rb"/Type\s*/Page[^s]", pdf)) == 1          # one page
            assert b"DejaVu" in pdf                                          # embedded Cyrillic font
            assert b"/Subtype /Image" in pdf                                 # the chart
            txt = (tmp_path / kind / f"{val}_{lang}.csv").read_text(encoding="utf-8")
            assert txt.startswith("﻿section,key,value") and "year,ndvi_may_sep_mean,sen_fit" in txt
            assert not FORBIDDEN.search(txt)
