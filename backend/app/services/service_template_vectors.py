"""
Test vectors that pin the Python form rules and the TypeScript port together.

`build_vectors()` runs the Python engine over every seeded template with several
answer sets and records what it says is visible / missing / stripped. The result is
saved to apps/web/src/lib/__fixtures__/templateRules.vectors.json and replayed by
apps/web/src/lib/templateRules.test.ts. A Python test fails if the saved file is
stale, so changing a template or a rule forces the vectors to be regenerated and
the TypeScript side to be re-checked.

Regenerate:  python -m scripts.generate_template_rule_vectors
"""
from __future__ import annotations

from itertools import product
from typing import Any

from app.services import service_template_engine as eng
from app.services import service_template_seeds as seeds


def _value_for(f: dict) -> Any:
    t = f["type"]
    if t == "digits":
        return "1" * f.get("length", 11)
    if t == "date":
        return "2000-01-01"
    if t == "select":
        o = f["options"][0]
        return o["value"] if isinstance(o, dict) else o
    if t == "file":
        return "https://f/x"
    if t == "phone":
        return "08012345678"
    if t == "email":
        return "a@b.co"
    if t == "nin_list":
        return ["12345678901"]
    return "x"


def build_vectors(price_map: dict) -> dict:
    templates = seeds.build_seed_templates(price_map)
    cases = []
    for t in templates:
        sch = t.schema
        sels = sch["selectors"]
        combos = list(product(*[[(s["key"], o["value"]) for o in s["options"]] for s in sels])) or [()]
        for combo in combos[:40]:
            base = dict(combo)
            every = {f["key"]: _value_for(f) for f in sch["fields"]}
            bad = {**every, **base, **{f["key"]: "12" for f in sch["fields"] if f["type"] == "digits"}}
            sets = (
                ("selectors_only", dict(base)),
                ("everything_filled", {**every, **base}),
                ("bad_digits", bad),
                ("blank_strings", {**{f["key"]: "  " for f in sch["fields"]}, **base}),
            )
            for label, ans in sets:
                cases.append({
                    "service": t.service_code, "label": label, "answers": ans,
                    "visible": [f["key"] for f in eng.visible_fields(sch, ans)],
                    "missing": eng.missing_required(sch, ans),
                    "stripped": eng.strip_hidden(sch, ans),
                })
    return {"schemas": {t.service_code: t.schema for t in templates}, "cases": cases}
