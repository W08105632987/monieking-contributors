"""Cooperative business operations (membership, loans, guarantees, repayments). Preview: test money only."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import audit, contract, ledger, logic, rail, safety
from app.coop.errors import CoopError
from app.coop.models import (CoopWithdrawal, CoopGuarantee, CoopLoan, CoopLoanApproval, CoopMember, CoopMemberBank, CoopPilotMember, CoopJournal,
                             CoopRequest)
from app.coop.settings_store import Rules
from app.models.user import User, UserRole

log = logging.getLogger(__name__)

# A loan's life: seeking_guarantors > awaiting_approval > awaiting_acceptance (borrower sees the offer)
# > awaiting_payout (Treasurer sends the money) > repaying > awaiting_final_release (directors confirm) > repaid
ACTIVE_LOAN = ("seeking_guarantors", "awaiting_approval", "awaiting_acceptance", "awaiting_payout", "repaying", "awaiting_final_release")
LOCKING = ("awaiting_approval", "awaiting_acceptance", "awaiting_payout", "repaying", "awaiting_final_release")
OWING = ("repaying", "awaiting_final_release")   # money has been paid out and the loan is not closed
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
    if m and m.status == "deceased_hold":
        raise CoopError("This membership is on hold. Please contact the directors.", 403, "on_hold")
    if m and m.status == "closed":
        raise CoopError("This membership is closed", 403, "closed")
    if not m or m.status != "active":
        raise CoopError("Join the cooperative first", 403, "not_member")
    return m


# ── membership ────────────────────────────────────────────────────────────
async def join(db: AsyncSession, rules: Rules, user: User, amount: int, nin_bypass: bool) -> CoopMember:
    if await member_of(db, user):
        raise CoopError("You are already a member", 409, "already_member")
    if amount < int(rules.get("registration_min_kobo")):
        raise CoopError(f"The minimum to join is {naira(int(rules.get('registration_min_kobo')))}")
    fee = int(rules.get("membership_fee_kobo")) if rules.get("membership_fee_timing") == "on_join" else 0
    if fee and amount < int(rules.get("registration_min_kobo")) + fee:
        raise CoopError(f"The membership fee of {naira(fee)} is taken at joining, so please pay at least {naira(int(rules.get('registration_min_kobo')) + fee)}")
    await safety.check_pilot_cap(db, rules, amount)
    bypass = False
    if rules.get("nin_required") and not user.nin_linked:
        if not nin_bypass:
            raise CoopError("Your NIN must be linked before you can join", 409, "nin_required")
        bypass = True  # preview only: recorded on the member so directors can see it
    n = (await db.execute(text("SELECT nextval('coop_card_seq')"))).scalar_one()
    m = CoopMember(user_id=user.id, card_no=f"MK-C {n:04d} {(n * 7 + 13) % 100:02d}", nin_bypassed=bypass)
    db.add(m)
    await db.flush()
    await rail.debit_member(db, rules, user.id, amount, f"join:{m.id}", "joining payment")
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="registration",
                      delta=amount, reference=f"join:{m.id}", actor=user.id, note="Registration")
    if fee:
        await take_membership_fee(db, rules, m, fee, user.id)
    await audit.record(db, "member", m.id, "joined", user.id, {"amount": amount, "nin_bypassed": bypass})
    return m


async def contribute(db: AsyncSession, rules: Rules, m: CoopMember, amount: int, actor) -> None:
    if amount <= 0 or amount > 10_000_000_000:
        raise CoopError("Enter a valid amount")
    await safety.check_pilot_cap(db, rules, amount)
    ref = uuid.uuid4()
    await rail.debit_member(db, rules, m.user_id, amount, f"contrib:{ref}", "contribution")
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="contribution",
                      delta=amount, reference=f"contrib:{ref}", actor=actor, note="Top-up")


async def owing_loans(db: AsyncSession, member_id) -> list[CoopLoan]:
    return list((await db.execute(select(CoopLoan).where(CoopLoan.member_id == member_id, CoopLoan.status.in_(ACTIVE_LOAN)))).scalars().all())


async def withdraw_limit(db: AsyncSession, rules: Rules, m: CoopMember) -> dict:
    """How much can leave right now, and why not more."""
    free = await ledger.free_funds(db, m.id)
    mode = rules.get("withdraw_while_borrowing")
    ls = await owing_loans(db, m.id)
    reason = None
    limit = free
    if ls and mode == "block":
        limit, reason = 0, "You have a loan, so withdrawals are paused until it is repaid and closed."
    elif ls and mode == "keep_cover":
        need = sum(position(l, rules.today())["total_due_kobo"] for l in ls if l.status in OWING) + \
               sum(l.principal_kobo + l.interest_kobo for l in ls if l.status not in OWING)
        limit = max(free - need, 0)
        reason = f"While your loan runs, {naira(min(free, need))} of your free money is kept back to cover it."
    return {"free_kobo": free, "limit_kobo": max(limit, 0), "reason": reason, "mode": mode}


async def withdraw_preview(db: AsyncSession, rules: Rules, m: CoopMember, amount: int) -> dict:
    if amount <= 0:
        raise CoopError("Enter a valid amount")
    wl = await withdraw_limit(db, rules, m)
    free = wl["free_kobo"]
    if amount > free:
        raise CoopError(f"You can withdraw at most {naira(free)}. The rest is locked behind guarantees.", 409, "locked")
    if amount > wl["limit_kobo"]:
        raise CoopError(wl["reason"] or "That amount is not available to withdraw", 409, "loan_block")
    bps = int(rules.get("early_withdrawal_bps"))
    charge = amount * bps // 10000
    return {"amount_kobo": amount, "charge_kobo": charge, "you_receive_kobo": amount - charge, "charge_bps": bps,
            "loses_dividend": charge > 0, "free_kobo": free, "limit_kobo": wl["limit_kobo"]}


async def withdraw(db: AsyncSession, rules: Rules, m: CoopMember, amount: int, actor) -> dict:
    pv = await withdraw_preview(db, rules, m, amount)
    ref = uuid.uuid4()
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="withdrawal",
                      delta=-amount, reference=f"wd:{ref}", actor=actor, note="Withdrawal")
    if pv["charge_kobo"] > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_withdrawal", entry_type="withdrawal_charge",
                          delta=pv["charge_kobo"], reference=f"wdc:{ref}", actor=actor, note=f"Early withdrawal charge from {m.card_no}")
        m.disqualified_year = logic.accounting_year(rules.today())
    await rail.credit_member(db, rules, m.user_id, pv["you_receive_kobo"], f"wd:{ref}", "withdrawal", actor)
    await audit.record(db, "member", m.id, "withdrawal", actor, pv)
    return pv


# ── withdrawal requests paid by a director ───────────────────────────────
def withdraw_is_request(rules: Rules) -> bool:
    return rules.get("withdraw_mode") == "director_payout"


def _bank_snapshot(b: CoopMemberBank) -> dict:
    return {"bank_code": b.bank_code, "bank_name": b.bank_name, "account_number": b.account_number,
            "account_name": b.account_name, "name_match": b.name_match}


async def request_withdrawal(db: AsyncSession, rules: Rules, m: CoopMember, amount: int, actor) -> CoopWithdrawal:
    """Hold the money now; a director sends it to the member's bank and records it (or rejects, and the money goes back)."""
    b = await db.get(CoopMemberBank, m.id)
    if b is None:
        raise CoopError("Add your bank account first, so we know where to send the money.", 409, "no_bank")
    pv = await withdraw_preview(db, rules, m, amount)
    w = CoopWithdrawal(member_id=m.id, amount_kobo=amount, charge_kobo=pv["charge_kobo"], net_kobo=pv["you_receive_kobo"],
                       charge_bps=pv["charge_bps"], status="pending", payout_account=_bank_snapshot(b))
    if not b.name_match and rules.get("payout_name_match") == "hold":
        w.hold_reason = "The bank account name does not match the member's name. A director must clear it."
    db.add(w)
    await db.flush()
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="withdrawal", delta=-amount,
                      reference=f"wdr:{w.id}", actor=actor, note="Withdrawal requested")
    await ledger.post(db, rules, member_id=m.id, ledger="withdrawal_pending", entry_type="withdrawal_hold", delta=amount,
                      reference=f"wdh:{w.id}", actor=actor, note="Held until a director pays it")
    await audit.record(db, "withdrawal", w.id, "requested", actor, pv)
    u = await db.get(User, m.user_id)
    await notify_directors(db, rules, "Withdrawal to pay",
                           f"{u.full_name if u else m.card_no} asked to withdraw {naira(amount)}. Send {naira(w.net_kobo)} to their bank account, then mark it paid.",
                           "/director/coop", only_treasurer=True)
    return w


async def _locked_withdrawal(db: AsyncSession, wid) -> CoopWithdrawal:
    w = (await db.execute(select(CoopWithdrawal).where(CoopWithdrawal.id == wid).with_for_update())).scalars().first()
    if not w:
        raise CoopError("Withdrawal not found", 404)
    if w.status != "pending":
        raise CoopError(f"This withdrawal is already {w.status}", 409)
    return w


async def pay_withdrawal(db: AsyncSession, rules: Rules, wid, director: User, reference: str | None, evidence: str | None) -> CoopWithdrawal:
    w = await _locked_withdrawal(db, wid)
    if w.hold_reason:
        raise CoopError(w.hold_reason, 409, "payout_held")
    if rules.get("payout_executor") == "treasurer" and str(director.id) != rules.get("treasurer_user_id"):
        raise CoopError("Only the director with treasurer duty can send payouts", 403, "not_treasurer")
    if rules.get("payout_evidence_required") and not ((reference or "").strip() and (evidence or "").strip()):
        raise CoopError("Enter the bank transfer reference and the receipt link or note")
    m = await db.get(CoopMember, w.member_id)
    await ledger.post(db, rules, member_id=m.id, ledger="withdrawal_pending", entry_type="withdrawal_paid", delta=-w.amount_kobo,
                      reference=f"wdp:{w.id}", actor=director.id, note="Withdrawal paid")
    if w.charge_kobo > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_withdrawal", entry_type="withdrawal_charge", delta=w.charge_kobo,
                          reference=f"wdc:{w.id}", actor=director.id, note=f"Early withdrawal charge from {m.card_no}")
        m.disqualified_year = logic.accounting_year(rules.today())
    w.status, w.decided_by, w.decided_at = "paid", director.id, rules.now()
    w.reference, w.evidence = (reference or "").strip()[:120] or None, (evidence or "").strip() or None
    await audit.record(db, "withdrawal", w.id, "paid", director.id, {"net": w.net_kobo, "charge": w.charge_kobo, "ref": w.reference})
    await notify(db, m.user_id, "Your withdrawal has been paid", f"{naira(w.net_kobo)} has been sent to your bank account.", "/coop/withdrawals")
    return w


async def _return_withdrawal(db: AsyncSession, rules: Rules, w: CoopWithdrawal, m: CoopMember, actor, note: str) -> None:
    await ledger.post(db, rules, member_id=m.id, ledger="withdrawal_pending", entry_type="withdrawal_released", delta=-w.amount_kobo,
                      reference=f"wdr-:{w.id}", actor=actor, note=note)
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="withdrawal_returned", delta=w.amount_kobo,
                      reference=f"wdb:{w.id}", actor=actor, note=note)


async def reject_withdrawal(db: AsyncSession, rules: Rules, wid, director: User, reason: str) -> CoopWithdrawal:
    if not (reason or "").strip():
        raise CoopError("Please say why you are rejecting it. The member will see this.")
    w = await _locked_withdrawal(db, wid)
    m = await db.get(CoopMember, w.member_id)
    await _return_withdrawal(db, rules, w, m, director.id, "Withdrawal rejected: money returned")
    w.status, w.decided_by, w.decided_at, w.reason = "rejected", director.id, rules.now(), reason.strip()
    await audit.record(db, "withdrawal", w.id, "rejected", director.id, {"reason": w.reason})
    await notify(db, m.user_id, "Your withdrawal was not paid", f"{naira(w.amount_kobo)} is back in your contribution. Reason: {w.reason}", "/coop/withdrawals")
    return w


async def cancel_withdrawal(db: AsyncSession, rules: Rules, wid, user: User) -> CoopWithdrawal:
    m = await member_of(db, user)
    w = await _locked_withdrawal(db, wid)
    if not m or w.member_id != m.id:
        raise CoopError("Withdrawal not found", 404)
    await _return_withdrawal(db, rules, w, m, user.id, "Withdrawal cancelled by the member: money returned")
    w.status, w.decided_by, w.decided_at, w.reason = "cancelled", user.id, rules.now(), "Cancelled by the member"
    await audit.record(db, "withdrawal", w.id, "cancelled", user.id)
    return w


async def clear_withdrawal_hold(db: AsyncSession, rules: Rules, wid, director: User, note: str) -> CoopWithdrawal:
    w = await _locked_withdrawal(db, wid)
    if not w.hold_reason:
        raise CoopError("This withdrawal is not on hold", 409)
    if not (note or "").strip():
        raise CoopError("Please say why the name mismatch is acceptable")
    w.hold_reason = None
    await audit.record(db, "withdrawal", w.id, "hold_cleared", director.id, {"note": note})
    return w


def withdrawal_view(w: CoopWithdrawal, member_name: str | None = None, card_no: str | None = None, phone: str | None = None, for_director: bool = False) -> dict:
    out = {"id": str(w.id), "amount_kobo": w.amount_kobo, "charge_kobo": w.charge_kobo, "net_kobo": w.net_kobo, "status": w.status,
           "created_at": w.created_at.isoformat(), "decided_at": w.decided_at.isoformat() if w.decided_at else None,
           "reason": w.reason, "reference": w.reference,
           "account": {k: (w.payout_account or {}).get(k) for k in ("bank_name", "account_number", "account_name")} if w.payout_account else None}
    if for_director:
        out.update({"member": member_name, "card_no": card_no, "phone": phone, "hold_reason": w.hold_reason, "evidence": w.evidence,
                    "name_match": (w.payout_account or {}).get("name_match"), "bank_code": (w.payout_account or {}).get("bank_code")})
    return out


async def close_preview(db: AsyncSession, rules: Rules, m: CoopMember) -> dict:
    """What closing the membership would do, or why it cannot be done yet."""
    bal = await ledger.balance(db, m.id, "contribution")
    locked = await ledger.balance(db, m.id, "locked")
    blockers = []
    if await owing_loans(db, m.id):
        blockers.append("You have a loan that is not closed yet.")
    if locked > 0:
        blockers.append(f"{naira(locked)} of your money is locked behind guarantees you gave.")
    from app.coop.models import CoopGuarantee as G
    live = (await db.execute(select(func.count()).select_from(G).where(G.guarantor_id == m.id, G.status.in_(LIVE_INVITE)))).scalar_one()
    if live:
        blockers.append("You have guarantor requests that are still open. Decline them first.")
    pending = (await db.execute(select(func.count()).select_from(CoopRequest).where(
        CoopRequest.member_id == m.id, CoopRequest.status == "pending"))).scalar_one()
    if pending:
        blockers.append("A request about your membership is still waiting for the directors.")
    bps = int(rules.get("closure_charge_bps"))
    charge = bal * bps // 10000
    return {"balance_kobo": bal, "charge_bps": bps, "charge_kobo": charge, "you_receive_kobo": bal - charge,
            "can_close": not blockers, "blockers": blockers, "charge_goes_to": rules.get("closure_charge_destination")}


async def close_membership(db: AsyncSession, rules: Rules, m: CoopMember, actor) -> dict:
    pv = await close_preview(db, rules, m)
    if not pv["can_close"]:
        raise CoopError(" ".join(pv["blockers"]), 409, "cannot_close")
    ref = uuid.uuid4()
    if pv["balance_kobo"] > 0:
        await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="closure_payout", delta=-pv["balance_kobo"],
                          reference=f"close:{ref}", actor=actor, note="Membership closed: balance paid out")
        if pv["charge_kobo"] > 0:
            dest = pv["charge_goes_to"]
            await ledger.post(db, rules, member_id=None, ledger=dest, entry_type="closure_charge", delta=pv["charge_kobo"],
                              reference=f"closec:{ref}", actor=actor, note=f"Closing charge from {m.card_no}")
        await rail.credit_member(db, rules, m.user_id, pv["you_receive_kobo"], f"close:{ref}", "membership closed", actor)
    m.status, m.closed_at, m.pool_listed = "closed", rules.now(), False
    await audit.record(db, "member", m.id, "membership_closed", actor, pv)
    return pv


async def take_membership_fee(db: AsyncSession, rules: Rules, m: CoopMember, fee: int, actor) -> bool:
    """One-time fee, from the contribution balance, only when the full amount is free. Goes to running costs."""
    if m.fee_paid_at or fee <= 0:
        return False
    if await ledger.free_funds(db, m.id) < fee:
        return False
    await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="membership_fee", delta=-fee,
                      reference=f"fee:{m.id}", actor=actor, note="One-time membership fee")
    await ledger.post(db, rules, member_id=None, ledger="running_cost", entry_type="membership_fee", delta=fee,
                      reference=f"feer:{m.id}", actor=actor, note=f"Membership fee from {m.card_no}")
    m.fee_paid_at = rules.now()
    return True


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
    offers = (await db.execute(select(CoopLoan).where(CoopLoan.status == "awaiting_acceptance", CoopLoan.offer_expires_at < now).with_for_update())).scalars().all()
    for l in offers:
        l.status, l.closed_at, l.decision_note = "expired", now, "The offer was not accepted in time"
        await release_guarantees(db, rules, l, "Loan offer expired")
        await audit.record(db, "loan", l.id, "offer_expired", None)
        mem = await db.get(CoopMember, l.member_id)
        await notify(db, mem.user_id, "Loan offer expired", f"The offer for {l.loan_no} was not accepted in time. Nothing was charged.", "/coop/loans")
    await db.flush()


# ── loans ─────────────────────────────────────────────────────────────────
def transfer_fee(rules: Rules, principal: int) -> int:
    """The payout fee the borrower sees in the offer. Zero when the cooperative absorbs it."""
    if rules.get("transfer_fee_payer") != "borrower":
        return 0
    return principal * int(rules.get("transfer_fee_bps")) // 10000


def instalment_preview(principal: int, term: int, rate_bps: int, start) -> dict:
    interest = logic.interest_for(principal, rate_bps)
    sched = logic.build_schedule(principal, interest, term, start)
    return {"interest_kobo": interest, "total_kobo": principal + interest, "schedule": sched,
            "instalment_kobo": sched[0]["amount_kobo"]}


async def create_loan(db: AsyncSession, rules: Rules, m: CoopMember, user: User, amount: int, term: int, purpose: str | None) -> CoopLoan:
    if user.role != UserRole.CUSTOMER:
        raise CoopError("Directors and officers cannot borrow", 403)
    await sweep(db, rules)
    if (await db.execute(select(func.count()).select_from(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status == "written_off"))).scalar_one():
        raise CoopError("A loan of yours was written off, so new loans are not available", 403, "written_off")
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
    fee = transfer_fee(rules, amount)
    n = (await db.execute(text("SELECT nextval('coop_loan_seq')"))).scalar_one()
    loan = CoopLoan(loan_no=f"L-{n:04d}", member_id=m.id, purpose=(purpose or "").strip()[:200] or None, principal_kobo=amount,
                    term_months=term, rate_bps=rate, interest_kobo=pv["interest_kobo"], total_kobo=pv["total_kobo"],
                    overdue_daily_bps=int(rules.get("overdue_daily_bps")), overdue_cap_pct=int(rules.get("overdue_cap_pct")),
                    overdue_grace_days=int(rules.get("overdue_grace_days")), cover_pct=int(rules.get("cover_pct")),
                    approvals_required=int(rules.get("approvals_loan")), schedule=[], flags=flags, status="seeking_guarantors",
                    offer_fee_kobo=fee, net_payout_kobo=amount - fee, repay_source=rules.get("repay_source"),
                    final_due_rule=rules.get("final_due_rule"), clock_rule=rules.get("loan_clock_starts"),
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
                                    CoopLoan.status.in_(LOCKING)))).scalar_one()


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
    from app.coop import insights
    bs = await insights.stats(db, rules, bm)
    free = await ledger.free_funds(db, gm.id)
    need_funds = max(g.amount_kobo, loan.principal_kobo * int(rules.get("guarantor_min_funds_pct")) // 100)
    return {"guarantee_id": str(g.id), "status": g.status, "amount_kobo": g.amount_kobo, "expires_at": g.expires_at.isoformat(),
            "loan": {"loan_no": loan.loan_no, "principal_kobo": loan.principal_kobo, "interest_kobo": loan.interest_kobo,
                     "term_months": loan.term_months, "status": loan.status, "purpose": loan.purpose},
            "borrower": {"member_id": str(bm.id), "name": bu.full_name, "card_no": bm.card_no, "avatar_url": bu.avatar_url,
                         "reliability_pct": bs["reliability_pct"], "has_history": bs["has_history"], "loans_taken": bs["loans_taken"],
                         "loans_repaid": bs["loans_repaid"], "months_member": bs["months_member"]},
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
async def notify_directors(db: AsyncSession, rules: Rules, title: str, body: str, link: str = "/director/coop", only_treasurer: bool = False) -> None:
    ids = []
    tid = rules.get("treasurer_user_id")
    if only_treasurer and tid and rules.get("payout_executor") == "treasurer":
        ids = [uuid.UUID(tid)]
    else:
        ids = [u for (u,) in (await db.execute(select(User.id).where(User.role == UserRole.DIRECTOR))).all()]
    for uid in ids:
        await notify(db, uid, title, body, link)


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
        loan.approved_at = rules.now()
        if rules.get("loan_offer_required"):
            loan.status = "awaiting_acceptance"
            loan.offer_expires_at = rules.now() + timedelta(hours=int(rules.get("loan_offer_expiry_hours")))
            await audit.record(db, "loan", loan.id, "approved_offer_sent", director.id, {"net_payout_kobo": loan.net_payout_kobo, "fee_kobo": loan.offer_fee_kobo})
            await notify(db, bm.user_id, "Loan approved: please accept",
                         f"{loan.loan_no} is approved. You will receive {naira(loan.net_payout_kobo)}. Open the offer and accept it to continue.", "/coop/loans")
        else:
            await queue_payout(db, rules, loan, bm)
    return loan


# ── offer, payout queue, payout ───────────────────────────────────────────
def offer_view(loan: CoopLoan) -> dict:
    return {"principal_kobo": loan.principal_kobo, "fee_kobo": loan.offer_fee_kobo, "net_payout_kobo": loan.net_payout_kobo,
            "interest_kobo": loan.interest_kobo, "total_repay_kobo": loan.total_kobo, "term_months": loan.term_months,
            "rate_bps": loan.rate_bps, "expires_at": loan.offer_expires_at.isoformat() if loan.offer_expires_at else None,
            "repay_source": loan.repay_source, "clock_rule": loan.clock_rule}


async def queue_payout(db: AsyncSession, rules: Rules, loan: CoopLoan, m: CoopMember) -> None:
    """Put an accepted loan in the Treasurer's queue, held if the bank details are missing or do not match."""
    loan.status, loan.payout_status, loan.payout_hold_reason = "awaiting_payout", "pending", None
    if rules.get("payout_mode") == "treasurer_manual":
        b = await db.get(CoopMemberBank, m.id)
        _evaluate_hold(rules, loan, b)
        if b:
            loan.payout_account = {"bank_code": b.bank_code, "bank_name": b.bank_name, "account_number": b.account_number,
                                   "account_name": b.account_name, "name_match": b.name_match}
    await audit.record(db, "loan", loan.id, "payout_queued", None, {"status": loan.payout_status, "hold": loan.payout_hold_reason})
    await notify_directors(db, rules, "Loan ready for payout", f"{loan.loan_no}: send {naira(loan.net_payout_kobo)}.", only_treasurer=True)


def _evaluate_hold(rules: Rules, loan: CoopLoan, b: CoopMemberBank | None) -> None:
    if b is None:
        loan.payout_status, loan.payout_hold_reason = "held", "The borrower has not added bank details yet"
    elif not b.name_match and rules.get("payout_name_match") == "hold":
        loan.payout_status, loan.payout_hold_reason = "held", "The bank account name does not match the member's name. A director must clear it."
    else:
        loan.payout_status, loan.payout_hold_reason = "pending", None


async def refresh_payout_hold(db: AsyncSession, loan: CoopLoan, m: CoopMember, b: CoopMemberBank | None) -> None:
    from app.coop import settings_store
    rules = await settings_store.load_rules(db)
    if loan.status != "awaiting_payout" or loan.payout_status == "cleared":
        return
    _evaluate_hold(rules, loan, b)
    if b:
        loan.payout_account = {"bank_code": b.bank_code, "bank_name": b.bank_name, "account_number": b.account_number,
                               "account_name": b.account_name, "name_match": b.name_match}


async def clear_hold(db: AsyncSession, rules: Rules, loan_id, director: User, note: str) -> CoopLoan:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    if not loan or loan.status != "awaiting_payout":
        raise CoopError("This loan is not waiting for payout", 409)
    if loan.payout_status != "held":
        raise CoopError("This payout is not on hold", 409)
    if not loan.payout_account:
        raise CoopError("There are no bank details to clear yet", 409)
    if not (note or "").strip():
        raise CoopError("Please say why the name mismatch is acceptable")
    loan.payout_status, loan.payout_hold_reason = "cleared", None
    await audit.record(db, "loan", loan.id, "payout_hold_cleared", director.id, {"note": note})
    return loan


async def accept_offer(db: AsyncSession, rules: Rules, loan_id, user: User) -> CoopLoan:
    await sweep(db, rules)
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    m = await member_of(db, user)
    if not loan or not m or loan.member_id != m.id:
        raise CoopError("Loan not found", 404)
    if loan.status != "awaiting_acceptance":
        raise CoopError("There is no offer to accept on this loan", 409)
    loan.accepted_at = rules.now()
    await audit.record(db, "loan", loan.id, "offer_accepted", user.id, offer_view(loan))
    await queue_payout(db, rules, loan, m)
    return loan


async def decline_offer(db: AsyncSession, rules: Rules, loan_id, user: User) -> CoopLoan:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    m = await member_of(db, user)
    if not loan or not m or loan.member_id != m.id:
        raise CoopError("Loan not found", 404)
    if loan.status != "awaiting_acceptance":
        raise CoopError("There is no offer to decline on this loan", 409)
    loan.status, loan.closed_at, loan.decision_note = "declined", rules.now(), "The borrower declined the offer"
    await release_guarantees(db, rules, loan, "Borrower declined the offer")
    await audit.record(db, "loan", loan.id, "offer_declined", user.id)
    return loan


def due_for(start, term: int, rule: str):
    d = logic.add_months(start, term)
    return d if rule == "after_final_due_date" else d - timedelta(days=1)


async def confirm_payout(db: AsyncSession, rules: Rules, loan_id, director: User, reference: str | None, evidence: str | None) -> CoopLoan:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    if not loan:
        raise CoopError("Loan not found", 404)
    if loan.status != "awaiting_payout":
        raise CoopError("This loan is not waiting for payout", 409)
    if loan.payout_status == "held":
        raise CoopError(loan.payout_hold_reason or "This payout is on hold", 409, "payout_held")
    exec_mode, tid = rules.get("payout_executor"), rules.get("treasurer_user_id")
    if exec_mode == "treasurer" and str(director.id) != tid:
        raise CoopError("Only the director with treasurer duty can send payouts", 403, "not_treasurer")
    if rules.get("payout_executor_not_approver"):
        if (await db.execute(select(CoopLoanApproval).where(CoopLoanApproval.loan_id == loan.id, CoopLoanApproval.director_id == director.id,
                                                          CoopLoanApproval.decision == "approve"))).scalars().first():
            raise CoopError("A director who approved this loan cannot also send the payout", 403, "segregation")
    manual = rules.get("payout_mode") == "treasurer_manual"
    if manual and rules.get("payout_evidence_required") and not ((reference or "").strip() and (evidence or "").strip()):
        raise CoopError("Enter the bank transfer reference and the receipt link or note")
    bm = await db.get(CoopMember, loan.member_id)
    now = rules.now()
    start = now.date() if loan.clock_rule == "payout" else (loan.approved_at or now).date()
    loan.start_date = start
    loan.due_date = due_for(start, loan.term_months, loan.final_due_rule)
    loan.schedule = logic.build_schedule(loan.principal_kobo, loan.interest_kobo, loan.term_months, start)
    await ledger.post(db, rules, member_id=loan.member_id, ledger="loan_out", entry_type="disbursed", delta=loan.principal_kobo,
                      reference=f"disb:{loan.id}", loan_id=loan.id, actor=director.id, note="Loan paid out")
    if loan.offer_fee_kobo > 0:
        await ledger.post(db, rules, member_id=None, ledger="operating", entry_type="transfer_fee", delta=loan.offer_fee_kobo,
                          reference=f"tfee:{loan.id}", loan_id=loan.id, actor=director.id, note=f"Transfer fee on {loan.loan_no}")
    if not manual:
        await rail.credit_member(db, rules, bm.user_id, loan.net_payout_kobo, f"payout:{loan.id}", f"loan {loan.loan_no}", director.id)
    loan.status, loan.payout_status, loan.paid_out_at, loan.payout_by = "repaying", "paid", now, director.id
    loan.payout_ref, loan.payout_evidence = (reference or "").strip()[:120] or None, (evidence or "").strip() or None
    await audit.record(db, "loan", loan.id, "paid_out", director.id, {"net": loan.net_payout_kobo, "fee": loan.offer_fee_kobo, "ref": loan.payout_ref,
                                                                     "start": start.isoformat(), "due": loan.due_date.isoformat()})
    await notify(db, bm.user_id, "Your loan has been paid out",
                 f"{naira(loan.net_payout_kobo)} for {loan.loan_no} has been sent. First instalment: {naira(loan.schedule[0]['amount_kobo'])} on {loan.schedule[0]['due_date']}.", "/coop/loans")
    return loan


# ── repayment ─────────────────────────────────────────────────────────────
def position(loan: CoopLoan, today) -> dict:
    """What is owed right now. Overdue charge is ACCRUED (not cash) until the borrower actually pays it."""
    days = logic.overdue_days(today, loan.due_date, loan.overdue_grace_days) if loan.status in OWING else 0
    accrued = logic.accrued_overdue_charge(loan.interest_kobo, loan.overdue_daily_bps, days, loan.overdue_cap_pct)
    charges_due = max(accrued - loan.waived_kobo - loan.charges_paid_kobo, 0)
    interest_due = loan.interest_kobo - loan.interest_paid_kobo
    principal_due = loan.principal_kobo - loan.principal_paid_kobo
    if loan.status in ("repaid", "written_off"):
        interest_due = principal_due = 0
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
    scheduled_through_today = sum(r["amount_kobo"] for r in (loan.schedule or []) if r["due_date"] <= today.isoformat())
    due_now = max(scheduled_through_today - paid_total, 0) + charges_due
    return {"overdue_days": days, "accrued_charge_kobo": accrued, "charges_due_kobo": charges_due, "charges_paid_kobo": loan.charges_paid_kobo,
            "waived_kobo": loan.waived_kobo, "interest_due_kobo": interest_due, "principal_due_kobo": principal_due,
            "total_due_kobo": charges_due + interest_due + principal_due, "due_now_kobo": min(due_now, charges_due + interest_due + principal_due),
            "overdue": days > 0, "schedule": rows, "next": nxt}


def allowed_sources(loan: CoopLoan) -> list[str]:
    return {"contribution_auto": ["contribution"], "wallet_manual": ["wallet"], "member_choice": ["contribution", "wallet"]}.get(loan.repay_source, ["contribution"])


async def _apply_repayment(db: AsyncSession, rules: Rules, loan: CoopLoan, m: CoopMember, amount: int, source: str, actor, rid: str, note: str) -> dict:
    await db.flush()
    pos = position(loan, rules.today())
    a = logic.allocate_payment(amount, pos["charges_due_kobo"], pos["interest_due_kobo"], pos["principal_due_kobo"])
    if a["excess"] > 0:
        raise CoopError("That is more than is owed", 409)
    if source == "contribution":
        await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="loan_repayment", delta=-amount,
                          reference=f"loanrep:{rid}", loan_id=loan.id, actor=actor, note=f"{note} ({loan.loan_no})")
    else:
        await rail.debit_member(db, rules, m.user_id, amount, f"repay:{rid}", f"repayment of {loan.loan_no}")
    for part, key in (("charges", "repay_charge"), ("interest", "repay_interest"), ("principal", "repay_principal")):
        if a[part] > 0:
            await ledger.post(db, rules, member_id=m.id, ledger="loan_repaid", entry_type=key, delta=a[part],
                              reference=f"{key}:{rid}", loan_id=loan.id, actor=actor, note=f"{note} from {source}")
    if a["charges"] > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_overdue", entry_type="overdue_charge_received", delta=a["charges"],
                          reference=f"poolc:{rid}", loan_id=loan.id, actor=actor, note=f"Overdue charge received on {loan.loan_no}")
    loan.charges_paid_kobo += a["charges"]
    loan.interest_paid_kobo += a["interest"]
    loan.principal_paid_kobo += a["principal"]
    if a["interest"] > 0:
        target_rc = logic.running_cost(loan.interest_paid_kobo, int(rules.get("running_cost_bps")))
        posted_rc = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
            CoopJournal.ledger == "running_cost", CoopJournal.loan_id == loan.id, CoopJournal.entry_type == "running_cost"))).scalar_one())
        posted_pool = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
            CoopJournal.ledger == "pool_interest", CoopJournal.loan_id == loan.id, CoopJournal.entry_type == "interest_realised"))).scalar_one())
        d_rc = target_rc - posted_rc
        d_pool = (loan.interest_paid_kobo - target_rc) - posted_pool
        if d_rc > 0:
            await ledger.post(db, rules, member_id=None, ledger="running_cost", entry_type="running_cost", delta=d_rc,
                              reference=f"rc:{rid}", loan_id=loan.id, actor=actor, note="Running cost on realised interest")
        if d_pool > 0:
            await ledger.post(db, rules, member_id=None, ledger="pool_interest", entry_type="interest_realised", delta=d_pool,
                              reference=f"pi:{rid}", loan_id=loan.id, actor=actor, note="Realised interest to dividend pool")
    after = position(loan, rules.today())
    repaid = after["total_due_kobo"] == 0
    if repaid:
        await _fully_repaid(db, rules, loan, m)
    await audit.record(db, "loan", loan.id, "repayment", actor, {"amount": amount, "source": source, **a})
    return {"applied": a, "repaid": repaid, "remaining_kobo": after["total_due_kobo"], "source": source}


async def _fully_repaid(db: AsyncSession, rules: Rules, loan: CoopLoan, m: CoopMember) -> None:
    loan.closed_at = rules.now()
    if rules.get("final_release_mode") == "automatic":
        await close_repaid(db, rules, loan)
        return
    loan.status = "awaiting_final_release"
    from app.coop import approvals
    await approvals.open_request(db, rules, kind="final_release", actor=None, member_id=m.id, loan_id=loan.id, amount=loan.principal_kobo,
                                 reason=f"{loan.loan_no} is fully repaid. Confirm so the guarantors' money is released.")
    await notify(db, m.user_id, "Loan fully repaid", f"{loan.loan_no} is fully repaid. The directors will now confirm and release your guarantors' money.", "/coop/loans")
    await notify_directors(db, rules, "Confirm a final repayment", f"{loan.loan_no} is fully repaid. Guarantors are waiting for release.")


async def close_repaid(db: AsyncSession, rules: Rules, loan: CoopLoan) -> None:
    loan.status = "repaid"
    loan.closed_at = loan.closed_at or rules.now()
    await release_guarantees(db, rules, loan, "Loan fully repaid")
    from app.coop.models import CoopCase
    for c in (await db.execute(select(CoopCase).where(CoopCase.loan_id == loan.id, CoopCase.kind == "recovery", CoopCase.status != "closed"))).scalars().all():
        c.status, c.closed_at, c.resolution = "closed", rules.now(), "Loan repaid in full"
    m = await db.get(CoopMember, loan.member_id)
    await notify(db, m.user_id, "Loan closed", f"{loan.loan_no} is closed. Guarantors' money has been released.", "/coop/loans")
    for g in (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id, CoopGuarantee.status == "released"))).scalars().all():
        gm = await db.get(CoopMember, g.guarantor_id)
        await notify(db, gm.user_id, "Guarantee released", f"{loan.loan_no} was fully repaid. Your {naira(g.amount_kobo)} is free again.", "/coop")


async def repay(db: AsyncSession, rules: Rules, loan_id, user: User, amount: int, source: str | None = None) -> dict:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == loan_id).with_for_update())).scalars().first()
    m = await member_of(db, user)
    if not loan or not m or loan.member_id != m.id:
        raise CoopError("Loan not found", 404)
    if loan.status != "repaying":
        raise CoopError("This loan is not being repaid", 409)
    src = source or allowed_sources(loan)[0]
    if src not in allowed_sources(loan):
        raise CoopError("Repayments on this loan are taken from " + " or ".join(allowed_sources(loan)) + ". Choose that instead.", 409, "bad_source")
    await db.flush()
    pos = position(loan, rules.today())
    if amount <= 0:
        raise CoopError("Enter a valid amount")
    if amount > pos["total_due_kobo"]:
        raise CoopError(f"You owe {naira(pos['total_due_kobo'])} in total. You cannot pay more than that.", 409)
    if src == "contribution":
        free = await ledger.free_funds(db, m.id)
        if amount > free:
            raise CoopError(f"Your free contribution balance is {naira(free)}. Money locked behind guarantees you gave is never used.", 409, "insufficient_free")
    return await _apply_repayment(db, rules, loan, m, amount, src, user.id, str(uuid.uuid4()), "Repayment")


async def auto_deduct(db: AsyncSession, rules: Rules, today=None) -> dict:
    """Take due instalments (and overdue charges) from members' FREE contribution balance. Safe to run any number of times a day."""
    today = today or rules.today()
    done = short = 0
    loans = (await db.execute(select(CoopLoan).where(CoopLoan.status == "repaying", CoopLoan.repay_source == "contribution_auto").with_for_update())).scalars().all()
    for loan in loans:
        m = await db.get(CoopMember, loan.member_id)
        if not m or m.status != "active":
            continue
        await db.flush()
        due = position(loan, today)["due_now_kobo"]
        if due <= 0:
            continue
        free = await ledger.free_funds(db, m.id)
        take = min(due, free) if rules.get("auto_deduct_partial") else (due if free >= due else 0)
        if take <= 0:
            short += 1
            key = f"short:{loan.id}:{today.isoformat()}"
            if await _once(db, key):
                await notify(db, m.user_id, "Instalment not paid", f"{naira(due)} is due on {loan.loan_no} but your free balance is {naira(free)}. Add money to avoid overdue charges.", "/coop/loans")
            continue
        rid = f"auto:{loan.id}:{today.isoformat()}"
        if (await db.execute(select(CoopJournal.id).where(CoopJournal.reference == f"loanrep:{rid}"))).first():
            take = min(take, due)  # already ran today: only take what is still due
            rid = f"{rid}:{uuid.uuid4().hex[:6]}"
        res = await _apply_repayment(db, rules, loan, m, take, "contribution", None, rid, "Automatic deduction")
        done += 1
        await notify(db, m.user_id, "Instalment paid automatically", f"{naira(take)} was taken from your contribution balance for {loan.loan_no}." +
                     (" The loan is now fully repaid." if res["repaid"] else (f" {naira(res['remaining_kobo'])} still to pay." if res["remaining_kobo"] else "")), "/coop/loans")
        if take < due:
            short += 1
    return {"deducted": done, "short": short}


async def _once(db: AsyncSession, key: str) -> bool:
    from sqlalchemy.dialects.postgresql import insert
    from app.coop.models import CoopSent
    r = await db.execute(insert(CoopSent).values(key=key[:160]).on_conflict_do_nothing().returning(CoopSent.key))
    return r.first() is not None


async def send_reminders(db: AsyncSession, rules: Rules, today=None) -> int:
    today = today or rules.today()
    n = 0
    days = int(rules.get("reminder_days_before"))
    for loan in (await db.execute(select(CoopLoan).where(CoopLoan.status == "repaying"))).scalars().all():
        m = await db.get(CoopMember, loan.member_id)
        pos = position(loan, today)
        nxt = pos["next"]
        if pos["overdue"] and await _once(db, f"overdue:{loan.id}:{today.isoformat()}"):
            await notify(db, m.user_id, "Your loan is overdue", f"{loan.loan_no} is {pos['overdue_days']} day(s) overdue. {naira(pos['total_due_kobo'])} is due.", "/coop/loans")
            n += 1
        elif nxt and days and (date_from(nxt["due_date"]) - today).days == days and await _once(db, f"remind:{loan.id}:{nxt['n']}"):
            await notify(db, m.user_id, "Instalment coming up", f"{naira(nxt['amount_kobo'] - nxt['paid_kobo'])} is due on {nxt['due_date']} for {loan.loan_no}." +
                         (" It will be taken from your contribution balance." if loan.repay_source == "contribution_auto" else ""), "/coop/loans")
            n += 1
    return n


def date_from(iso: str):
    from datetime import date
    return date.fromisoformat(iso)


# ── itemised balances and interest breakdown ─────────────────────────────
async def itemised(db: AsyncSession, rules: Rules, m: CoopMember) -> dict:
    contrib = await ledger.balance(db, m.id, "contribution")
    locked = await ledger.balance(db, m.id, "locked")
    free = contrib - locked
    wl = await withdraw_limit(db, rules, m)
    ls = [l for l in await owing_loans(db, m.id)]
    due_next = 0
    for l in ls:
        if l.status == "repaying":
            due_next += position(l, rules.today())["due_now_kobo"]
    offer_cap = m.pool_offer_kobo or free
    return {"contribution_kobo": contrib, "locked_for_others_kobo": locked, "free_kobo": free,
            "due_now_kobo": due_next, "can_withdraw_kobo": wl["limit_kobo"], "withdraw_note": wl["reason"],
            "can_guarantee_kobo": max(min(free, offer_cap), 0),
            "loan_owed_kobo": sum(position(l, rules.today())["total_due_kobo"] for l in ls if l.status in OWING)}


async def interest_breakdown(db: AsyncSession, rules: Rules, loan: CoopLoan) -> dict:
    rc = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
        CoopJournal.loan_id == loan.id, CoopJournal.ledger == "running_cost", CoopJournal.entry_type == "running_cost"))).scalar_one())
    pool = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
        CoopJournal.loan_id == loan.id, CoopJournal.ledger == "pool_interest", CoopJournal.entry_type == "interest_realised"))).scalar_one())
    cp, gp = logic.split_pool(pool, int(rules.get("dividend_contribution_pct")))
    return {"interest_total_kobo": loan.interest_kobo, "interest_paid_kobo": loan.interest_paid_kobo, "running_cost_kobo": rc,
            "to_dividend_pool_kobo": pool, "contribution_share_kobo": cp, "guarantee_share_kobo": gp,
            "overdue_charges_paid_kobo": loan.charges_paid_kobo, "running_cost_pct": int(rules.get("running_cost_bps")) / 100,
            "contribution_pct": int(rules.get("dividend_contribution_pct")), "guarantee_pct": int(rules.get("dividend_guarantee_pct"))}
