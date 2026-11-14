"""Python reference cards for the TS parity test (supabase/functions/trendex-api/test_parity.ts)."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trendex_core import card as C, selection as SEL  # noqa: E402
from trendex_core.core import Core  # noqa: E402

core = Core.load()
rng = np.random.default_rng(0)
cases = []
reg = np.flatnonzero(core.in_region)
for i in rng.choice(reg, 25, replace=False):
    lat, lon = float(core.col("lat")[i]), float(core.col("lon")[i])
    r = float(rng.choice([1, 3, 5, 10, 20]))
    cases.append({"kind": "sel", "sel": f"point:{lat:.5f},{lon:.5f},{r:g}", "lang": str(rng.choice(["en", "ru"]))})
cases.append({"kind": "sel", "sel": "district:jumgal", "lang": "en"})
cases.append({"kind": "sel", "sel": "district:at-bashy", "lang": "ru", "weights": {"green": 1, "stability": 0, "season": 0, "terrain": 0}})
b = int(core.blocks[core.blocks.in_region & (core.blocks.level_class == "low")].iloc[3].block_id)
cases.append({"kind": "sel", "sel": f"block:{b}", "lang": "en"})
cases.append({"kind": "polygon", "geometry": {"type": "Polygon", "coordinates": [[[75.4, 41.4], [75.7, 41.4], [75.7, 41.6], [75.4, 41.6], [75.4, 41.4]]]}, "lang": "en"})
cases.append({"kind": "filter", "filter": {"district": "at-bashy", "elev_min": 2500}, "lang": "en"})
cases.append({"kind": "sel", "sel": "point:10,10,5", "lang": "en"})
out = []
for cs in cases:
    if cs["kind"] == "sel":
        s = SEL.parse(core, cs["sel"], cs["lang"])
    elif cs["kind"] == "polygon":
        s = SEL.polygon(core, cs["geometry"], cs["lang"])
    else:
        s = SEL.from_filter(core, cs["filter"], cs["lang"])
    out.append({"case": cs, "card": C.build_card(core, s, cs["lang"], cs.get("weights"))})
p = Path(__file__).resolve().parents[1] / "export" / "parity_fixture.json"
p.write_text(json.dumps(out, ensure_ascii=False))
print("fixture:", len(out), "->", p)
