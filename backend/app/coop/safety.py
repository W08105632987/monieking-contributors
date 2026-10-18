"""Safety rails for money actions: extra confirmation (step-up), pilot cap, and idempotency."""
from __future__ import annotations

from typing import Awaitable, Callable, Optional

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop.errors import CoopError
from app.coop.models import CoopIdempotency, CoopJournal
from app.coop.settings_store import Rules
from app.models.user import User


class AuthBody(BaseModel):
    """Same shape the wallet withdrawal uses: the withdrawal password or a fingerprint/face assertion."""
    auth_method: str
    withdrawal_password: Optional[str] = None
    webauthn_assertion: Optional[dict] = None


def step_up_needed(rules: Rules, level: str) -> bool:
    mode = rules.get("step_up_required")
    return mode == "all_money" or (mode == "member_money" and level == "member")


async def require_step_up(db: AsyncSession, rules: Rules, user: User, auth: Optional[AuthBody], level: str = "member") -> None:
    """Raise unless the extra confirmation the rules ask for has been given. level: member | director."""
    if not step_up_needed(rules, level):
        return
    if auth is None:
        raise CoopError("Please confirm with your withdrawal password or fingerprint", 403, "step_up_required")
    from fastapi import HTTPException
    try:
        if auth.auth_method == "password":
            if not auth.withdrawal_password:
                raise CoopError("Enter your withdrawal password", 403, "step_up_required")
            from app.services.withdrawal_auth_service import check_withdrawal_password
            await check_withdrawal_password(db, user, auth.withdrawal_password)
        elif auth.auth_method == "biometric":
            if not auth.webauthn_assertion:
                raise CoopError("Fingerprint confirmation is needed", 403, "step_up_required")
            from app.services.webauthn_service import verify_authentication
            await verify_authentication(db, user, auth.webauthn_assertion)
        else:
            raise CoopError("Choose password or fingerprint to confirm", 403, "step_up_required")
    except HTTPException as e:
        raise CoopError(str(e.detail), 403 if e.status_code < 500 else e.status_code, "step_up_failed")


# ── pilot cap ─────────────────────────────────────────────────────────────
async def pilot_received(db: AsyncSession) -> int:
    """Everything ever paid in (registration and top-ups). Withdrawals never reduce it."""
    return int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
        CoopJournal.ledger == "contribution", CoopJournal.entry_type.in_(("registration", "contribution")),
        CoopJournal.delta_kobo > 0))).scalar_one())


async def pilot_status(db: AsyncSession, rules: Rules) -> dict:
    on = bool(rules.get("coop_pilot_only")) and bool(rules.get("pilot_cap_enabled"))
    cap = int(rules.get("pilot_cap_kobo"))
    got = await pilot_received(db)
    return {"enabled": on, "cap_kobo": cap, "received_kobo": got, "remaining_kobo": max(cap - got, 0) if on else None}


async def check_pilot_cap(db: AsyncSession, rules: Rules, amount: int) -> None:
    ps = await pilot_status(db, rules)
    if ps["enabled"] and ps["received_kobo"] + amount > ps["cap_kobo"]:
        from app.coop.service import naira
        raise CoopError(f"The pilot is limited to {naira(ps['cap_kobo'])} in total and only {naira(ps['remaining_kobo'])} is left.", 409, "pilot_cap")


# ── idempotency ───────────────────────────────────────────────────────────
async def idempotent(db: AsyncSession, user: User, key: Optional[str], endpoint: str, fn: Callable[[], Awaitable[dict]]) -> dict:
    """
    Run `fn` once per (key, user). A repeat with the same key gets the first answer back and nothing runs again.
    If `fn` fails the whole request rolls back, the key with it, so the user can retry with the same key.
    """
    if not key:
        return await fn()
    key = key.strip()[:120]
    res = await db.execute(insert(CoopIdempotency).values(key=key, user_id=user.id, endpoint=endpoint[:120])
                           .on_conflict_do_nothing().returning(CoopIdempotency.key))
    if res.first() is None:
        row = await db.get(CoopIdempotency, (key, user.id))
        if row is not None and row.response is not None:
            return row.response
        raise CoopError("This request is already being processed", 409, "in_progress")
    out = await fn()
    row = await db.get(CoopIdempotency, (key, user.id))
    row.response = jsonable_encoder(out)
    await db.flush()
    return out
