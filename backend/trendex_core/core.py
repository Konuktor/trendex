"""In-memory state shared by the pipeline and the API (loaded from artifacts/)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .formula import COMPONENTS
from .grid import Grid


@dataclass
class Core:
    cells: pd.DataFrame
    S: np.ndarray                 # (N, Y) summer means
    years: np.ndarray
    grid: Grid
    meta: dict                    # data_mode, data_version, computed_at, config_hash, manifest, sensitivity...
    blocks: pd.DataFrame | None = None
    extra: dict = field(default_factory=dict)   # ext modules put arrays/tables here (e.g. precip series)
    _cache: dict = field(default_factory=dict)

    # ---- convenience ----
    @property
    def cfg(self) -> dict:
        return config.core()

    @property
    def N(self) -> int:
        return len(self.cells)

    def col(self, name: str) -> np.ndarray:
        key = ("col", name)
        if key not in self._cache:
            self._cache[key] = self.cells[name].to_numpy()
        return self._cache[key]

    @property
    def pasture(self) -> np.ndarray:
        return self.col("status") == "pasture"

    @property
    def in_region(self) -> np.ndarray:
        d = self.col("district")
        return np.array([v is not None and v == v for v in d]) if d.dtype == object else ~pd.isna(d)

    @property
    def index(self) -> np.ndarray:
        if "index" not in self._cache:
            self._cache["index"] = self.grid.index(self.col("r"), self.col("c"))
        return self._cache["index"]

    def pct(self) -> dict:
        return {k: self.col(f"pct_{k}") for k in COMPONENTS}

    # ---- persistence ----
    def save(self, out: Path) -> None:
        out.mkdir(parents=True, exist_ok=True)
        self.cells.to_parquet(out / "cells.parquet", index=False)
        np.save(out / "S.npy", self.S.astype(np.float32))
        if self.blocks is not None:
            self.blocks.to_parquet(out / "blocks.parquet", index=False)
        meta = dict(self.meta)
        meta["years"] = [int(self.years[0]), int(self.years[-1])]
        meta["grid"] = self.grid.to_dict()
        (out / "core.json").write_text(json.dumps(meta, indent=2, default=_json_default))

    @classmethod
    def load(cls, art: Path = config.ARTIFACTS) -> "Core":
        meta = json.loads((art / "core.json").read_text())
        g = meta["grid"]
        cells = pd.read_parquet(art / "cells.parquet")
        if "district" in cells:
            cells["district"] = cells["district"].astype(object).where(cells["district"].notna(), None)
        blocks = pd.read_parquet(art / "blocks.parquet") if (art / "blocks.parquet").exists() else None
        years = np.arange(meta["years"][0], meta["years"][1] + 1)
        return cls(cells=cells, S=np.load(art / "S.npy"), years=years,
                   grid=Grid(g["row0"], g["col0"], g["H"], g["W"]), meta=meta, blocks=blocks)


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, Path):
        return str(o)
    raise TypeError(type(o))


def clean(o):
    """Recursively turn numpy types / NaN into JSON-safe python values."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return [clean(v) for v in o.tolist()]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o
