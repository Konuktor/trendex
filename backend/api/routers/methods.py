"""/methods (F10, F19): frozen config, datasets, checks with mismatches, limitations."""
import copy

from fastapi import APIRouter, Depends

from trendex_core import config

from .. import deps

router = APIRouter(tags=["methods"])

STEPS = {
    "en": ["Data: monthly NASA MODIS NDVI (MOD13A3 v061, 1 km) 2000–2025, NASADEM elevation and slope, MCD12Q1 land cover (2020); native MODIS sinusoidal 1 km grid.",
           "Mask: water, snow/ice, built-up, cropland, forest and slopes steeper than the threshold are excluded; cells with too few valid summers are 'not enough data'.",
           "Level: four components per cell (summer greenness, year-to-year stability, green-season length, gentle terrain), each ranked among Naryn's pastures; weighted into a 0–100 score.",
           "Dynamics: one summer value per year (May–Sep mean, so no seasonal cycle), Sen slope with a 95% CI, Mann–Kendall test with the Hamed–Rao autocorrelation correction, Benjamini–Hochberg FDR across cells.",
           "Answer: level x dynamics -> 'what to do' (a direction for specialists), inspection queue, alternatives.",
           "Confidence drops for small areas, much excluded land, missing months, or classes that change under other weights.",
           "The core is an open formula, not machine learning; settings are frozen in a commit before the first real-data run."],
    "ru": ["Данные: месячный NDVI NASA MODIS (MOD13A3 v061, 1 км) 2000–2025, высота и уклон NASADEM, тип покрова MCD12Q1 (2020); родная синусоидальная сетка MODIS 1 км.",
           "Маска: вода, снег/лёд, застройка, пашня, лес и слишком крутые склоны исключаются; ячейки со слишком малым числом надёжных лет — «недостаточно данных».",
           "Уровень: четыре компоненты на ячейку (летняя зелень, стабильность по годам, длина зелёного сезона, пологий рельеф), каждая ранжируется среди пастбищ области; взвешенный балл 0–100.",
           "Динамика: одно летнее значение в год (среднее май–сентябрь, без сезонного цикла), наклон Сена с 95% ДИ, тест Манна–Кендалла с поправкой Хамеда–Рао на автокорреляцию, поправка Бенджамини–Хохберга по ячейкам.",
           "Ответ: уровень x динамика -> «что делать» (направление для специалистов), очередь проверок, альтернативы.",
           "Уверенность снижается для маленьких участков, большой доли исключённой площади, пропусков или класса, меняющегося при других весах.",
           "Основа — открытая формула, а не машинное обучение; настройки фиксируются в коммите до первого расчёта на реальных данных."],
}


@router.get("/methods")
def methods(lang: str = Depends(deps.lang_q)):
    c = deps.core()
    M = copy.deepcopy(deps.art_json("methods.json"))
    M["steps"] = STEPS[lang]
    M["limitations"] = M["limitations"][lang]
    M["matrix"] = {lv: {dy: config.texts(lang)["actions"][k] for dy, k in row.items()} for lv, row in config.matrix().items()}
    M["matrix_reviewed_by_specialist"] = False
    M["data_mode"] = c.meta.get("data_mode")
    for k in ("placebo", "ml", "aqua_check"):
        M[k] = c.extra.get({"ml": "ml_metrics"}.get(k, k), M.get(k))
    return M
