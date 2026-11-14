"""Config loading. The core config hash goes into every API response."""
from __future__ import annotations

import hashlib
import os
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIGS = ROOT / "configs"
DATA = ROOT / "data"
ARTIFACTS = ROOT / "artifacts"


def _load(name: str) -> dict:
    with open(CONFIGS / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


PROFILE = os.environ.get("TRENDEX_CONFIG", "core_v1.yaml")


@lru_cache
def core() -> dict:
    """The frozen formula config. TRENDEX_CONFIG picks the profile: core_v1.yaml (Naryn) or core_ca.yaml (Central Asia)."""
    cfg = _load(PROFILE)
    raw = (CONFIGS / PROFILE).read_bytes()
    cfg["_hash"] = hashlib.sha256(raw).hexdigest()[:12]
    cfg["_profile"] = PROFILE
    if cfg.get("zones") == "ca_adm1":
        from .io.regions import district_names
        cfg["district_names"] = district_names()
    return cfg


@lru_cache
def texts(lang: str) -> dict:
    lang = lang if lang in ("en", "ru") else "en"
    return _load(f"texts_{lang}.yaml")


@lru_cache
def matrix() -> dict:
    return _load("matrix.yaml")


@lru_cache
def palette() -> dict:
    return _load("palette.yaml")


def optional(name: str) -> dict | None:
    p = CONFIGS / name
    if not p.exists():
        return None
    return _load(name)
