"""Payout bank details for a member. The account name always comes from the bank lookup, never from the member."""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import audit
from app.coop.errors import CoopError
from app.coop.models import CoopLoan, CoopMember, CoopMemberBank
from app.models.user import User


def _tokens(name: str) -> set[str]:
    return {t for t in re.sub(r"[^A-Za-z ]", " ", (name or "").upper()).split() if len(t) > 1}


def names_match(account_name: str, full_name: str) -> bool:
    """Same person: every word of the shorter name appears in the longer one (order and middle names ignored)."""
    a, b = _tokens(account_name), _tokens(full_name)
    if not a or not b:
        return False
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    common = small & big
    return common == small and len(common) >= min(2, len(small))


async def get(db: AsyncSession, member_id) -> CoopMemberBank | None:
    return await db.get(CoopMemberBank, member_id)


def as_dict(b: CoopMemberBank | None) -> dict | None:
    if not b:
        return None
    return {"bank_code": b.bank_code, "bank_name": b.bank_name, "account_number": b.account_number,
            "account_name": b.account_name, "name_match": b.name_match, "name_note": b.name_note,
            "updated_at": b.updated_at.isoformat() if b.updated_at else None}


async def save(db: AsyncSession, m: CoopMember, user: User, bank_code: str, account_number: str, bank_name: str | None, resolver=None) -> CoopMemberBank:
    acct = re.sub(r"\D", "", account_number or "")
    if len(acct) != 10:
        raise CoopError("An account number has 10 digits")
    if not bank_code:
        raise CoopError("Choose a bank")
    if resolver is None:
        from app.integrations.monnify import get_payment_provider
        provider = get_payment_provider()
        resolver = provider.resolve_account_name
    try:
        name = await resolver(acct, bank_code)
    except ValueError as e:
        raise CoopError(str(e))
    except Exception:
        raise CoopError("Could not verify this account right now. Please try again.", 502, "bank_lookup_failed")
    ok = names_match(name, user.full_name)
    row = await db.get(CoopMemberBank, m.id)
    if row:
        row.bank_code, row.bank_name, row.account_number, row.account_name = bank_code, bank_name, acct, name
        row.name_match, row.name_note = ok, None if ok else "The account name does not match your MonieKing name"
    else:
        row = CoopMemberBank(member_id=m.id, bank_code=bank_code, bank_name=bank_name, account_number=acct, account_name=name,
                             name_match=ok, name_note=None if ok else "The account name does not match your MonieKing name")
        db.add(row)
    await db.flush()
    await audit.record(db, "member", m.id, "bank_saved", user.id, {"account": acct[-4:], "bank": bank_code, "name_match": ok})
    # a payout that was waiting for these details can move on
    from app.coop import service
    for l in (await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status == "awaiting_payout"))).scalars().all():
        await service.refresh_payout_hold(db, l, m, row)
    return row


async def from_profile(db: AsyncSession, m: CoopMember, user: User) -> CoopMemberBank:
    """Use the verified bank account already on the member's MonieKing profile."""
    if not (user.bank_code and user.account_number and user.account_name):
        raise CoopError("Your MonieKing profile has no bank account yet. Add one here instead.")
    ok = names_match(user.account_name, user.full_name)
    row = await db.get(CoopMemberBank, m.id)
    vals = dict(bank_code=user.bank_code, bank_name=user.bank_name, account_number=user.account_number,
                account_name=user.account_name, name_match=ok, name_note=None if ok else "The account name does not match your MonieKing name")
    if row:
        for k, v in vals.items():
            setattr(row, k, v)
    else:
        row = CoopMemberBank(member_id=m.id, **vals)
        db.add(row)
    await db.flush()
    await audit.record(db, "member", m.id, "bank_from_profile", user.id, {"account": user.account_number[-4:]})
    from app.coop import service
    for l in (await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status == "awaiting_payout"))).scalars().all():
        await service.refresh_payout_hold(db, l, m, row)
    return row
