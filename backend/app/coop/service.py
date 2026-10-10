"""Cooperative business operations (membership, loans, guarantees, repayments). Preview: test money only."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import audit, contract, ledger, logic
from app.coop.errors import CoopError
from app.coop.models import (CoopGuarantee, CoopLoan, CoopLoanApproval, CoopMember, CoopPilotMember, CoopJournal)
from app.coop.settings_store import Rules
from app.models.user import User, UserRole

log = logging.getLogger(__name__)

ACTIVE_LOAN = ("seeking_guarantors", "awaiting_approval", "repaying")
LIVE_INVITE = ("invited", "viewed")


def naira(k: int) -> str:
    return "₦{:,.2f}".format(k / 100).replace(".00", "")


async def notify(db: AsyncSession, user_id, title: str, body: str, link: str = "/coop") -> None:
    """Best effort: a notification failure must never undo a money action."""
    try:
        from app.models.notification import NotificationType
        from app.services.notification_service import send_notification
        async with db.begin_nested():
            await send_notification(db, user_id=user_id, title=title, body=body,
                                    type=NotificationType.INFO, deep_link_url=link)
    except Exception:  # pragma: no cover
        log.warning("coop notification failed", exc_info=True)


# ── access ────────────────────────────────────────────────────────────────
async def has_access(db: AsyncSession, rules: Rules, user: User) -> bool:
    if not rules.get("coop_enabled"):
        return False
    if not rules.get("coop_pilot_only"):
        return user.role == UserRole.CUSTOMER
    if user.role != UserRole.CUSTOMER:
        return False
    return (await db.get(CoopPilotMember, user.id)) is not None


async def member_of(db: AsyncSession, user: User) -> Optional[CoopMember]:
    return (await db.execute(select(CoopMember).where(CoopMember.user_id == user.id))).scalars().first()


async def require_member(db: AsyncSession, user: User) -> CoopMember:
    m = await member_of(db, user)
    if not m or m.status != "active":
        raise CoopError("Join the cooperative first", 403, "not_member")
    return m


# ── membership ────────────────────────────────────────────────────────────
async def join(db: AsyncSession, rules: Rules, user: User, amount: int, nin_bypass: bool) -> CoopMember:
    if await member_of(db, user):
        raise CoopError("You are already a member", 409, "already_member")
    if amount < int(rules.get("registration_min_kobo")):
        raise CoopError(f"The minimum to join is {naira(int(rules.get('registration_min_kobo')))}")
    bypass = False
    if rules.get("nin_required") and not user.nin_linked:
        if not nin_bypass:
            raise CoopError("Your NIN must be linked before you can join", 409, "nin_required")
        bypass = True  # preview only: recorded on the member so directors can see it
    n = (await db.execute(text("SELECT nextval('coop_card_seq')"))).scalar_one()
    m = CoopMember(user_id=user.id, card_no=f"MK-C {n:04d} {(n * 7 + 13) % 100:02d}", nin_bypassed=bypass)
    db.add(m)
    await db.flush()
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="registration",
                      delta=amount, reference=f"join:{m.id}", actor=user.id, note="Registration (test money)")
    await audit.record(db, "member", m.id, "joined", user.id, {"amount": amount, "nin_bypassed": bypass})
    return m


async def contribute(db: AsyncSession, rules: Rules, m: CoopMember, amount: int, actor) -> None:
    if amount <= 0 or amount > 10_000_000_000:
        raise CoopError("Enter a valid amount")
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="contribution",
                      delta=amount, reference=f"contrib:{uuid.uuid4()}", actor=actor, note="Top-up (test money)")


async def withdraw_preview(db: AsyncSession, rules: Rules, m: CoopMember, amount: int) -> dict:
    free = await ledger.free_funds(db, m.id)
    if amount <= 0:
        raise CoopError("Enter a valid amount")
    if amount > free:
        raise CoopError(f"You can withdraw at most {naira(free)}. The rest is locked behind guarantees.", 409, "locked")
    bps = int(rules.get("early_withdrawal_bps"))
    charge = amount * bps // 10000
    return {"amount_kobo": amount, "charge_kobo": charge, "you_receive_kobo": amount - charge, "charge_bps": bps,
            "loses_dividend": charge > 0, "free_kobo": free}


async def withdraw(db: AsyncSession, rules: Rules, m: CoopMember, amount: int, actor) -> dict:
    pv = await withdraw_preview(db, rules, m, amount)
    ref = uuid.uuid4()
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="withdrawal",
                      delta=-amount, reference=f"wd:{ref}", actor=actor, note="Withdrawal (test money)")
    if pv["charge_kobo"] > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_withdrawal", entry_type="withdrawal_charge",
                          delta=pv["charge_kobo"], reference=f"wdc:{ref}", actor=actor, note=f"Early withdrawal charge from {m.card_no}")
        m.disqualified_year = logic.accounting_year(rules.today())
    await audit.record(db, "member", m.id, "withdrawal", actor, pv)
    return pv


# ── sweeping (lazy expiry) ────────────────────────────────────────────────
async def release_guarantees(db: AsyncSession, rules: Rules, loan: CoopLoan, why: str, final_status: str = "released") -> None:
    gs = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id))).scalars().all()
    for g in gs:
        if g.status == "signed":
            await ledger.post(db, rules, member_id=g.guarantor_id, ledger="locked", entry_type="unlock",
                              delta=-g.amount_kobo, reference=f"unlock:{g.id}", loan_id=loan.id, guarantee_id=g.id,
                              note=why)
            g.status, g.released_at = final_status, rules.now()
        elif g.status in LIVE_INVITE:
            g.status = "cancelled"


async def sweep(db: AsyncSession, rules: Rules) -> None:
    now = rules.now()
    gs = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.status.in_(LIVE_INVITE), CoopGuarantee.expires_at < now))).scalars().all()
    for g in gs:
        g.status = "expired"
    ls = (await db.execute(select(CoopLoan).where(CoopLoan.status == "seeking_guarantors", CoopLoan.expires_at < now).with_for_update())).scalars().all()
    for l in ls:
        l.status, l.closed_at, l.decision_note = "expired", now, "Not fully guaranteed in time"
        await release_guarantees(db, rules, l, "Loan request expired")
        await audit.record(db, "loan", l.id, "expired", None)
        mem = await db.get(CoopMember, l.member_id)
        await notify(db, mem.user_id, "Loan request expired", f"{l.loan_no} was not fully guaranteed in time. Nothing was charged.", "/coop/loans")
    await db.flush()


# ── loans ─────────────────────────────────────────────────────────────────
def instalment_preview(principal: int, term: int, rate_bps: int, start) -> dict:
    interest = logic.interest_for(principal, rate_bps)
    sched = logic.build_schedule(principal, interest, term, start)
    return {"interest_kobo": interest, "total_kobo": principal + interest, "schedule": sched,
            "instalment_kobo": sched[0]["amount_kobo"]}


async def create_loan(db: AsyncSession, rules: Rules, m: CoopMember, user: User, amount: int, term: int, purpose: str | None) -> CoopLoan:
    if user.role != UserRole.CUSTOMER:
        raise CoopError("Directors and officers cannot borrow", 403)
    await sweep(db, rules)
    if amount < int(rules.get("loan_min_kobo")) or amount > int(rules.get("loan_max_kobo")):
        raise CoopError(f"A loan must be between {naira(int(rules.get('loan_min_kobo')))} and {naira(int(rules.get('loan_max_kobo')))}")
    if term < 1 or term > int(rules.get("loan_term_months")):
        raise CoopError(f"The term must be 1 to {rules.get('loan_term_months')} months")
    active = (await db.execute(select(func.count()).select_from(CoopLoan).where(
        CoopLoan.member_id == m.id, CoopLoan.status.in_(ACTIVE_LOAN)))).scalar_one()
    if active >= int(rules.get("loan_max_active")):
        raise CoopError("You already have an active loan request or loan", 409, "active_loan")
    cool = int(rules.get("loan_cooling_days"))
    if cool and (rules.now() - m.registered_at).days < cool:
        raise CoopError(f"New members can ask for a loan after {cool} days")
    rate = int(rules.get("loan_rate_bps"))
    pv = instalment_preview(amount, term, rate, rules.today())
    prior = (await db.execute(select(func.count()).select_from(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status == "repaid"))).scalar_one()
    flags = []
    if prior == 0 and amount > int(rules.get("loan_first_limit_kobo")):
        flags.append("above_first_loan_limit")
    if m.nin_bypassed:
        flags.append("nin_not_linked")
    n = (await db.execute(text("SELECT nextval('coop_loan_seq')"))).scalar_one()
    loan = CoopLoan(loan_no=f"L-{n:04d}", member_id=m.id, purpose=(purpose or "").strip()[:200] or None, principal_kobo=amount,
                    term_months=term, rate_bps=rate, interest_kobo=pv["interest_kobo"], total_kobo=pv["total_kobo"],
                    overdue_daily_bps=int(rules.get("overdue_daily_bps")), overdue_cap_pct=int(rules.get("overdue_cap_pct")),
                    overdue_grace_days=int(rules.get("overdue_grace_days")), cover_pct=int(rules.get("cover_pct")),
                    approvals_required=int(rules.get("approvals_loan")), schedule=[], flags=flags, status="seeking_guarantors",
                    expires_at=rules.now() + timedelta(days=int(rules.get("loan_request_expiry_days"))))
    db.add(loan)
    await db.flush()
    await audit.record(db, "loan", loan.id, "requested", user.id, {"amount": amount, "term": term, "rate_bps": rate, "flags": flags})
    return loan


async def guarantee_totals(db: AsyncSession, loan: CoopLoan) -> dict:
    rows = (await db.execute(select(CoopGuarantee.status, func.coalesce(func.sum(CoopGuarantee.amount_kobo), 0))
                             .where(CoopGuarantee.loan_id == loan.id).group_by(CoopGuarantee.status))).all()
    by = {s: int(v) for s, v in rows}
    signed = by.get("signed", 0)
    pending = by.get("invited", 0) + by.get("viewed", 0)
    need = logic.cover_required(loan.principal_kobo, loan.cover_pct)
    return {"signed": signed, "pending": pending, "need": need, "uncovered": max(need - signed - pending, 0),
            "still_needed": max(need - signed, 0)}


async def active_guarantee_count(db: AsyncSession, member_id) -> int:
    return (await db.execute(select(func.count()).select_from(CoopGuarantee).join(CoopLoan, CoopLoan.id == CoopGuarantee.loan_id)
                             .where(CoopGuarantee.guarantor_id == member_id, CoopGuarantee.status == "signed",
                                    CoopLoan.status.in_(("awaiting_approval", "repaying"))))).scalar_one()


async def invite(db: AsyncSession, rules: Rules, loan: CoopLoan, borrower_user: User, guarantor: CoopMember, amount: int) -> CoopGuarantee:
    await sweep(db, rules)
    if loan.status != "seeking_guarantors":
        raise CoopError("This loan is no longer looking for guarantors", 409)
    if guarantor.id == loan.member_id:
        raise CoopError("You cannot guarantee your own loan")
    if guarantor.status != "active" or not guarantor.pool_listed:
        raise CoopError("That member is not in the guarantors' pool", 409)
    gu = await db.get(User, guarantor.user_id)
    if gu.role != UserRole.CUSTOMER:
        raise CoopError("That member cannot guarantee", 409)
    existing = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id, CoopGuarantee.guarantor_id == guarantor.id))).scalars().first()
    if existing and existing.status in ("invited", "viewed", "signed"):
        raise CoopError("That guarantor is already invited", 409)
    live = (await db.execute(select(func.count()).select_from(CoopGuarantee).where(
        CoopGuarantee.loan_id == loan.id, CoopGuarantee.status.in_(("invited", "viewed", "signed"))))).scalar_one()
    if live >= int(rules.get("loan_max_guarantors")):
        raise CoopError(f"A loan can have at most {rules.get('loan_max_guarantors')} guarantors")
    t = await guarantee_totals(db, loan)
    if t["uncovered"] <= 0:
        raise CoopError("This loan already has enough guarantees invited", 409)
    lo = max(int(rules.get("guarantee_min_kobo")), 0)
    floor = logic.min_commit(loan.principal_kobo, int(rules.get("guarantee_min_commit_pct")), lo, t["uncovered"])
    if amount < min(floor, t["uncovered"]) or amount < min(lo, t["uncovered"]):
        raise CoopError(f"The guarantee must be at least {naira(min(max(floor, lo), t['uncovered']))}")
    if amount > int(rules.get("guarantee_max_kobo")) or amount > t["uncovered"]:
        raise CoopError(f"The guarantee can be at most {naira(min(int(rules.get('guarantee_max_kobo')), t['uncovered']))}")
    if guarantor.pool_offer_kobo and amount > guarantor.pool_offer_kobo:
        raise CoopError(f"That member offered at most {naira(guarantor.pool_offer_kobo)}")
    g = CoopGuarantee(loan_id=loan.id, guarantor_id=guarantor.id, amount_kobo=amount, status="invited",
                      expires_at=rules.now() + timedelta(hours=int(rules.get("invite_expiry_hours")))) if not existing else existing
    if existing:
        existing.amount_kobo, existing.status, existing.invited_at = amount, "invited", rules.now()
        existing.expires_at = rules.now() + timedelta(hours=int(rules.get("invite_expiry_hours")))
    else:
        db.add(g)
    await db.flush()
    await audit.record(db, "guarantee", g.id, "invited", borrower_user.id, {"loan": loan.loan_no, "amount": amount})
    await notify(db, guarantor.user_id, "Guarantor request",
                 f"{borrower_user.full_name} asks you to guarantee {naira(amount)} of loan {loan.loan_no}.", f"/coop/invites/{g.id}")
    return g


def contract_vars(rules: Rules, loan: CoopLoan, g: CoopGuarantee, guarantor: CoopMember, gu: User, borrower: CoopMember, bu: User) -> dict:
    cap = int(loan.overdue_cap_pct)
    return dict(guarantor=gu.full_name, guarantor_card=guarantor.card_no, borrower=bu.full_name, borrower_card=borrower.card_no,
                loan_no=loan.loan_no, principal=naira(loan.principal_kobo), interest=naira(loan.interest_kobo),
                rate=f"{loan.rate_bps / 100:g}%", total=naira(loan.total_kobo), term=loan.term_months,
                amount=naira(g.amount_kobo), overdue_rate=f"{loan.overdue_daily_bps / 100:g}%",
                cap_text=f", capped at {cap}% of the original interest" if cap else " (no cap has been set)",
                guarantee_pct=f"{100 - int(rules.get('dividend_contribution_pct'))}%",
                contribution_pct=f"{rules.get('dividend_contribution_pct')}%",
                max_active=rules.get("guarantee_max_active"), min_funds_pct=rules.get("guarantor_min_funds_pct"))


async def open_invite(db: AsyncSession, rules: Rules, g: CoopGuarantee, user: User) -> dict:
    await sweep(db, rules)
    await db.flush()
    gm = await db.get(CoopMember, g.guarantor_id)
    if gm.user_id != user.id:
        raise CoopError("Not found", 404)
    loan = await db.get(CoopLoan, g.loan_id)
    bm = await db.get(CoopMember, loan.member_id)
    bu = await db.get(User, bm.user_id)
    if g.status == "invited":
        g.status, g.viewed_at = "viewed", rules.now()
    text_ = contract.render(contract_vars(rules, loan, g, gm, user, bm, bu)) if g.status in LIVE_INVITE or g.status == "signed" else None
    if g.status == "signed" and g.contract_text:
        text_ = g.contract_text
    free = await ledger.free_funds(db, gm.id)
    need_funds = max(g.amount_kobo, loan.principal_kobo * int(rules.get("guarantor_min_funds_pct")) // 100)
    return {"guarantee_id": str(g.id), "status": g.status, "amount_kobo": g.amount_kobo, "expires_at": g.expires_at.isoformat(),
            "loan": {"loan_no": loan.loan_no, "principal_kobo": loan.principal_kobo, "interest_kobo": loan.interest_kobo,
                     "term_months": loan.term_months, "status": loan.status, "purpose": loan.purpose},
            "borrower": {"member_id": str(bm.id), "name": bu.full_name, "card_no": bm.card_no},
            "contract_text": text_, "contract_version": contract.VERSION, "ticks": [{"key": k, "label": l} for k, l in contract.TICKS],
            "free_kobo": free, "needs_free_kobo": need_funds, "eligible": free >= need_funds}


async def sign(db: AsyncSession, rules: Rules, g: CoopGuarantee, user: User, ticks: dict, typed_name: str, ip: str, agent: str) -> CoopGuarantee:
    await sweep(db, rules)
    g = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.id == g.id).with_for_update())).scalars().one()
    gm = await db.get(CoopMember, g.guarantor_id)
    if gm.user_id != user.id:
        raise CoopError("Not found", 404)
    if g.status not in LIVE_INVITE:
        raise CoopError("This request is no longer open", 409)
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == g.loan_id).with_for_update())).scalars().one()
    if loan.status != "seeking_guarantors":
        raise CoopError("This loan is no longer looking for guarantors", 409)
    if not all(ticks.get(k) is True for k, _ in contract.TICKS):
        raise CoopError("Please tick every box to confirm you understand")
    if (typed_name or "").strip().lower() != user.full_name.strip().lower():
        raise CoopError("Type your full name exactly as it appears on your account")
    if await active_guarantee_count(db, gm.id) >= int(rules.get("guarantee_max_active")):
        raise CoopError(f"You can have at most {rules.get('guarantee_max_active')} active guarantees", 409)
    free = await ledger.free_funds(db, gm.id)
    need = max(g.amount_kobo, loan.principal_kobo * int(rules.get("guarantor_min_funds_pct")) // 100)
    if free < need:
        raise CoopError(f"You need {naira(need)} of free funds to sign. You have {naira(free)}.", 409, "insufficient_funds")
    bm = await db.get(CoopMember, loan.member_id)
    bu = await db.get(User, bm.user_id)
    cv = await contract.ensure_version(db)
    text_ = contract.render(contract_vars(rules, loan, g, gm, user, bm, bu))
    await ledger.post(db, rules, member_id=gm.id, ledger="locked", entry_type="lock", delta=g.amount_kobo,
                      reference=f"lock:{g.id}", loan_id=loan.id, guarantee_id=g.id, actor=user.id, note=f"Guarantee for {loan.loan_no}")
    g.status, g.signed_at, g.contract_version, g.contract_text = "signed", rules.now(), cv.version, text_
    g.contract_hash, g.ticks, g.sign_ip, g.sign_agent = contract.sha(text_), ticks, (ip or "")[:64], (agent or "")[:300]
    await audit.record(db, "guarantee", g.id, "signed", user.id, {"loan": loan.loan_no, "amount": g.amount_kobo, "hash": g.contract_hash})
    await db.flush()
    t = await guarantee_totals(db, loan)
    if t["still_needed"] <= 0:
        loan.status = "awaiting_approval"
        await audit.record(db, "loan", loan.id, "fully_guaranteed", None)
        await notify(db, bm.user_id, "Fully guaranteed", f"{loan.loan_no} now has all its guarantees and is with the directors for approval.", "/coop/loans")
    else:
        await notify(db, bm.user_id, "A guarantor signed", f"{user.full_name} guaranteed {naira(g.amount_kobo)} of {loan.loan_no}. {naira(t['still_needed'])} to go.", "/coop/loans")
    return g


async def decline(db: AsyncSession, rules: Rules, g: CoopGuarantee, user: User) -> None:
    gm = await db.get(CoopMember, g.guarantor_id)
    if gm.user_id != user.id:
        raise CoopError("Not found", 404)
    if g.status not in LIVE_INVITE:
        raise CoopError("This request is no longer open", 409)
    g.status = "declined"
    loan = await db.get(CoopLoan, g.loan_id)
    bm = await db.get(CoopMember, loan.member_id)
    await audit.record(db, "guarantee", g.id, "declined", user.id)
    await notify(db, bm.user_id, "Guarantor declined", f"{user.full_name} declined to guarantee {loan.loan_no}. You can invite someone else.", "/coop/loans")


async def cancel_loan(db: AsyncSession, rules: Rules, loan: CoopLoan, user: User) -> None:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan.id).with_for_update())).scalars().one()
    if loan.status not in ("seeking_guarantors", "awaiting_approval"):
        raise CoopError("Only a request that is not yet approved can be cancelled", 409)
    loan.status, loan.closed_at, loan.decision_note = "cancelled", rules.now(), "Cancelled by the borrower"
    await release_guarantees(db, rules, loan, "Loan cancelled by borrower")
    await audit.record(db, "loan", loan.id, "cancelled", user.id)


# ── director decisions ────────────────────────────────────────────────────
async def decide_loan(db: AsyncSession, rules: Rules, loan_id, director: User, decision: str, note: str | None) -> CoopLoan:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    if not loan:
        raise CoopError("Loan not found", 404)
    if loan.status != "awaiting_approval":
        raise CoopError("This loan is not waiting for approval", 409)
    if (await db.execute(select(CoopLoanApproval).where(CoopLoanApproval.loan_id == loan.id, CoopLoanApproval.director_id == director.id))).scalars().first():
        raise CoopError("You have already voted on this loan", 409)
    bm = await db.get(CoopMember, loan.member_id)
    if bm.user_id == director.id:
        raise CoopError("You cannot approve your own loan", 403)
    if decision == "reject" and not (note or "").strip():
        raise CoopError("Please give a reason for rejecting")
    db.add(CoopLoanApproval(loan_id=loan.id, director_id=director.id, decision=decision, note=(note or "")[:300] or None))
    await db.flush()
    await audit.record(db, "loan", loan.id, f"director_{decision}", director.id, {"note": note})
    if decision == "reject":
        loan.status, loan.closed_at, loan.decision_note = "rejected", rules.now(), (note or "")[:300]
        await release_guarantees(db, rules, loan, "Loan rejected by the Board")
        await notify(db, bm.user_id, "Loan not approved", f"{loan.loan_no} was not approved: {note}. Any guarantees were released.", "/coop/loans")
        return loan
    await db.flush()
    n = (await db.execute(select(func.count()).select_from(CoopLoanApproval).where(
        CoopLoanApproval.loan_id == loan.id, CoopLoanApproval.decision == "approve"))).scalar_one()
    if n >= loan.approvals_required:
        t = await guarantee_totals(db, loan)
        if t["still_needed"] > 0:
            raise CoopError("Guarantees no longer cover the loan", 409)
        start = rules.today()
        loan.status, loan.approved_at, loan.start_date = "repaying", rules.now(), start
        loan.due_date = logic.last_payment_day(start, loan.term_months)
        loan.schedule = logic.build_schedule(loan.principal_kobo, loan.interest_kobo, loan.term_months, start)
        await ledger.post(db, rules, member_id=loan.member_id, ledger="loan_out", entry_type="disbursed_test", delta=loan.principal_kobo,
                          reference=f"disb:{loan.id}", loan_id=loan.id, actor=director.id, note="TEST disbursement. No wallet credited")
        await audit.record(db, "loan", loan.id, "approved_and_disbursed", director.id, {"schedule": loan.schedule})
        await notify(db, bm.user_id, "Loan approved", f"{loan.loan_no} for {naira(loan.principal_kobo)} is approved (test money). First instalment: {naira(loan.schedule[0]['amount_kobo'])}.", "/coop/loans")
    return loan


# ── repayment ─────────────────────────────────────────────────────────────
def position(loan: CoopLoan, today) -> dict:
    """What is owed right now. Overdue charge is ACCRUED (not cash) until the borrower actually pays it."""
    days = logic.overdue_days(today, loan.due_date, loan.overdue_grace_days) if loan.status == "repaying" else 0
    accrued = logic.accrued_overdue_charge(loan.interest_kobo, loan.overdue_daily_bps, days, loan.overdue_cap_pct)
    charges_due = max(accrued - loan.charges_paid_kobo, 0)
    interest_due = loan.interest_kobo - loan.interest_paid_kobo
    principal_due = loan.principal_kobo - loan.principal_paid_kobo
    paid_total = loan.principal_paid_kobo + loan.interest_paid_kobo
    rows, left = [], paid_total
    for r in (loan.schedule or []):
        amt = r["amount_kobo"]
        got = min(left, amt)
        left -= got
        due = r["due_date"] < today.isoformat()
        st = "paid" if got >= amt else ("late" if due else "upcoming")
        rows.append({**r, "paid_kobo": got, "state": st})
    nxt = next((r for r in rows if r["state"] != "paid"), None)
    return {"overdue_days": days, "accrued_charge_kobo": accrued, "charges_due_kobo": charges_due, "charges_paid_kobo": loan.charges_paid_kobo,
            "interest_due_kobo": interest_due, "principal_due_kobo": principal_due,
            "total_due_kobo": charges_due + interest_due + principal_due, "overdue": days > 0, "schedule": rows, "next": nxt}


async def repay(db: AsyncSession, rules: Rules, loan_id, user: User, amount: int) -> dict:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    m = await member_of(db, user)
    if not loan or not m or loan.member_id != m.id:
        raise CoopError("Loan not found", 404)
    if loan.status != "repaying":
        raise CoopError("This loan is not being repaid", 409)
    await db.flush()
    pos = position(loan, rules.today())
    if amount <= 0:
        raise CoopError("Enter a valid amount")
    if amount > pos["total_due_kobo"]:
        raise CoopError(f"You owe {naira(pos['total_due_kobo'])} in total. You cannot pay more than that.", 409)
    a = logic.allocate_payment(amount, pos["charges_due_kobo"], pos["interest_due_kobo"], pos["principal_due_kobo"])
    rid = uuid.uuid4()
    for part, key, ledger_name in (("charges", "repay_charge", "pool_overdue"), ("interest", "repay_interest", None), ("principal", "repay_principal", None)):
        if a[part] > 0:
            await ledger.post(db, rules, member_id=m.id, ledger="loan_repaid", entry_type=key, delta=a[part],
                              reference=f"{key}:{rid}", loan_id=loan.id, actor=user.id, note="Repayment (test money)")
    if a["charges"] > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_overdue", entry_type="overdue_charge_received", delta=a["charges"],
                          reference=f"poolc:{rid}", loan_id=loan.id, actor=user.id, note=f"Overdue charge received on {loan.loan_no}")
    loan.charges_paid_kobo += a["charges"]
    loan.interest_paid_kobo += a["interest"]
    loan.principal_paid_kobo += a["principal"]
    if a["interest"] > 0:
        target_rc = logic.running_cost(loan.interest_paid_kobo, int(rules.get("running_cost_bps")))
        posted_rc = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
            CoopJournal.ledger == "running_cost", CoopJournal.loan_id == loan.id))).scalar_one())
        posted_pool = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
            CoopJournal.ledger == "pool_interest", CoopJournal.loan_id == loan.id))).scalar_one())
        d_rc = target_rc - posted_rc
        d_pool = (loan.interest_paid_kobo - target_rc) - posted_pool
        if d_rc > 0:
            await ledger.post(db, rules, member_id=None, ledger="running_cost", entry_type="running_cost", delta=d_rc,
                              reference=f"rc:{rid}", loan_id=loan.id, actor=user.id, note="Running cost on realised interest")
        if d_pool > 0:
            await ledger.post(db, rules, member_id=None, ledger="pool_interest", entry_type="interest_realised", delta=d_pool,
                              reference=f"pi:{rid}", loan_id=loan.id, actor=user.id, note="Realised interest to dividend pool")
    after = position(loan, rules.today())
    repaid = after["total_due_kobo"] == 0
    if repaid:
        loan.status, loan.closed_at = "repaid", rules.now()
        await release_guarantees(db, rules, loan, "Loan fully repaid")
        await notify(db, m.user_id, "Loan fully repaid", f"{loan.loan_no} is fully repaid. Guarantors' money has been released.", "/coop/loans")
        for g in (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id, CoopGuarantee.status == "released"))).scalars().all():
            gm = await db.get(CoopMember, g.guarantor_id)
            await notify(db, gm.user_id, "Guarantee released", f"{loan.loan_no} was fully repaid. Your {naira(g.amount_kobo)} is free again.", "/coop")
    await audit.record(db, "loan", loan.id, "repayment", user.id, {"amount": amount, **a})
    return {"applied": a, "repaid": repaid, "remaining_kobo": after["total_due_kobo"]}
