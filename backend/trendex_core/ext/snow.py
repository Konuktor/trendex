"""F14 (snow part): card extra `snow` from MODIS MOD10A2 snow cover; computed in ext/seasons.py."""
from .seasons import snow_extra


def card_extra(core, sel, ctx):
    v = snow_extra(core, sel, ctx)
    return ("snow", v) if v else None
