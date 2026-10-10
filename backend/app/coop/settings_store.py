"""
Director-controlled rule book: reading, proposing, approving and scheduling changes.

- Defaults live in defs.py; only overrides are stored (coop_settings).
- A change needs `approvals_settings` distinct directors (the proposer counts as the first).
- Depending on the rule, an approved change applies now, applies to new loans only
  (loans snapshot their terms when created), or is scheduled for the next accounting year.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import audit, defs, logic
from app.coop.models import CoopSetting, CoopSettingChange, CoopSettingChangeApproval


class Rules:
    """A snapshot of every rule for the duration of one request."""

    def __init__(self, overrides: dict[str, str]):
        self.overrides = overrides

    def raw(self, key: str) -> str:
        if key == "dividend_guarantee_pct":
            return str(100 - int(self.raw("dividend_contribution_pct")))
        d = defs.BY_KEY[key]
        return self.overrides.get(key, d.default)

    def get(self, key: str):
        if key == "dividend_guarantee_pct":
            return 100 - int(self.get("dividend_contribution_pct"))
        return defs.parse_value(defs.BY_KEY[key], self.raw(key))

    def is_confirmed(self, key: str) -> bool:
        d = defs.BY_KEY[key]
        if key == "dividend_guarantee_pct":
            return self.is_confirmed("dividend_contribution_pct")
        return d.confirmed or key in self.overrides

    def now(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(days=int(self.get("test_clock_offset_days")))

    def today(self) -> date:
        return self.now().date()


async def load_rules(db: AsyncSession) -> Rules:
    rows = (await db.execute(select(CoopSetting))).scalars().all()
    rules = Rules({r.key: r.value for r in rows})
    await _apply_due(db, rules)
    return rules


async def _upsert(db: AsyncSession, key: str, value: str, by: uuid.UUID | None) -> None:
    row = await db.get(CoopSetting, key)
    if row:
        row.value, row.updated_by, row.updated_at = value, by, datetime.now(timezone.utc)
    else:
        db.add(CoopSetting(key=key, value=value, updated_by=by))
    await db.flush()


async def _apply_due(db: AsyncSession, rules: Rules) -> None:
    """Switch on scheduled (next-year) changes whose date has arrived."""
    today = rules.today()
    due = (await db.execute(select(CoopSettingChange).where(
        CoopSettingChange.status == "scheduled", CoopSettingChange.effective_on <= today)
        .order_by(CoopSettingChange.effective_on, CoopSettingChange.created_at))).scalars().all()
    for ch in due:
        await _upsert(db, ch.key, ch.new_value, ch.proposed_by)
        rules.overrides[ch.key] = ch.new_value
        ch.status = "applied"
        ch.decided_at = datetime.now(timezone.utc)
        await audit.record(db, "setting", ch.key, "scheduled_change_applied", None, {"new": ch.new_value})


async def propose(db: AsyncSession, rules: Rules, director: "User", key: str, value, reason: str | None) -> CoopSettingChange:
    d = defs.BY_KEY.get(key)
    if not d or (d.hidden and key != "accountant_user_id"):
        raise defs.SettingError("Unknown setting")
    if d.readonly:
        raise defs.SettingError("This setting cannot be changed in the preview")
    new = defs.normalise_value(d, value)
    if new == rules.raw(key):
        raise defs.SettingError("That is already the current value")
    pending = (await db.execute(select(CoopSettingChange).where(
        CoopSettingChange.key == key, CoopSettingChange.status == "pending"))).scalars().first()
    if pending:
        raise defs.SettingError("A change to this rule is already waiting for approval")
    ch = CoopSettingChange(key=key, old_value=rules.raw(key), new_value=new, effect=d.effect,
                           reason=(reason or "").strip() or None, proposed_by=director.id)
    db.add(ch)
    await db.flush()
    db.add(CoopSettingChangeApproval(change_id=ch.id, director_id=director.id, decision="approve"))
    await db.flush()
    await audit.record(db, "setting", key, "change_proposed", director.id, {"old": ch.old_value, "new": new, "reason": ch.reason})
    await _maybe_finish(db, rules, ch, director.id)
    return ch


async def decide(db: AsyncSession, rules: Rules, director: "User", change_id: uuid.UUID, decision: str) -> CoopSettingChange:
    ch = (await db.execute(select(CoopSettingChange).where(CoopSettingChange.id == change_id).with_for_update())).scalars().first()
    if not ch:
        raise defs.SettingError("Change not found")
    if ch.status != "pending":
        raise defs.SettingError("This change has already been decided")
    existing = (await db.execute(select(CoopSettingChangeApproval).where(
        CoopSettingChangeApproval.change_id == ch.id, CoopSettingChangeApproval.director_id == director.id))).scalars().first()
    if existing:
        raise defs.SettingError("You have already voted on this change")
    db.add(CoopSettingChangeApproval(change_id=ch.id, director_id=director.id, decision=decision))
    await db.flush()
    await audit.record(db, "setting", ch.key, f"change_{decision}", director.id, {"change_id": str(ch.id)})
    if decision == "reject":
        ch.status, ch.decided_at = "rejected", datetime.now(timezone.utc)
        return ch
    await _maybe_finish(db, rules, ch, director.id)
    return ch


async def _maybe_finish(db: AsyncSession, rules: Rules, ch: CoopSettingChange, actor: uuid.UUID) -> None:
    need = int(rules.get("approvals_settings"))
    have = (await db.execute(select(func.count()).select_from(CoopSettingChangeApproval).where(
        CoopSettingChangeApproval.change_id == ch.id, CoopSettingChangeApproval.decision == "approve"))).scalar_one()
    if have < need:
        return
    d = defs.BY_KEY[ch.key]
    now = datetime.now(timezone.utc)
    if ch.effect == defs.EFFECT_NEXT_YEAR:
        y = logic.accounting_year(rules.today(), int(rules.get("year_end_month")), int(rules.get("year_end_day")))
        ch.effective_on = logic.year_bounds(y + 1)[0]
        ch.status = "scheduled"
        await audit.record(db, "setting", ch.key, "change_scheduled", actor, {"effective_on": ch.effective_on.isoformat(), "new": ch.new_value})
    else:
        await _upsert(db, ch.key, ch.new_value, ch.proposed_by)
        rules.overrides[ch.key] = ch.new_value
        ch.status = "applied"
        await audit.record(db, "setting", ch.key, "change_applied", actor, {"new": ch.new_value})
    ch.decided_at = now


async def set_test_clock(db: AsyncSession, days: int, by: uuid.UUID) -> None:
    await _upsert(db, "test_clock_offset_days", str(days), by)


def describe(rules: Rules, pending: dict, scheduled: dict) -> list[dict]:
    """The settings screen payload, grouped in display order."""
    out = []
    for d in defs.DEFINITIONS:
        if d.hidden:
            continue
        cur = rules.raw(d.key)
        out.append({
            "key": d.key, "group": d.group, "label": d.label, "kind": d.kind, "unit": d.unit,
            "value": cur, "default": d.default, "options": list(d.options), "min": d.min, "max": d.max,
            "confirmed": rules.is_confirmed(d.key), "effect": d.effect, "effect_label": defs.EFFECT_LABEL[d.effect],
            "note": d.note, "readonly": d.readonly, "required_for_live": d.required_for_live,
            "pending": pending.get(d.key), "scheduled": scheduled.get(d.key),
        })
    return out


def public_summary(rules: Rules) -> dict:
    """Everything a member screen needs to show rules in plain numbers (no secrets)."""
    keys = ["registration_min_kobo", "loan_rate_bps", "loan_min_kobo", "loan_max_kobo", "loan_term_months", "loan_max_active",
            "cover_pct", "guarantee_min_kobo", "guarantee_max_kobo", "guarantee_max_active", "guarantee_min_commit_pct",
            "guarantor_min_funds_pct", "loan_max_guarantors", "loan_request_expiry_days", "invite_expiry_hours",
            "overdue_daily_bps", "overdue_cap_pct", "early_withdrawal_bps", "running_cost_bps",
            "dividend_contribution_pct", "dividend_guarantee_pct", "dividend_min_balance_kobo", "dividend_min_months",
            "approvals_loan", "loan_first_limit_kobo", "loan_cooling_days", "year_end_month", "year_end_day"]
    return {k: rules.get(k) for k in keys} | {"provisional": [k for k in keys if not rules.is_confirmed(k)]}
