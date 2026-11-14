"""Process-wide state: the Core loaded from artifacts at startup, plus cached JSON artifacts."""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException, Query

from trendex_core import config, ext
from trendex_core.core import Core
from trendex_core.selection import NotFound, SelError

log = logging.getLogger("trendex.api")
ART = Path(os.environ.get("TRENDEX_ARTIFACTS", config.ARTIFACTS))
_core: Core | None = None


def core() -> Core:
    global _core
    if _core is None:
        _core = Core.load(ART)
        _core.extra["_art"] = ART
        if (ART / "bin_fields.npz").exists():
            import numpy as np
            with np.load(ART / "bin_fields.npz") as z:
                _core.extra["bin_fields"] = {k: z[k] for k in z.files}
            mp = ART / "bin_meta.json"
            _core.extra["bin_meta"] = json.loads(mp.read_text()) if mp.exists() else {}
        ext.run("load", _core, ART)
        log.info("core loaded: %d cells, mode=%s", _core.N, _core.meta.get("data_mode"))
    return _core


@lru_cache(maxsize=64)
def art_json(name: str):
    p = ART / name
    if not p.exists():
        raise HTTPException(503, f"artifact {name} not built yet")
    return json.loads(p.read_text(encoding="utf-8"))


def lang_q(lang: str = Query("en", pattern="^(en|ru)$")) -> str:
    return lang


def parse_weights(w: str | None) -> dict | None:
    """'0.4,0.2,0.2,0.2' or 'green:0.4,stability:0.2,...'"""
    if not w:
        return None
    keys = ["green", "stability", "season", "terrain"]
    try:
        if ":" in w:
            d = {k.strip(): float(v) for k, v in (p.split(":") for p in w.split(","))}
        else:
            d = dict(zip(keys, (float(v) for v in w.split(","))))
    except ValueError as e:
        raise HTTPException(422, "weights must be 'g,s,se,t' or 'green:0.4,...'") from e
    if set(d) - set(keys) or any(v < 0 for v in d.values()) or sum(d.values()) <= 0:
        raise HTTPException(422, f"weights keys must be in {keys}, non-negative, not all zero")
    return {k: d.get(k, 0.0) for k in keys}


def http_errors(fn):
    """Translate selection errors to HTTP codes."""
    import functools

    @functools.wraps(fn)
    def wrap(*a, **kw):
        try:
            return fn(*a, **kw)
        except NotFound as e:
            raise HTTPException(404, str(e)) from e
        except SelError as e:
            raise HTTPException(422, str(e)) from e
    return wrap
