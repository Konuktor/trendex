"""Config loading. The core config hash goes into every API response."""
from __future__ import annotations

import hashlib
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


@lru_cache
def core() -> dict:
    cfg = _load("core_v1.yaml")
    raw = (CONFIGS / "core_v1.yaml").read_bytes()
    cfg["_hash"] = hashlib.sha256(raw).hexdigest()[:12]
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
