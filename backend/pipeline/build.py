"""Offline pipeline: cube -> artifacts/ (everything the API serves).

python -m pipeline.build --cube data/cube_mock            # mock
python -m pipeline.build --cube hf://TrendeX90/naryn-cube  # real
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

from trendex_core import config, ext, formula, layers, products
from trendex_core.core import Core, clean
from trendex_core.formula import COMPONENTS
from trendex_core.io import boundaries
from trendex_core.io import cube as cube_io
from trendex_core.stats import trend as T

log = logging.getLogger("trendex.build")

LIMITATIONS = {
    "en": ["Does not name reasons for changes; it only records what changes.",
           "No yields in kg/ha and no allowed head counts as facts (capacity is a scenario with a range).",
           "No multi-year forecasts.",
           "Does not replace field checks and does not assess individual farms.",
           "Does not know livestock load, land rights, pasture boundaries, watering points or forage quality.",
           "Greenness (NDVI) does not separate good grass from shrubs.",
           "1 km cells are coarser than some local products (e.g. 250 m).",
           "Land cover is a fixed 2020 mask."],
    "ru": ["Не называет причин изменений, только фиксирует, что меняется.",
           "Не выдаёт урожайность в кг/га и допустимое поголовье как факт (ёмкость — сценарий с диапазоном).",
           "Не прогнозирует на годы вперёд.",
           "Не заменяет полевую проверку и не оценивает отдельные хозяйства.",
           "Не знает нагрузку скота, права на землю, границы участков, водопои и качество корма.",
           "Зелень (NDVI) не отличает хорошую траву от кустарника.",
           "Ячейки 1 км грубее некоторых местных продуктов (например, 250 м).",
           "Тип покрова — фиксированная маска 2020 года."],
}


def _git_sha() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=config.ROOT, text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except Exception:  # noqa: BLE001
        return None


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(obj), ensure_ascii=False, indent=1))


def build(source: str, out: Path = config.ARTIFACTS, n_jobs: int = -1) -> Core:
    t0 = time.time()
    cfg = config.core()
    cube = cube_io.load(source)
    log.info("cube loaded: %d cells, years %s-%s (%.1fs)", len(cube.cells), cube.years[0], cube.years[-1], time.time() - t0)
    cells = cube.cells.copy()
    in_region = cells["district"].notna().to_numpy()

    status = formula.mask_status(cells, cfg)
    if "mask_reason" in cells:
        cube_pasture = cells["mask_reason"].isna().to_numpy()
        ours_basic = np.isin(status, ["pasture", "cropland", "forest"])  # cube mask has no cropland/forest classes
        dis = int((cube_pasture != ours_basic).sum())
        log.info("mask disagreement with cube mask_reason: %d cells", dis)
    S, valid_frac = formula.season_mean(cube.ndvi, cfg["summer_months"], cfg["min_valid_months_per_summer"])
    n_years = np.isfinite(S).sum(axis=1)
    status[(status == "pasture") & (n_years < cfg["min_valid_years"])] = "insufficient"
    clim = formula.climatology(cube.ndvi)
    comps = formula.raw_components(S, clim, cells["slope_mean"].to_numpy(), cfg["season_months"])
    pasture = status == "pasture"
    ref = pasture & in_region
    pct = {}
    for k in COMPONENTS:
        pk = formula.percentiles(comps[k], ref)
        pk[~pasture] = np.nan
        pct[k] = pk
    score = formula.score_from_pct(pct, cfg["weights"])
    lvl = formula.level_class(score, cfg["level_thresholds"])
    log.info("level done (%.1fs)", time.time() - t0)

    run = pasture | (status == "insufficient")
    tr_all = {k: np.full(len(cells), np.nan) for k in ("slope", "ci_lo", "ci_hi", "p", "q", "n")}
    tcls = np.full(len(cells), None, dtype=object)
    tr = formula.cell_trends(S[run], cube.years, ref[run], cfg, n_jobs=n_jobs)
    for k in tr_all:
        tr_all[k][run] = tr[k]
    tcls[run] = tr["class"]
    log.info("cell trends done (%.1fs)", time.time() - t0)

    cells["status"] = status
    cells["valid_frac"] = valid_frac
    cells["green"] = comps["green"]
    cells["cv"] = comps["_cv"]
    cells["s_mean"] = comps["_mean"]
    cells["season_len"] = comps["season"]
    for k in COMPONENTS:
        cells[f"pct_{k}"] = pct[k]
    cells["score"] = score
    cells["level_class"] = lvl
    cells["trend_slope"] = tr_all["slope"]
    cells["trend_ci_lo"] = tr_all["ci_lo"]
    cells["trend_ci_hi"] = tr_all["ci_hi"]
    cells["trend_p"] = tr_all["p"]
    cells["trend_q"] = tr_all["q"]
    cells["trend_n"] = tr_all["n"]
    cells["trend_class"] = tcls
    cells["trend_pct_decade"] = T.pct_per_decade(tr_all["slope"], comps["_mean"])
    sp = formula.season_pct_cells(S)
    cells["season_pct"] = sp
    cells["season_class"] = np.array([formula.season_class(v, cfg["season_terciles"]) for v in sp], dtype=object)

    manifest = cube.manifest or {}
    meta = {"data_mode": manifest.get("data_mode", "real"), "source": source,
            "data_version": str(manifest.get("version") or manifest.get("created") or manifest.get("built_at") or manifest.get("build_time") or ("hf:" + source if source.startswith("hf") else source)),
            "computed_at": products.now(), "config_hash": cfg["_hash"], "git_sha": _git_sha(),
            "manifest": manifest, "n_cells": int(len(cells))}
    core = Core(cells=cells, S=S, years=cube.years, grid=cube.grid, meta=meta)

    sens, flip = formula.sensitivity(pct, cfg, ref, lvl, cells["district"].to_numpy())
    cells["flip_share"] = flip
    core._cache.clear()
    meta["sensitivity"] = sens

    B = products.block_summaries(core)
    core.blocks = B
    zones = products.inspection_queue(core)
    qblocks = {b for z in zones for b in z["blocks"]}
    B["in_queue"] = B["block_id"].isin(qblocks)
    trends = products.trends(core, monthly=cube.ndvi)
    ov = products.overview(core, B, zones, trends)
    log.info("products done (%.1fs)", time.time() - t0)

    # P1 plugins (precip, placebo, seasons, ...)
    core.extra["_art"] = out
    ext.run("build_step", core, cube)
    kp = products.known_places(core)

    out.mkdir(parents=True, exist_ok=True)
    extra_specs = [s for _, specs in ext.run("layers", core) for s in (specs or [])]
    layers.build_all(core, out / "layers", extra_specs)
    log.info("layers done (%.1fs)", time.time() - t0)

    # districts geojson with summary props
    dprops = {r["id"]: {"pasture_km2": r["pasture_km2"], "score": r["score"], "level_class": r["level_class"],
                        "trend_class": r["trend"]["class"], "pct_per_decade": r["trend"]["pct_per_decade"],
                        "name_en": core.cfg["district_names"][r["id"]]["en"], "name_ru": core.cfg["district_names"][r["id"]]["ru"],
                        "country": core.cfg["district_names"][r["id"]].get("country")}
              for r in ov["districts"]}
    _write(out / "zones" / "districts.geojson", boundaries.districts_geojson(dprops))
    _write(out / "zones" / "blocks.geojson", products.blocks_geojson(core, B))
    _write(out / "overview.json", ov)
    _write(out / "trends.json", trends)
    _write(out / "queue.json", zones)
    (out / "queue_en.csv").write_bytes(products.queue_csv(zones, core, "en"))
    (out / "queue_ru.csv").write_bytes(products.queue_csv(zones, core, "ru"))
    methods = {"config": {k: v for k, v in cfg.items() if not k.startswith("_")}, "config_hash": cfg["_hash"],
               "git_sha": meta["git_sha"], "data_mode": meta["data_mode"], "datasets": manifest.get("datasets", []),
               "manifest": manifest, "sensitivity": sens, "known_places": kp, "limitations": LIMITATIONS,
               "placebo": core.extra.get("placebo"), "ml": core.extra.get("ml_metrics"),
               "aqua_check": core.extra.get("aqua_check")}
    _write(out / "methods.json", methods)
    summary = {"data_mode": meta["data_mode"], "computed_at": meta["computed_at"], "config_hash": cfg["_hash"],
               "headline": ov["headline"],
               "sentence": {lang: products.headline_sentence(ov, core, lang) for lang in ("en", "ru")},
               "oblast_trend": {k: trends["oblast"][k] for k in ("slope_per_decade", "ci95", "pct_per_decade", "p_value", "class")},
               "queue_zones": len(zones), "sensitivity_mean_changed_share": sens["mean_changed_share"],
               "known_places": {r: sum(1 for k in kp if k["result"] == r) for r in ("match", "mismatch", "not_evaluable")}}
    _write(out / "summary.json", summary)
    # copy cube manifest
    _write(out / "cube_manifest.json", manifest)
    core.save(out)
    bf = core.extra.get("bin_fields", {})  # ext arrays destined for cells.bin (Edge Function)
    if bf:
        np.savez(out / "bin_fields.npz", **{k: np.asarray(v) for k, v in bf.items()})
        (out / "bin_meta.json").write_text(json.dumps(clean(core.extra.get("bin_meta", {}))))
    log.info("artifacts written to %s (%.1fs total)", out, time.time() - t0)
    return core


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cube", default=str(config.DATA / "cube_mock"))
    ap.add_argument("--out", default=str(config.ARTIFACTS))
    ap.add_argument("--jobs", type=int, default=-1)
    ap.add_argument("--clean", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    out = Path(a.out)
    if a.clean and out.exists():
        shutil.rmtree(out)
    build(a.cube, out, a.jobs)


if __name__ == "__main__":
    main()
