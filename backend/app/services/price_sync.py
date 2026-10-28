"""Keeps the two places that hold a manual service's price in step (pure functions, no database).

A built-in manual service has its prices in TWO places:
  * the price table the Identity Services page edits (`manual_services_pricing`), and
  * the price rules of its template, which the Service Builder edits.
The charge reads the rules only when the service runs on the template flow, otherwise the table, so an edit made
in one place used to be ignored when the other was in use. These helpers copy a price from either place to the other.

Both directions use the same mapping the seeding code and the parity check already use
(`rules_from_price_map` and `manual_pricing.get_price`), so a round trip never changes a price."""
from __future__ import annotations

from app.services import service_template_engine as eng
from app.services.service_template_seeds import BVN_COMBO_TYPES, rules_from_price_map


def _selections_for(category: str, key: str) -> dict:
    if key == "default":
        return {}
    if category == "bvn_modification" and key not in BVN_COMBO_TYPES:
        return {"enrollment_bank": key}          # single updates are priced by the enrollment bank
    return {"service_type": key}


def table_from_rules(category: str, schema: dict, rules: list[dict], current: dict[str, int] | None = None) -> dict[str, int]:
    """The price table this template's rules amount to: every key already in the table, plus every service type
    the template offers, each priced by the engine. Keys the rules cannot price are left out (never guessed)."""
    keys = list((current or {}).keys())
    for s in ([] if category == "bvn_modification" else schema.get("selectors", [])):   # BVN's types are priced by bank
        if s.get("key") == "service_type":
            for o in s.get("options", []):
                v = str(o["value"])
                if v not in keys:
                    keys.append(v)
    if "default" not in keys:
        keys.append("default")
    out: dict[str, int] = {}
    for k in keys:
        try:
            out[k] = eng.compute_price(rules, _selections_for(category, k), 1)
        except eng.NoPriceError:
            continue
    return out


def rules_from_table(category: str, table: dict[str, int]) -> list[dict]:
    return rules_from_price_map(category, table)


def differs(a: dict[str, int], b: dict[str, int]) -> bool:
    """Do any of the prices in `a` differ from `b`? (Keys only in one side are ignored.)"""
    return any(b[k] != v for k, v in a.items() if k in b)


def _when_for(category: str, key: str) -> dict:
    if key == "default":
        return {}
    if category == "bvn_modification" and key not in BVN_COMBO_TYPES:
        return {"enrollment_bank": [key]}
    return {"service_type": [key]}


def apply_table_changes(category: str, rules: list[dict], changes: dict[str, int]) -> list[dict]:
    """Copy of `rules` with only the changed prices updated (everything else the director built is kept).
    A changed key with no rule of its own gets one, placed before the match-everything default."""
    out = [dict(r) for r in rules]
    for key, price in changes.items():
        when = _when_for(category, key)
        idx = next((i for i, r in enumerate(out) if r.get("when", {}) == when), None)
        if idx is not None:
            out[idx] = {**out[idx], "price_kobo": int(price)}
        elif not when:
            out.append({"when": {}, "price_kobo": int(price), "per": "flat"})
        else:
            per = out[-1].get("per", "flat") if out else "flat"
            at = next((i for i, r in enumerate(out) if not r.get("when")), len(out))
            out.insert(at, {"when": when, "price_kobo": int(price), "per": per})
    return out


def table_changes(old: dict[str, int], new: dict[str, int]) -> dict[str, int]:
    return {k: v for k, v in new.items() if old.get(k) != v}
