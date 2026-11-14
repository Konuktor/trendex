import re

import yaml

from trendex_core import config

FORBIDDEN = re.compile(r"degradat|\bcause|деградац|причин", re.I)


def _strings(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)
    elif isinstance(o, str):
        yield o


def test_no_forbidden_words():
    for lang in ("en", "ru"):
        bad = [s for s in _strings(config.texts(lang)) if FORBIDDEN.search(s)]
        assert not bad, bad


def test_matrix_complete_and_texts_exist():
    m = config.matrix()
    for lang in ("en", "ru"):
        acts = config.texts(lang)["actions"]
        for lv in ("suitable", "limited", "low"):
            for dy in ("growth", "decline", "unreliable", "insufficient"):
                assert m[lv][dy] in acts
        assert "excluded" in acts and "insufficient" in acts


def test_same_keys_both_languages():
    def keys(o, p=""):
        if isinstance(o, dict):
            return set().union(*[keys(v, f"{p}.{k}") for k, v in o.items()]) | {p}
        return {p}
    assert keys(config.texts("en")) == keys(config.texts("ru"))
