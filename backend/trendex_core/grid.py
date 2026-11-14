"""MODIS sinusoidal 1 km grid helpers.

The cube uses the native MODIS sinusoidal grid (cell 926.625433 m, equal area).
Cells are mapped onto a dense local H x W array for raster operations.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Transformer

SINU_PROJ = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
SINU = CRS.from_proj4(SINU_PROJ)
CELL = 926.625433055833
X_ORIGIN = -20015109.354
Y_ORIGIN = 10007554.677
CELL_KM2 = (CELL / 1000.0) ** 2

_to_sinu = Transformer.from_crs("EPSG:4326", SINU, always_xy=True)
_to_ll = Transformer.from_crs(SINU, "EPSG:4326", always_xy=True)


def lonlat_to_xy(lon, lat):
    return _to_sinu.transform(lon, lat)


def xy_to_lonlat(x, y):
    return _to_ll.transform(x, y)


def global_rowcol(x, y):
    col = np.floor((np.asarray(x) - X_ORIGIN) / CELL).astype(np.int64)
    row = np.floor((Y_ORIGIN - np.asarray(y)) / CELL).astype(np.int64)
    return row, col


def cell_center(row, col):
    x = X_ORIGIN + (np.asarray(col) + 0.5) * CELL
    y = Y_ORIGIN - (np.asarray(row) + 0.5) * CELL
    return x, y


def cell_id(row, col):
    row = np.asarray(row)
    col = np.asarray(col)
    h, v = col // 1200, row // 1200
    return np.char.add(
        np.char.add(np.char.add(np.char.add("h", np.char.zfill(h.astype(str), 2)), np.char.add("v", np.char.zfill(v.astype(str), 2))),
                    np.char.add("_", (row % 1200).astype(str))),
        np.char.add("_", (col % 1200).astype(str)))


@dataclass
class Grid:
    row0: int
    col0: int
    H: int
    W: int

    @classmethod
    def from_xy(cls, x, y) -> "Grid":
        row, col = global_rowcol(x, y)
        r0, c0 = int(row.min()), int(col.min())
        return cls(r0, c0, int(row.max() - r0 + 1), int(col.max() - c0 + 1))

    def local_rc(self, x, y):
        row, col = global_rowcol(x, y)
        return (row - self.row0).astype(np.int32), (col - self.col0).astype(np.int32)

    @property
    def transform(self):
        from rasterio.transform import from_origin
        return from_origin(X_ORIGIN + self.col0 * CELL, Y_ORIGIN - self.row0 * CELL, CELL, CELL)

    def index(self, r, c) -> np.ndarray:
        idx = np.full((self.H, self.W), -1, dtype=np.int32)
        idx[r, c] = np.arange(len(r), dtype=np.int32)
        return idx

    def to_dict(self) -> dict:
        return {"row0": self.row0, "col0": self.col0, "H": self.H, "W": self.W, "cell_m": CELL, "crs": SINU_PROJ}


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(a))
