"""
The cooperative's append-only money book (coop_journal). All amounts are TEST money in this preview.

Ledgers (each member has their own running balance per ledger):
  contribution   a member's money held by the cooperative (can go up and down)
  locked         the part of it locked behind guarantees
  loan_out       principal lent out (disbursed)  -- record only, no wallet credited
  loan_repaid    what a borrower has paid back, one entry per part: principal / interest / overdue charge
Pool ledgers (member_id is NULL): pool_interest, pool_overdue, pool_withdrawal, running_cost.
Corrections are made with reversing entries, never edits (the database blocks UPDATE/DELETE).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import logic
from app.coop.errors import CoopError
from app.coop.models import CoopJournal
from app.coop.settings_store import Rules

POOL_LEDGERS = ("pool_interest", "pool_overdue", "pool_withdrawal")


async def balance(db: AsyncSession, member_id: Optional[uuid.UUID], ledger: str) -> int:
    q = select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(CoopJournal.ledger == ledger)
    q = q.where(CoopJournal.member_id == member_id) if member_id else q.where(CoopJournal.member_id.is_(None))
    return int((await db.execute(q)).scalar_one())


async def free_funds(db: AsyncSession, member_id: uuid.UUID) -> int:
    return await balance(db, member_id, "contribution") - await balance(db, member_id, "locked")


async def post(db: AsyncSession, rules: Rules, *, member_id: Optional[uuid.UUID], ledger: str, entry_type: str,
               delta: int, reference: str, loan_id=None, guarantee_id=None, actor=None, note: str | None = None,
               reverses_id: int | None = None) -> CoopJournal:
    if delta == 0:
        raise CoopError("Nothing to record")
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                     {"k": f"coop:{member_id or 'pool'}:{ledger}"})
    bal = await balance(db, member_id, ledger)
    new_bal = bal + delta
    if ledger in ("contribution", "locked") and new_bal < 0:
        raise CoopError("That would take the balance below zero", 409, "negative_balance")
    now = rules.now()
    row = CoopJournal(member_id=member_id, ledger=ledger, entry_type=entry_type, delta_kobo=delta,
                      balance_after=new_bal, loan_id=loan_id, guarantee_id=guarantee_id, reference=reference,
                      accounting_year=logic.accounting_year(now.date()), effective_at=now,
                      actor_id=actor, reverses_id=reverses_id, note=note)
    db.add(row)
    await db.flush()
    return row


async def pool_total(db: AsyncSession, year: Optional[int] = None) -> int:
    q = select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(CoopJournal.ledger.in_(POOL_LEDGERS))
    if year:
        q = q.where(CoopJournal.accounting_year == year)
    return int((await db.execute(q)).scalar_one())
