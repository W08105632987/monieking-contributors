"""
The cooperative's append-only money book (coop_journal). All amounts are TEST money in this preview.

Ledgers (each member has their own running balance per ledger):
  contribution   a member's money held by the cooperative (can go up and down)
  locked         the part of it locked behind guarantees
  loan_out       principal lent out (disbursed)  -- record only, no wallet credited
  loan_repaid    what a borrower has paid back, one entry per part: principal / interest / overdue charge
  loan_written_off  principal written off after a recovery failure (per borrower and loan)
  dividend_paid     a dividend paid out of the cooperative to a member (record of the payout)
Pool ledgers (member_id is NULL): pool_interest, pool_overdue, pool_withdrawal, pool_distributed, pool_carry,
running_cost (the running-cost fund, also receives membership fees and pays expenses) and operating (transfer fees).
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

POOL_LEDGERS = ("pool_interest", "pool_overdue", "pool_withdrawal", "pool_distributed", "pool_carry")
NO_MEMBER_LEDGERS = POOL_LEDGERS + ("running_cost", "operating")


async def balance(db: AsyncSession, member_id: Optional[uuid.UUID], ledger: str) -> int:
    q = select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(CoopJournal.ledger == ledger)
    q = q.where(CoopJournal.member_id == member_id) if member_id else q.where(CoopJournal.member_id.is_(None))
    return int((await db.execute(q)).scalar_one())


async def free_funds(db: AsyncSession, member_id: uuid.UUID) -> int:
    return await balance(db, member_id, "contribution") - await balance(db, member_id, "locked")


async def post(db: AsyncSession, rules: Rules, *, member_id: Optional[uuid.UUID], ledger: str, entry_type: str,
               delta: int, reference: str, loan_id=None, guarantee_id=None, actor=None, note: str | None = None,
               reverses_id: int | None = None, year: int | None = None) -> CoopJournal:
    """`year` overrides the accounting year (used when a year-end run is posted after the year has turned)."""
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
                      accounting_year=year or logic.accounting_year(now.date()), effective_at=now,
                      actor_id=actor, reverses_id=reverses_id, note=note)
    db.add(row)
    await db.flush()
    return row


async def pool_total(db: AsyncSession, year: Optional[int] = None) -> int:
    q = select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(CoopJournal.ledger.in_(POOL_LEDGERS))
    if year:
        q = q.where(CoopJournal.accounting_year == year)
    return int((await db.execute(q)).scalar_one())


async def money_totals(db: AsyncSession) -> dict:
    """Every ledger total in one query (used by the money position and the reconciliation)."""
    rows = (await db.execute(select(CoopJournal.ledger, func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).group_by(CoopJournal.ledger))).all()
    return {l: int(v) for l, v in rows}
