"""Plugin seam for P1 features. Each module in this package may define:

- build_step(core, cube) -> None          offline, during pipeline/build.py (write into core.extra / artifacts)
- load(core, art_dir) -> None             at API startup, load its own artifacts into core.extra
- card_extra(core, sel, ctx) -> (key, value)   adds card.extras[key]; must be fast
- layers(core) -> list[(key, kind, array_or_classes, legend)]   extra map layers
- FEATURE: str                            feature flag name reported in /meta

Parallel sessions add modules here and never edit card.py / build.py.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil

log = logging.getLogger("trendex.ext")
_MODS = None


def modules():
    global _MODS
    if _MODS is None:
        _MODS = []
        for m in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
            if m.name.startswith("_"):
                continue
            try:
                _MODS.append(importlib.import_module(f"{__name__}.{m.name}"))
            except Exception:  # noqa: BLE001
                log.exception("ext module %s failed to import", m.name)
    return _MODS


def run(hook: str, *args, **kw):
    out = []
    for mod in modules():
        fn = getattr(mod, hook, None)
        if fn is None:
            continue
        try:
            out.append((mod.__name__.rsplit(".", 1)[-1], fn(*args, **kw)))
        except Exception:  # noqa: BLE001
            log.exception("ext %s.%s failed", mod.__name__, hook)
    return out


def card_extras(core, sel, ctx) -> dict:
    extras = {}
    for _, res in run("card_extra", core, sel, ctx):
        if res:
            k, v = res
            extras[k] = v
    return extras


def features(core) -> dict:
    out = {}
    for mod in modules():
        name = getattr(mod, "FEATURE", None)
        if name:
            avail = getattr(mod, "available", None)
            try:
                out[name] = bool(avail(core)) if callable(avail) else True
            except Exception:  # noqa: BLE001
                out[name] = False
    return out
