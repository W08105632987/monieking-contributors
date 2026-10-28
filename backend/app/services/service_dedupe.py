"""Spot the same service listed twice under different codes or spellings (pure functions, no database).

Example: "NIN Personalisation" (code nin_personalisation) and "NIN Personalization" (code nin_personalization) are one
service. Two copies means two switches and two prices, and the customer sees the tile twice."""
from __future__ import annotations

import re

# British -> American, so "personalisation" and "personalization" are the same word.
_SPELLINGS = (("isation", "ization"), ("ise", "ize"), ("ised", "ized"))


def norm_key(text: str) -> str:
    t = re.sub(r"[^a-z0-9]+", "", (text or "").lower())
    for a, b in _SPELLINGS:
        t = t.replace(a, b)
    return t


def find_existing(title: str, known: list[tuple[str, str]]) -> tuple[str, str] | None:
    """known = [(code, title)]. The first service that is the same as `title`, or None."""
    want = norm_key(title)
    if not want:
        return None
    for code, name in known:
        if norm_key(name) == want or norm_key(code) == want:
            return code, name
    return None


def group_duplicates(rows: list[dict]) -> list[list[dict]]:
    """rows: [{code, name, ...}]. Groups of two or more rows that are the same service."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(norm_key(r.get("name") or r["code"]), []).append(r)
        if norm_key(r["code"]) != norm_key(r.get("name") or r["code"]):
            groups.setdefault(norm_key(r["code"]), [])
    return [g for g in groups.values() if len(g) > 1]


def pick_keeper(group: list[dict]) -> dict:
    """The row to keep: the one customers already use. Order: has a template, then has a provider config, then has
    requests, then is switched on, then was created first."""
    def score(r: dict):
        return (bool(r.get("has_template")), bool(r.get("has_provider_config")), int(r.get("requests") or 0) > 0,
                bool(r.get("is_active")), -(r.get("created_ts") or 0))
    return max(group, key=score)
