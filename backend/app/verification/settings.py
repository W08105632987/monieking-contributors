"""Director-editable settings, stored in system_config. This module holds the
pure parsing/validation; reading and writing the table is in service.py."""
from dataclasses import dataclass, field

from app.verification import constants as C


class SettingsError(ValueError):
    pass


@dataclass
class Settings:
    enabled: bool = False
    retention_minutes: int = C.DEFAULT_RETENTION_MINUTES
    retention_never: bool = False        # True = keep results forever (retention_minutes is then ignored)
    nin_auth_url: str = ""
    lookup_tier: dict = field(default_factory=lambda: dict(C.DEFAULT_LOOKUP_TIER))
    fees: dict = field(default_factory=dict)          # method -> kobo (0 = not set)
    slips: dict = field(default_factory=dict)         # (kind, tier) -> kobo (0 = not set)

    def fee_for(self, method: str) -> int:
        return int(self.fees.get(method, 0) or 0)

    def slip_price(self, kind: str, tier: str) -> int:
        return int(self.slips.get((kind, tier), 0) or 0)

    def missing_fees(self) -> list[str]:
        return [m for m in C.METHODS if self.fee_for(m) <= 0]

    def can_enable(self) -> bool:
        return not self.missing_fees()


def _int(raw, default=0) -> int:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def parse(raw: dict[str, str | None]) -> Settings:
    """`raw` is {system_config key: value}. Missing/garbled values fall back to
    the safe default (OFF, price 0)."""
    s = Settings()
    s.enabled = str(raw.get(C.K_ENABLED) or "").strip().lower() == "true"
    mins = _int(raw.get(C.K_RETENTION), C.DEFAULT_RETENTION_MINUTES)
    s.retention_minutes = mins if C.MIN_RETENTION_MINUTES <= mins <= C.MAX_RETENTION_MINUTES else C.DEFAULT_RETENTION_MINUTES
    s.retention_never = str(raw.get(C.K_RETENTION_NEVER) or "").strip().lower() == "true"
    s.nin_auth_url = str(raw.get(C.K_NIN_AUTH_URL) or "").strip()
    for kind in C.KINDS:
        t = str(raw.get(C.K_LOOKUP_TIER + kind) or "").strip().lower()
        if t in C.TIERS_BY_KIND[kind]:
            s.lookup_tier[kind] = t
    for m in C.METHODS:
        s.fees[m] = max(0, _int(raw.get(C.K_FEE + m), 0))
    for kind in C.KINDS:
        for tier in C.TIERS_BY_KIND[kind]:
            s.slips[(kind, tier)] = max(0, _int(raw.get(f"{C.K_SLIP}{kind}.{tier}"), 0))
    return s


def all_keys() -> list[str]:
    keys = [C.K_ENABLED, C.K_RETENTION, C.K_RETENTION_NEVER, C.K_NIN_AUTH_URL]
    keys += [C.K_LOOKUP_TIER + k for k in C.KINDS]
    keys += [C.K_FEE + m for m in C.METHODS]
    keys += [f"{C.K_SLIP}{k}.{t}" for k in C.KINDS for t in C.TIERS_BY_KIND[k]]
    return keys


def validate_update(current: Settings, patch: dict) -> dict[str, str]:
    """`patch` is the director's PUT body (any subset). Returns {system_config
    key: new value} to write, or raises SettingsError with a human message.
    Rule: it is impossible to leave the feature ON without every fee set."""
    out: dict[str, str] = {}
    known = {"enabled", "retention_minutes", "retention_hours", "retention_never", "nin_auth_url", "lookup_tier", "fees", "slips"}
    unknown = set(patch) - known
    if unknown:
        raise SettingsError(f"Unknown setting(s): {', '.join(sorted(unknown))}")

    # Apply onto a copy so the enable check sees the final state.
    nxt = Settings(
        enabled=current.enabled, retention_minutes=current.retention_minutes, retention_never=current.retention_never,
        nin_auth_url=current.nin_auth_url, lookup_tier=dict(current.lookup_tier),
        fees=dict(current.fees), slips=dict(current.slips),
    )

    if "retention_minutes" in patch or "retention_hours" in patch:
        # `retention_hours` is the older field name; the Verification page may still send it.
        m = patch["retention_minutes"] if "retention_minutes" in patch else (
            patch["retention_hours"] * 60 if isinstance(patch["retention_hours"], int) and not isinstance(patch["retention_hours"], bool) else None)
        if not isinstance(m, int) or isinstance(m, bool) or not (C.MIN_RETENTION_MINUTES <= m <= C.MAX_RETENTION_MINUTES):
            raise SettingsError(f"Retention must be between {C.MIN_RETENTION_MINUTES // 60} hour and {C.MAX_RETENTION_MINUTES // 60} hours.")
        nxt.retention_minutes = m
        out[C.K_RETENTION] = str(m)

    if "retention_never" in patch:
        v = patch["retention_never"]
        if not isinstance(v, bool):
            raise SettingsError("Keep forever must be on or off.")
        nxt.retention_never = v
        out[C.K_RETENTION_NEVER] = "true" if v else "false"

    if "nin_auth_url" in patch:
        u = str(patch["nin_auth_url"] or "").strip()
        if u and not u.lower().startswith("https://"):
            raise SettingsError("The NIN-Auth link must start with https://")
        if len(u) > 300:
            raise SettingsError("The NIN-Auth link is too long.")
        nxt.nin_auth_url = u
        out[C.K_NIN_AUTH_URL] = u

    for kind, tier in (patch.get("lookup_tier") or {}).items():
        if kind not in C.KINDS or tier not in C.TIERS_BY_KIND[kind]:
            raise SettingsError(f"'{tier}' is not a valid tier for {kind.upper()}.")
        nxt.lookup_tier[kind] = tier
        out[C.K_LOOKUP_TIER + kind] = tier

    for method, kobo in (patch.get("fees") or {}).items():
        if method not in C.METHODS:
            raise SettingsError(f"Unknown fee '{method}'.")
        if not isinstance(kobo, int) or isinstance(kobo, bool) or kobo < 0 or kobo > 100_000_00:
            raise SettingsError("Fees must be whole kobo amounts from 0 to ₦100,000.")
        nxt.fees[method] = kobo
        out[C.K_FEE + method] = str(kobo)

    for key, kobo in (patch.get("slips") or {}).items():
        try:
            kind, tier = key.split(".", 1)
        except ValueError:
            raise SettingsError(f"Unknown slip price '{key}'.")
        if kind not in C.KINDS or tier not in C.TIERS_BY_KIND[kind]:
            raise SettingsError(f"Unknown slip price '{key}'.")
        if not isinstance(kobo, int) or isinstance(kobo, bool) or kobo < 0 or kobo > 100_000_00:
            raise SettingsError("Slip prices must be whole kobo amounts from 0 to ₦100,000.")
        nxt.slips[(kind, tier)] = kobo
        out[f"{C.K_SLIP}{kind}.{tier}"] = str(kobo)

    if "enabled" in patch:
        if not isinstance(patch["enabled"], bool):
            raise SettingsError("'enabled' must be true or false.")
        nxt.enabled = patch["enabled"]
        out[C.K_ENABLED] = "true" if patch["enabled"] else "false"

    if nxt.enabled and not nxt.can_enable():
        names = ", ".join(nxt.missing_fees())
        raise SettingsError(f"Set every verification fee before turning this on. Missing: {names}.")
    return out
