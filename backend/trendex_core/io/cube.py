"""Read the shared cube (ML session's TrendeX90/naryn-cube or the local mock) into dense arrays."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from .. import config
from ..grid import CELL_KM2, Grid
from . import boundaries

CELL_REQUIRED = ["cell_id", "x", "y", "lon", "lat", "elev_mean", "slope_mean", "lc_major"]
CELL_ALIASES = {"elev": "elev_mean", "elevation": "elev_mean", "slope": "slope_mean", "lc": "lc_major",
                "lc_type1": "lc_major", "landcover": "lc_major"}
MONTHLY_DEFAULT_COLS = ["cell_id", "year", "month", "ndvi", "ndvi_ok", "precip", "snow"]
MONTHLY_REQUIRED = ["cell_id", "year", "month", "ndvi"]
MONTHLY_OPTIONAL = ["ndvi_ok", "precip", "snow", "ndvi_aqua", "lst_day"]


@dataclass
class Cube:
    cells: pd.DataFrame
    years: np.ndarray
    grid: Grid
    ndvi: np.ndarray                     # (N, Y, 12) float32, NaN where missing / not ok
    extra: dict = field(default_factory=dict)  # precip / snow / ndvi_aqua / lst_day: (N, Y, 12)
    manifest: dict = field(default_factory=dict)
    source: str = ""


def resolve(source: str) -> Path:
    """Local folder, or hf://<repo_id>[@revision][/subdir] for a HF dataset repo."""
    if source.startswith("hf://"):
        from huggingface_hub import snapshot_download
        spec = source[5:]
        parts = spec.split("/")
        repo = "/".join(parts[:2])
        sub = "/".join(parts[2:])
        rev = None
        if "@" in repo:
            repo, rev = repo.split("@", 1)
        patterns = [f"{sub}/*" if sub else "*"] if sub else ["cells.parquet", "monthly*", "manifest.json", "monthly/*"]
        local = snapshot_download(repo, repo_type="dataset", revision=rev, allow_patterns=patterns)
        return Path(local) / sub if sub else Path(local)
    return Path(source)


def _monthly_dataset(path: Path):
    import pyarrow.dataset as ds
    if (path / "monthly").is_dir():
        return ds.dataset(path / "monthly", format="parquet", partitioning="hive")
    if (path / "monthly.parquet").exists():
        return ds.dataset(path / "monthly.parquet", format="parquet")
    raise FileNotFoundError(f"no monthly data in {path}")


def _row_index(cell_col, cell_ids: pd.Index) -> np.ndarray:
    col = cell_col.combine_chunks() if isinstance(cell_col, pa.ChunkedArray) else cell_col
    if pa.types.is_dictionary(col.type):
        dict_idx = cell_ids.get_indexer(pd.Index(col.dictionary.to_pylist()))
        return dict_idx[col.indices.to_numpy(zero_copy_only=False)]
    vals = col.to_numpy(zero_copy_only=False)
    if cell_ids.dtype.kind in "iu" and vals.dtype.kind in "iu":
        return cell_ids.get_indexer(vals)
    return cell_ids.get_indexer(vals.astype(str))


def load(source: str, months=range(4, 11)) -> Cube:
    cfg = config.core()
    path = resolve(source)
    cells = pd.read_parquet(path / "cells.parquet")
    cells = cells.rename(columns={k: v for k, v in CELL_ALIASES.items() if k in cells and v not in cells})
    missing = [c for c in CELL_REQUIRED if c not in cells]
    if missing:
        raise ValueError(f"cells.parquet missing columns {missing}; have {list(cells.columns)}")
    cells = cells.reset_index(drop=True)
    id_index = pd.Index(cells["cell_id"].to_numpy())
    if id_index.dtype.kind not in "iu":
        id_index = pd.Index(cells["cell_id"].astype(str).to_numpy())
    cells["cell_id"] = cells["cell_id"].astype(str)
    if "lc_major" in cells:
        cells["lc_major"] = cells["lc_major"].astype("float32")
    manifest = json.loads((path / "manifest.json").read_text()) if (path / "manifest.json").exists() else {}

    # our own district assignment from ADM2 polygons (cube's district column is optional)
    cells["district"] = boundaries.assign_zone(cells["x"].to_numpy(), cells["y"].to_numpy(),
                                               cells["lon"].to_numpy(), cells["lat"].to_numpy())
    grid = Grid.from_xy(cells["x"].to_numpy(), cells["y"].to_numpy())
    r, c = grid.local_rc(cells["x"].to_numpy(), cells["y"].to_numpy())
    cells["r"], cells["c"] = r, c
    if "block_row" in cells and "block_col" in cells:
        cells["block_label"] = cells.get("block_id", None)
        cells["block_id"] = cells["block_row"].astype(np.int64) * 1000 + cells["block_col"].astype(np.int64)
    elif "block_id" not in cells:
        cells["block_id"] = (r // 11).astype(np.int64) * 100000 + (c // 11)
    elif cells["block_id"].dtype.kind not in "iu":
        parts = cells["block_id"].astype(str).str.split("-", expand=True).astype(int)
        cells["block_label"] = cells["block_id"].astype(str)
        cells["block_id"] = parts[0].astype(np.int64) * 1000 + parts[1].astype(np.int64)
    cells["area_km2"] = CELL_KM2
    for col, default in (("grass_frac", np.nan), ("steep_share", np.nan)):
        if col not in cells:
            cells[col] = default

    years = np.arange(cfg["years"][0], cfg["years"][1] + 1)
    N, Y = len(cells), len(years)
    dset = _monthly_dataset(path)
    have = set(dset.schema.names)
    cols = [c for c in MONTHLY_DEFAULT_COLS if c in have]
    import pyarrow.dataset as pds
    ndvi = np.full((N, Y, 12), np.nan, dtype=np.float32)
    extra = {n: np.full((N, Y, 12), np.nan, dtype=np.float32) for n in ("precip", "snow") if n in have}
    for yi, yr in enumerate(years):  # one year at a time keeps memory low
        tab = dset.to_table(columns=cols, filter=(pds.field("year") == int(yr)) & pds.field("month").isin(list(months)))
        if tab.num_rows == 0:
            continue
        rows = _row_index(tab.column("cell_id"), id_index)
        mi = tab.column("month").to_numpy().astype(int) - 1
        keep = rows >= 0
        v = tab.column("ndvi").to_numpy(zero_copy_only=False).astype(np.float32)
        k = keep & np.isfinite(v)
        if "ndvi_ok" in tab.column_names:
            k &= tab.column("ndvi_ok").to_numpy(zero_copy_only=False).astype(bool)
        ndvi[rows[k], yi, mi[k]] = v[k]
        for n, arr in extra.items():
            v = tab.column(n).to_numpy(zero_copy_only=False).astype(np.float32)
            k = keep & np.isfinite(v)
            arr[rows[k], yi, mi[k]] = v[k]
        del tab
    return Cube(cells=cells, years=years, grid=grid, ndvi=ndvi, extra=extra, manifest=manifest, source=source)
