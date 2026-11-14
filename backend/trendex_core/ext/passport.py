"""F18 passports: a one-page PDF and a CSV per district and per in-region block with pasture, in en and ru.

export(core, out_dir) writes out_dir/passport/{district|block}/{id}_{lang}.pdf|.csv (served by the Edge route
/api/passport.pdf|csv?sel=...). PDF: the 8 card blocks, a chart of dynamics.series with the Sen line
(intercept + slope·year), caveats, and a MOCK banner when data_mode == "mock". Cyrillic via the bundled DejaVuSans.

Set TRENDEX_PASSPORTS=0 to skip, TRENDEX_PASSPORTS=districts for districts only.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import time
from pathlib import Path

import numpy as np

from .. import config

log = logging.getLogger("trendex.ext.passport")

FONTS = config.ROOT / "assets" / "fonts"
LANGS = ("en", "ru")
T = {
    "en": {"title": "TrendeX pasture passport", "blocks": ["1. Level (relative suitability)", "2. Dynamics", "3. Why: for and against",
                                                         "4. Confidence", "5. This season", "6. Alternatives nearby", "7. What to do",
                                                         "8. What we don't consider"],
           "area": "Area: {total:.0f} km² in the selection, {pasture:.0f} km² of pasture analysed, {excl:.0f} km² excluded.",
           "score": "{label}: {score:.0f} / 100", "comp": "{label}: percentile {p}",
           "trend": "{label}: {slope:+.4f} NDVI per decade ({pct:+.1f}%/decade), 95% CI [{lo:+.4f}; {hi:+.4f}], p = {p:.3f}. {method}.",
           "trend_na": "{label}.", "chart": "Dots: mean May–Sep NDVI per year. Line: Sen slope fit (intercept + slope × year).",
           "pro": "For", "con": "Against", "none": "—", "alt": "{name}: {d:.0f} km, score {s:.0f}, {lvl}, {dyn}",
           "access": "Access (straight-line, © OpenStreetMap contributors): road {r} km, water {w} km, settlement {s} km.",
           "caveats": ["\"Suitable\" is relative to Naryn region's pastures, not an absolute grade.",
                       "Shows what changes in greenness, not why; it does not replace a field check.",
                       "The action is a direction to discuss with specialists."],
           "footer": "Data: {data}. Config {cfg}, data version {ver}, computed {at}. Generated {gen}.", "status": "Status: {s}",
           "data": "NASA MODIS NDVI 2000–2025, 1 km"},
    "ru": {"title": "Паспорт пастбища TrendeX", "blocks": ["1. Уровень (относительная пригодность)", "2. Динамика", "3. Почему: доводы за и против",
                                                         "4. Уверенность", "5. Этот сезон", "6. Альтернативы рядом", "7. Что делать",
                                                         "8. Что мы не учитываем"],
           "area": "Площадь: {total:.0f} км² в выборке, {pasture:.0f} км² пастбищ проанализировано, {excl:.0f} км² исключено.",
           "score": "{label}: {score:.0f} из 100", "comp": "{label}: процентиль {p}",
           "trend": "{label}: {slope:+.4f} NDVI за десятилетие ({pct:+.1f}% за десятилетие), 95% ДИ [{lo:+.4f}; {hi:+.4f}], p = {p:.3f}. {method}.",
           "trend_na": "{label}.", "chart": "Точки: средний NDVI за май–сентябрь по годам. Линия: оценка Сена (свободный член + наклон × год).",
           "pro": "За", "con": "Против", "none": "—", "alt": "{name}: {d:.0f} км, балл {s:.0f}, {lvl}, {dyn}",
           "access": "Доступ (по прямой, © участники OpenStreetMap): дорога {r} км, вода {w} км, населённый пункт {s} км.",
           "caveats": ["«Пригодно» — относительно пастбищ Нарынской области, не абсолютная оценка.",
                       "Показывает, что меняется в зелени, но не почему; не заменяет полевую проверку.",
                       "Действие — направление для обсуждения со специалистами."],
           "footer": "Данные: {data}. Конфигурация {cfg}, версия данных {ver}, расчёт {at}. Создано {gen}.", "status": "Статус: {s}",
           "data": "NASA MODIS NDVI 2000–2025, 1 км"},
}


# ---------------------------------------------------------------- chart
class _Chart:
    """One reusable Agg figure (no pyplot) -> PNG bytes. Language-neutral (caption is in the PDF text)."""

    def __init__(self):
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure
        self.fig = Figure(figsize=(6.6, 2.3), dpi=130)
        FigureCanvasAgg(self.fig)
        self.ax = self.fig.add_axes((0.08, 0.14, 0.9, 0.8))

    def png(self, dyn: dict) -> bytes | None:
        ser = (dyn or {}).get("series") or []
        ys = np.array([s["year"] for s in ser], dtype=float)
        vs = np.array([np.nan if s["value"] is None else s["value"] for s in ser], dtype=float)
        if not np.isfinite(vs).any():
            return None
        ax = self.ax
        ax.clear()
        ax.plot(ys, vs, "-", color="#9aa5b1", lw=0.8, zorder=1)
        ax.plot(ys, vs, "o", color="#2f6f4e", ms=3.2, zorder=2)
        fit = dyn.get("fit") or {}
        if fit.get("slope") is not None and fit.get("intercept") is not None:
            ax.plot(ys, fit["intercept"] + fit["slope"] * ys, "-", color="#c0392b", lw=1.6, zorder=3)
        ax.set_ylabel("NDVI", fontsize=8)
        ax.tick_params(labelsize=7)
        ax.grid(alpha=0.25, lw=0.5)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        buf = io.BytesIO()
        self.fig.savefig(buf, format="png")
        return buf.getvalue()


# ---------------------------------------------------------------- pdf
def _fmt_num(v, nd=1):
    return "—" if v is None else f"{v:.{nd}f}"


def pdf_bytes(card: dict, lang: str, chart_png: bytes | None, mock_banner: str | None, data_label: str | None = None) -> bytes:
    from fpdf import FPDF
    from fpdf.enums import XPos, YPos
    t = T[lang]
    pdf = FPDF(format="A4", unit="mm")
    pdf.set_margins(14, 12, 14)
    pdf.set_auto_page_break(True, margin=12)
    pdf.add_font("DejaVu", "", str(FONTS / "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", str(FONTS / "DejaVuSans-Bold.ttf"))
    pdf.add_page()
    W = pdf.epw
    NL = {"new_x": XPos.LMARGIN, "new_y": YPos.NEXT}

    def head(txt, size=9.5):
        pdf.ln(1.2)
        pdf.set_font("DejaVu", "B", size)
        pdf.set_text_color(31, 58, 46)
        pdf.cell(W, 5, txt, **NL)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("DejaVu", "", 8.3)

    def para(txt, h=3.9, indent=0.0):
        if not txt:
            return
        if indent:
            pdf.set_x(pdf.l_margin + indent)
        pdf.multi_cell(W - indent, h, txt, align="L", **NL)

    if mock_banner:
        pdf.set_fill_color(192, 57, 43)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("DejaVu", "B", 9)
        pdf.multi_cell(W, 6, mock_banner, fill=True, align="C", **NL)
        pdf.set_text_color(0, 0, 0)
        pdf.ln(1.5)

    sel = card.get("selection") or {}
    meta = card.get("meta") or {}
    pdf.set_font("DejaVu", "B", 14)
    pdf.cell(W, 7, t["title"], **NL)
    pdf.set_font("DejaVu", "B", 11)
    pdf.cell(W, 6, sel.get("name") or sel.get("sel") or "", **NL)
    pdf.set_font("DejaVu", "", 8.3)
    c = sel.get("centroid") or {}
    para(f"{sel.get('sel')}  ·  {c.get('lat', 0):.3f}, {c.get('lon', 0):.3f}  ·  data_mode: {meta.get('data_mode')}")
    a = card.get("area") or {}
    if a:
        para(t["area"].format(total=a.get("total_km2") or 0, pasture=a.get("pasture_km2") or 0,
                              excl=sum((a.get("excluded_km2") or {}).values())))
    if card.get("status") != "ok":
        para(t["status"].format(s=card.get("status")))

    lv = card.get("level")
    head(t["blocks"][0])
    if lv:
        pdf.set_font("DejaVu", "B", 9)
        para(t["score"].format(label=lv["label"], score=lv["score"]))
        pdf.set_font("DejaVu", "", 8.3)
        para("; ".join(t["comp"].format(label=x["label"], p=_fmt_num(x.get("percentile"), 0)) for x in lv.get("components", [])))
        para(lv.get("relative_note"))
    else:
        para(t["none"])

    dy = card.get("dynamics")
    head(t["blocks"][1] + (f" {dy['period'][0]}–{dy['period'][1]}" if dy and dy.get("period") else ""))
    if dy:
        if dy.get("slope_per_decade") is not None and dy.get("ci95"):
            para(t["trend"].format(label=dy["label"], slope=dy["slope_per_decade"], pct=dy.get("pct_per_decade") or 0,
                                   lo=dy["ci95"][0], hi=dy["ci95"][1], p=dy.get("p_value") or 1, method=dy.get("method", "")))
        else:
            para(t["trend_na"].format(label=dy.get("label", "")))
        if chart_png:
            pdf.image(io.BytesIO(chart_png), x=pdf.l_margin, w=W * 0.86)
            pdf.set_font("DejaVu", "", 7)
            para(t["chart"], h=3.2)
            pdf.set_font("DejaVu", "", 8.3)
    else:
        para(t["none"])

    rs = card.get("reasons") or {}
    head(t["blocks"][2])
    for k in ("pro", "con"):
        items = rs.get(k) or []
        para(f"{t[k]}: " + ("; ".join(x["text"] for x in items) if items else t["none"]))

    cf = card.get("confidence")
    head(t["blocks"][3])
    para(f"{cf['label']}: " + "; ".join(f["text"] for f in cf.get("factors", [])) if cf else t["none"])

    se = card.get("season")
    head(t["blocks"][4])
    para(se.get("text") if se else t["none"])

    al = card.get("alternatives")
    head(t["blocks"][5])
    if al and al.get("items"):
        for it in al["items"]:
            para("• " + t["alt"].format(name=it["name"], d=it["distance_km"], s=it["score"], lvl=it["level_label"],
                                        dyn=it["dynamics_label"]), indent=1)
    para((al or {}).get("note") if al else t["none"])

    ac = card.get("action")
    head(t["blocks"][6])
    if ac:
        pdf.set_font("DejaVu", "B", 8.6)
        para(ac.get("text"))
        pdf.set_font("DejaVu", "", 8.3)
        para(ac.get("note"))
    else:
        para(t["none"])

    head(t["blocks"][7])
    pdf.set_font("DejaVu", "", 7.6)
    para("; ".join(card.get("not_considered") or []) or t["none"], h=3.5)
    pdf.set_font("DejaVu", "", 8.3)

    acc = (card.get("extras") or {}).get("access")
    if acc:
        pdf.ln(1)
        para(t["access"].format(r=_fmt_num(acc.get("road_km")), w=_fmt_num(acc.get("water_km")), s=_fmt_num(acc.get("settlement_km"))))

    pdf.ln(1.5)
    pdf.set_draw_color(180, 180, 180)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + W, pdf.get_y())
    pdf.ln(1)
    pdf.set_font("DejaVu", "", 7)
    pdf.set_text_color(80, 80, 80)
    for cv in t["caveats"]:
        para("• " + cv, h=3.2)
    para(t["footer"].format(data=data_label or t["data"], cfg=meta.get("config_hash"), ver=meta.get("data_version"),
                            at=meta.get("computed_at"), gen=meta.get("generated_at")), h=3.2)
    return bytes(pdf.output())


# ---------------------------------------------------------------- csv
def csv_bytes(card: dict, lang: str) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "key", "value"])
    sel, meta, a = card.get("selection") or {}, card.get("meta") or {}, card.get("area") or {}
    for k in ("sel", "name", "type"):
        w.writerow(["selection", k, sel.get(k)])
    w.writerow(["selection", "districts", ";".join(sel.get("districts") or [])])
    for k in ("data_mode", "data_version", "config_hash", "computed_at", "lang"):
        w.writerow(["meta", k, meta.get(k)])
    w.writerow(["status", "status", card.get("status")])
    for k in ("total_km2", "pasture_km2", "insufficient_km2", "n_cells"):
        w.writerow(["area", k, a.get(k)])
    for k, v in (a.get("excluded_km2") or {}).items():
        w.writerow(["area", f"excluded_{k}_km2", v])
    lv = card.get("level") or {}
    for k in ("class", "label", "score", "relative_note"):
        w.writerow(["1_level", k, lv.get(k)])
    for x in lv.get("components", []):
        w.writerow(["1_level", f"percentile_{x['key']}", x.get("percentile")])
    dy = card.get("dynamics") or {}
    for k in ("class", "label", "slope_per_decade", "pct_per_decade", "p_value", "method", "n_years"):
        w.writerow(["2_dynamics", k, dy.get(k)])
    if dy.get("ci95"):
        w.writerow(["2_dynamics", "ci95_lo", dy["ci95"][0]])
        w.writerow(["2_dynamics", "ci95_hi", dy["ci95"][1]])
    for k in ("pro", "con"):
        for x in (card.get("reasons") or {}).get(k, []):
            w.writerow(["3_reasons", k, x["text"]])
    cf = card.get("confidence") or {}
    w.writerow(["4_confidence", "level", cf.get("level")])
    for f in cf.get("factors", []):
        w.writerow(["4_confidence", f["key"], f["text"]])
    se = card.get("season") or {}
    for k in ("year", "class", "percentile", "text"):
        w.writerow(["5_season", k, se.get(k)])
    al = card.get("alternatives") or {}
    for it in al.get("items", []):
        w.writerow(["6_alternatives", it["sel"], f"{it['name']} | {it['distance_km']} km | score {it['score']} | "
                                                 f"{it['level_label']} | {it['dynamics_label']}"])
    if al.get("note"):
        w.writerow(["6_alternatives", "note", al["note"]])
    ac = card.get("action") or {}
    for k in ("key", "text", "note"):
        w.writerow(["7_action", k, ac.get(k)])
    for x in card.get("not_considered") or []:
        w.writerow(["8_not_considered", "", x])
    for k, v in ((card.get("extras") or {}).get("access") or {}).items():
        w.writerow(["extras_access", k, v])
    fit = dy.get("fit") or {}
    w.writerow([])
    w.writerow(["year", "ndvi_may_sep_mean", "sen_fit"])
    for s in dy.get("series", []):
        f = fit["intercept"] + fit["slope"] * s["year"] if fit.get("slope") is not None else None
        w.writerow([s["year"], "" if s["value"] is None else round(s["value"], 5), "" if f is None else round(f, 5)])
    return ("﻿" + buf.getvalue()).encode("utf-8")


# ---------------------------------------------------------------- export hook
def targets(core, mode: str = "all") -> list[str]:
    out = [f"district:{d}" for d in core.cfg["district_names"]]
    if mode != "districts" and core.blocks is not None:
        B = core.blocks
        ok = B["in_region"].astype(bool) & (B["pasture_km2"] > 0)
        out += [f"block:{int(b)}" for b in B.loc[ok, "block_id"]]
    return out


def available(core) -> bool:
    return (FONTS / "DejaVuSans.ttf").exists()


def _write(core, chart: _Chart, s: str, root: Path) -> int:
    from ..card import build_card
    from ..selection import parse
    kind, val = s.split(":", 1)
    (root / kind).mkdir(parents=True, exist_ok=True)
    mock = core.meta.get("data_mode") == "mock"
    datasets = [d.get("name") or d.get("short_name") for d in (core.meta.get("manifest") or {}).get("datasets", [])
                if isinstance(d, dict) and (d.get("name") or d.get("short_name"))]
    png = None
    for lang in LANGS:
        card = build_card(core, parse(core, s, lang), lang)
        if png is None:
            png = chart.png(card.get("dynamics"))
        banner = config.texts(lang)["mock_banner"] if mock else None
        (root / kind / f"{val}_{lang}.pdf").write_bytes(pdf_bytes(card, lang, png, banner, ", ".join(datasets) or None))
        (root / kind / f"{val}_{lang}.csv").write_bytes(csv_bytes(card, lang))
    return 1


_W = None


def _init_worker(art: str) -> None:
    global _W
    from .. import ext
    from ..core import Core
    core = Core.load(Path(art))
    core.extra["_art"] = Path(art)
    ext.run("load", core, Path(art))
    _W = (core, _Chart())


def _job(args) -> int:
    s, root = args
    return _write(_W[0], _W[1], s, Path(root))


def export(core, out_dir) -> None:
    mode = os.environ.get("TRENDEX_PASSPORTS", "all").lower()
    if mode in ("0", "no", "off", "false"):
        return
    t0 = time.time()
    root = Path(out_dir) / "passport"
    sels = targets(core, mode)
    art = core.extra.get("_art")
    workers = min(8, max(1, (os.cpu_count() or 2) - 1), max(1, len(sels) // 20))
    n = 0
    if workers > 1 and art and (Path(art) / "core.json").exists():
        try:  # fresh interpreters (spawn): safe even when the caller has threads running (TestClient)
            import multiprocessing as mp
            from concurrent.futures import ProcessPoolExecutor
            with ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn"), initializer=_init_worker,
                                     initargs=(str(art),)) as ex:
                n = sum(ex.map(_job, [(s, str(root)) for s in sels], chunksize=8))
        except Exception:  # noqa: BLE001
            log.exception("passport worker pool failed; falling back to one process")
            n = 0
    if n < len(sels):
        workers = 1
        chart = _Chart()
        n = sum(_write(core, chart, s, root) for s in sels)
    log.info("passports: %d selections x %d langs (pdf + csv) in %.1fs with %d workers", n, len(LANGS), time.time() - t0, workers)
