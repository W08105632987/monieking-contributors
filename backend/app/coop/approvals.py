"""
Requests that need director votes: one engine for every decision the Board must take.

A request has a kind, a subject (loan / member / nothing), an amount and a payload. It needs the number of
approvals set in the rules for that kind (the director who opens it counts as the first). Some kinds also need the
affected members to agree again (restructure). When enough approvals are in, the kind's handler runs, once.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import audit, ledger, logic, service
from app.coop.errors import CoopError
from app.coop.models import (CoopCase, CoopExpense, CoopGuarantee, CoopJournal, CoopLoan, CoopMember, CoopRequest, CoopRequestVote, CoopSweep,
                             CoopDividendRun)
from app.coop.service import naira, notify
from app.coop.settings_store import Rules
from app.models.user import User, UserRole

# kind -> (rules key for the number of approvals, label)
KINDS: dict[str, tuple[str, str]] = {
    "final_release": ("approvals_final_release", "Confirm a final repayment"),
    "waiver": ("approvals_waiver", "Waive an overdue charge"),
    "restructure": ("approvals_restructure", "Restructure a loan"),
    "write_off": ("approvals_write_off", "Write off a loan"),
    "expense": ("approvals_expense", "Pay an expense"),
    "general_debit": ("approvals_general_debit", "Other debit"),
    "reversal": ("approvals_general_debit", "Reverse an entry"),
    "death_flag": ("approvals_estate", "Record a member's death"),
    "estate_payout": ("approvals_estate", "Pay a member's balance to next of kin"),
    "sweep": ("approvals_sweep", "Confirm a sweep of funds"),
    "golive": ("approvals_golive", "Switch on live funds"),
    "dividend_run": ("approvals_dividend", "Approve the dividend"),
}
REVERSIBLE = ("contribution", "membership_fee", "expense", "general_debit")
DEBIT_LEDGERS = ("running_cost", "operating")


def label(kind: str) -> str:
    return KINDS[kind][1]


async def _directors(db: AsyncSession) -> list[User]:
    return list((await db.execute(select(User).where(User.role == UserRole.DIRECTOR))).scalars().all())


async def open_request(db: AsyncSession, rules: Rules, *, kind: str, actor: Optional[User | uuid.UUID], member_id=None, loan_id=None, amount: int = 0,
                       payload: Optional[dict] = None, reason: Optional[str] = None, evidence: Optional[str] = None, ref_id: Optional[str] = None) -> CoopRequest:
    if kind not in KINDS:
        raise CoopError("Unknown request type")
    payload = dict(payload or {})
    dup = (await db.execute(select(CoopRequest).where(CoopRequest.kind == kind, CoopRequest.status == "pending", CoopRequest.loan_id == loan_id,
                                                      CoopRequest.member_id == member_id, CoopRequest.ref_id == ref_id))).scalars().first()
    if dup:
        raise CoopError("There is already an open request of this kind for the same subject", 409, "duplicate")
    consents: list = []
    loan = await db.get(CoopLoan, loan_id) if loan_id else None
    await _validate(db, rules, kind, loan, member_id, amount, payload, reason, evidence, consents)
    needed = max(int(rules.get(KINDS[kind][0])), 1)
    actor_user = actor if isinstance(actor, User) else None
    req = CoopRequest(kind=kind, member_id=member_id, loan_id=loan_id, ref_id=ref_id, amount_kobo=amount, payload=payload, reason=(reason or "").strip() or None,
                      evidence=(evidence or "").strip() or None, needed=needed, consents=consents, created_by=actor_user.id if actor_user else (actor if isinstance(actor, uuid.UUID) else None))
    db.add(req)
    await db.flush()
    await audit.record(db, "request", req.id, f"opened_{kind}", req.created_by, {"amount": amount, "reason": req.reason, "needed": needed})
    for c in consents:
        mm = await db.get(CoopMember, uuid.UUID(c["member_id"]))
        await notify(db, mm.user_id, "Your agreement is needed", f"The directors propose changing the terms of loan {loan.loan_no}. Please review and answer.", "/coop/consents")
    if actor_user and actor_user.role == UserRole.DIRECTOR:
        db.add(CoopRequestVote(request_id=req.id, director_id=actor_user.id, decision="approve"))
        await db.flush()
    await _maybe_execute(db, rules, req, req.created_by)
    return req


async def _validate(db, rules, kind, loan, member_id, amount, payload, reason, evidence, consents) -> None:
    today = rules.today()
    if kind in ("waiver", "restructure", "write_off") and not loan:
        raise CoopError("Choose a loan", 400)
    if kind in ("waiver", "restructure", "write_off") and loan.status != "repaying":
        raise CoopError("This loan is not being repaid", 409)
    if kind in ("waiver", "write_off", "general_debit", "reversal", "death_flag", "estate_payout") and not (reason or "").strip():
        raise CoopError("Please give the reason")
    if kind == "waiver":
        pos = service.position(loan, today)
        if amount <= 0 or amount > pos["charges_due_kobo"]:
            raise CoopError(f"The charge you can waive is between ₦0.01 and {naira(pos['charges_due_kobo'])}", 400)
    elif kind == "restructure":
        term = int(payload.get("new_term_months") or 0)
        if term < 1 or term > 36:
            raise CoopError("Choose a new term of 1 to 36 months", 400)
        mode = rules.get("restructure_reconsent")
        if mode != "directors_only":
            consents.append({"member_id": str(loan.member_id), "role": "borrower", "status": "pending"})
        if mode == "borrower_and_guarantors":
            for g in (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id, CoopGuarantee.status == "signed"))).scalars().all():
                consents.append({"member_id": str(g.guarantor_id), "role": "guarantor", "status": "pending"})
    elif kind == "write_off":
        pos = service.position(loan, today)
        if not pos["overdue"]:
            raise CoopError("Only an overdue loan can be written off", 409)
        wait = int(rules.get("loss_wait_months"))
        earliest = logic.add_months(loan.due_date, wait)
        if today < earliest:
            raise CoopError(f"A loan can only be written off {wait} months after it falls overdue: from {earliest.isoformat()}", 409, "too_early")
        if rules.get("write_off_requires_board_ref") and not (payload.get("board_ref") or "").strip():
            raise CoopError("Enter the Board decision reference")
        if rules.get("write_off_requires_lawyer") and not (payload.get("lawyer_report") or "").strip():
            raise CoopError("Enter the lawyer's report reference")
        case_open = (await db.execute(select(func.count()).select_from(CoopCase).where(
            CoopCase.loan_id == loan.id, CoopCase.kind == "recovery"))).scalar_one()
        if not case_open:
            raise CoopError("Open a recovery case and record the recovery steps before a write-off", 409, "no_case")
    elif kind == "expense":
        if amount <= 0:
            raise CoopError("Enter the amount")
        bal = await ledger.balance(db, None, "running_cost")
        if amount > bal:
            raise CoopError(f"The running-cost fund holds {naira(bal)}, which is less than this expense", 409)
        if rules.get("expense_receipt_required") and not (evidence or "").strip():
            raise CoopError("Enter the receipt link or reference")
    elif kind == "general_debit":
        if payload.get("ledger") not in DEBIT_LEDGERS:
            raise CoopError("Choose the running-cost fund or the operating account")
        if amount <= 0 or amount > await ledger.balance(db, None, payload["ledger"]):
            raise CoopError("That is more than the chosen account holds", 409)
    elif kind == "reversal":
        e = await db.get(CoopJournal, int(payload.get("journal_id") or 0))
        if not e or e.entry_type not in REVERSIBLE:
            raise CoopError("Only these entries can be reversed: " + ", ".join(REVERSIBLE), 400)
        if (await db.execute(select(func.count()).select_from(CoopJournal).where(CoopJournal.reverses_id == e.id))).scalar_one():
            raise CoopError("That entry has already been reversed", 409)
        amount_ = abs(e.delta_kobo)
        payload["amount_kobo"] = amount_
    elif kind == "death_flag":
        m = await db.get(CoopMember, member_id) if member_id else None
        if not m or m.status != "active":
            raise CoopError("Choose an active member", 400)
    elif kind == "estate_payout":
        m = await db.get(CoopMember, member_id) if member_id else None
        if not m or m.status != "deceased_hold":
            raise CoopError("The member must first be recorded as deceased", 409)
        if not m.next_of_kin:
            raise CoopError("There are no next-of-kin details on record", 409)
        if await service.owing_loans(db, m.id) or await ledger.balance(db, m.id, "locked") > 0:
            raise CoopError("The member's loan and guarantees must be settled first", 409)
        if not (evidence or "").strip():
            raise CoopError("Enter the evidence (death certificate and claimant ID reference)")
    elif kind == "sweep":
        if amount <= 0 or payload.get("direction") not in ("to_coop_account", "from_coop_account"):
            raise CoopError("Choose the direction and the amount")
        if not (evidence or "").strip():
            raise CoopError("Enter the bank transfer reference")
    elif kind == "golive":
        from app.coop import ops
        ck = await ops.go_live_checklist(db, rules)
        if not ck["ready"]:
            raise CoopError("Not ready to go live: " + "; ".join(i["label"] for i in ck["items"] if not i["ok"]), 409, "not_ready")


# ── voting ────────────────────────────────────────────────────────────────
def _may_vote(rules: Rules, req: CoopRequest, director: User) -> None:
    if req.kind == "final_release":
        allowed = [x for x in (rules.get("final_release_directors") or "").split(",") if x]
        if allowed and str(director.id) not in allowed:
            raise CoopError("Only the directors designated for final repayments can confirm this", 403, "not_designated")
    if req.kind == "dividend_run" and not rules.get("dividend_accountant_can_approve") and str(director.id) == rules.get("accountant_user_id"):
        raise CoopError("The director who prepared the dividend cannot also approve it", 403, "segregation")


async def vote(db: AsyncSession, rules: Rules, request_id, director: User, decision: str, note: Optional[str]) -> CoopRequest:
    req = (await db.execute(select(CoopRequest).where(CoopRequest.id == request_id).with_for_update())).scalars().first()
    if not req:
        raise CoopError("Request not found", 404)
    if req.status != "pending":
        raise CoopError("This request has already been decided", 409)
    if (await db.execute(select(CoopRequestVote).where(CoopRequestVote.request_id == req.id, CoopRequestVote.director_id == director.id))).scalars().first():
        raise CoopError("You have already voted on this request", 409)
    if decision == "reject" and not (note or "").strip():
        raise CoopError("Please give a reason for rejecting")
    _may_vote(rules, req, director)
    db.add(CoopRequestVote(request_id=req.id, director_id=director.id, decision=decision, note=(note or "")[:300] or None))
    await db.flush()
    await audit.record(db, "request", req.id, f"vote_{decision}", director.id, {"kind": req.kind, "note": note})
    if decision == "reject":
        await _reject(db, rules, req, note)
        return req
    await _maybe_execute(db, rules, req, director.id)
    return req


async def consent(db: AsyncSession, rules: Rules, request_id, user: User, agree: bool) -> CoopRequest:
    req = (await db.execute(select(CoopRequest).where(CoopRequest.id == request_id).with_for_update())).scalars().first()
    m = await service.member_of(db, user)
    if not req or not m:
        raise CoopError("Not found", 404)
    mine = [c for c in req.consents if c["member_id"] == str(m.id) and c["status"] == "pending"]
    if req.status != "pending" or not mine:
        raise CoopError("There is nothing for you to answer here", 409)
    new = [{**c, "status": ("agreed" if agree else "declined"), "at": rules.now().isoformat()} if c in mine else c for c in req.consents]
    req.consents = new
    await db.flush()
    await audit.record(db, "request", req.id, "agreed" if agree else "declined", user.id, {"role": mine[0]["role"]})
    if not agree:
        await _reject(db, rules, req, "A person affected did not agree")
        return req
    await _maybe_execute(db, rules, req, user.id)
    return req


async def cancel(db: AsyncSession, rules: Rules, request_id, director: User) -> CoopRequest:
    req = (await db.execute(select(CoopRequest).where(CoopRequest.id == request_id).with_for_update())).scalars().first()
    if not req or req.status != "pending":
        raise CoopError("This request cannot be cancelled", 409)
    if req.created_by != director.id:
        raise CoopError("Only the director who opened it can withdraw it", 403)
    if req.kind == "final_release":
        raise CoopError("A final-repayment confirmation cannot be withdrawn", 409)
    await _reject(db, rules, req, "Withdrawn by the director who opened it", status="cancelled")
    return req


async def _reject(db, rules, req: CoopRequest, why, status: str = "rejected") -> None:
    req.status, req.decided_at, req.result = status, rules.now(), {"why": why}
    if req.kind == "expense":
        ex = await db.get(CoopExpense, uuid.UUID(req.ref_id)) if req.ref_id else None
        if ex:
            ex.status = "rejected"
    if req.kind == "dividend_run":
        run = await db.get(CoopDividendRun, uuid.UUID(req.ref_id)) if req.ref_id else None
        if run and run.status in ("reconciled", "prepared"):
            run.status = "cancelled"
    await audit.record(db, "request", req.id, status, None, {"why": why})


async def _maybe_execute(db: AsyncSession, rules: Rules, req: CoopRequest, actor) -> None:
    if req.status != "pending":
        return
    have = (await db.execute(select(func.count()).select_from(CoopRequestVote).where(
        CoopRequestVote.request_id == req.id, CoopRequestVote.decision == "approve"))).scalar_one()
    if have < req.needed or any(c["status"] != "agreed" for c in req.consents):
        return
    req.status, req.decided_at = "approved", rules.now()
    handler = HANDLERS[req.kind]
    req.result = await handler(db, rules, req, actor)
    req.status, req.executed_at = "executed", rules.now()
    await audit.record(db, "request", req.id, "executed", actor if isinstance(actor, uuid.UUID) else None, {"kind": req.kind, "result": req.result})


# ── handlers ──────────────────────────────────────────────────────────────
async def _h_final_release(db, rules, req, actor) -> dict:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == req.loan_id).with_for_update())).scalars().one()
    if loan.status != "awaiting_final_release":
        raise CoopError("This loan is not waiting for final release", 409)
    await service.close_repaid(db, rules, loan)
    return {"released": True}


async def _h_waiver(db, rules, req, actor) -> dict:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == req.loan_id).with_for_update())).scalars().one()
    pos = service.position(loan, rules.today())
    amt = min(req.amount_kobo, pos["charges_due_kobo"])
    loan.waived_kobo += amt
    await db.flush()
    m = await db.get(CoopMember, loan.member_id)
    await notify(db, m.user_id, "Overdue charge waived", f"{naira(amt)} of the overdue charge on {loan.loan_no} was waived by the directors.", "/coop/loans")
    if service.position(loan, rules.today())["total_due_kobo"] == 0:
        await service._fully_repaid(db, rules, loan, m)
    return {"waived_kobo": amt}


async def _h_restructure(db, rules, req, actor) -> dict:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == req.loan_id).with_for_update())).scalars().one()
    if loan.status != "repaying":
        raise CoopError("This loan is no longer being repaid", 409)
    term = int(req.payload["new_term_months"])
    today = rules.today()
    paid = loan.principal_paid_kobo + loan.interest_paid_kobo
    rem_p, rem_i = loan.principal_kobo - loan.principal_paid_kobo, loan.interest_kobo - loan.interest_paid_kobo
    # Rows already paid stay as one record so the schedule still adds up to what was paid.
    rows = [{"n": 0, "due_date": today.isoformat(), "amount_kobo": paid, "principal_kobo": loan.principal_paid_kobo,
             "interest_kobo": loan.interest_paid_kobo, "label": "Paid before the restructure"}] if paid else []
    new = logic.build_schedule(rem_p, rem_i, term, today)
    loan.schedule = rows + new
    loan.term_months = term
    loan.due_date = service.due_for(today, term, loan.final_due_rule)
    loan.restructured_count += 1
    await db.flush()
    m = await db.get(CoopMember, loan.member_id)
    await notify(db, m.user_id, "Loan restructured", f"{loan.loan_no} now runs for {term} more month(s) from today.", "/coop/loans")
    return {"new_term_months": term, "due_date": loan.due_date.isoformat()}


async def _h_write_off(db, rules, req, actor) -> dict:
    loan = (await db.execute(select(CoopLoan).where(CoopLoan.id == req.loan_id).with_for_update())).scalars().one()
    unpaid = loan.principal_kobo - loan.principal_paid_kobo
    gs = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id, CoopGuarantee.status == "signed"))).scalars().all()
    covered_total = min(unpaid, sum(g.amount_kobo for g in gs))
    shares = logic.largest_remainder(covered_total, {g.id: g.amount_kobo for g in gs}) if gs else {}
    covered = 0
    for g in gs:
        sh = min(shares.get(g.id, 0), g.amount_kobo)
        await ledger.post(db, rules, member_id=g.guarantor_id, ledger="locked", entry_type="unlock", delta=-g.amount_kobo,
                          reference=f"unlock:{g.id}", loan_id=loan.id, guarantee_id=g.id, actor=actor, note=f"Write-off of {loan.loan_no}")
        if sh > 0:
            await ledger.post(db, rules, member_id=g.guarantor_id, ledger="contribution", entry_type="loss_applied", delta=-sh,
                              reference=f"loss:{g.id}", loan_id=loan.id, guarantee_id=g.id, actor=actor, note=f"Loss on {loan.loan_no} applied to guarantee")
            covered += sh
        g.status, g.released_at = "loss_applied", rules.now()
        gm = await db.get(CoopMember, g.guarantor_id)
        await notify(db, gm.user_id, "A loan you guaranteed was written off",
                     f"{naira(sh)} of your contribution was applied to the loss on {loan.loan_no}." if sh else f"{loan.loan_no} was written off. Your guarantee is released.", "/coop")
    await ledger.post(db, rules, member_id=loan.member_id, ledger="loan_written_off", entry_type="written_off", delta=unpaid,
                      reference=f"wo:{loan.id}", loan_id=loan.id, actor=actor, note=f"Write-off of {loan.loan_no}")
    absorbed = unpaid - covered
    if absorbed > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_interest", entry_type="loss_absorbed", delta=-absorbed,
                          reference=f"woabs:{loan.id}", loan_id=loan.id, actor=actor, note=f"Loss on {loan.loan_no} not covered by guarantees")
    loan.status, loan.closed_at, loan.written_off_kobo = "written_off", rules.now(), unpaid
    loan.decision_note = f"Written off. Board ref: {req.payload.get('board_ref', '')}"[:300]
    for c in (await db.execute(select(CoopCase).where(CoopCase.loan_id == loan.id, CoopCase.kind == "recovery", CoopCase.status != "closed"))).scalars().all():
        c.status, c.closed_at, c.resolution = "closed", rules.now(), "Loan written off"
    return {"written_off_kobo": unpaid, "applied_to_guarantors_kobo": covered, "absorbed_by_pool_kobo": absorbed}


async def _h_expense(db, rules, req, actor) -> dict:
    ex = await db.get(CoopExpense, uuid.UUID(req.ref_id))
    await ledger.post(db, rules, member_id=None, ledger="running_cost", entry_type="expense", delta=-ex.amount_kobo,
                      reference=f"exp:{ex.id}", actor=actor, note=f"{ex.category}: {ex.description}"[:300])
    ex.status = "approved"
    return {"expense_id": str(ex.id)}


async def _h_general_debit(db, rules, req, actor) -> dict:
    await ledger.post(db, rules, member_id=None, ledger=req.payload["ledger"], entry_type="general_debit", delta=-req.amount_kobo,
                      reference=f"gd:{req.id}", actor=actor, note=(req.reason or "")[:300])
    return {"ledger": req.payload["ledger"], "amount_kobo": req.amount_kobo}


async def _h_reversal(db, rules, req, actor) -> dict:
    e = await db.get(CoopJournal, int(req.payload["journal_id"]))
    row = await ledger.post(db, rules, member_id=e.member_id, ledger=e.ledger, entry_type=f"reversal_{e.entry_type}"[:40], delta=-e.delta_kobo,
                            reference=f"rev:{e.id}", loan_id=e.loan_id, guarantee_id=e.guarantee_id, actor=actor, note=f"Reversal of #{e.id}: {req.reason}"[:300], reverses_id=e.id)
    return {"reversal_entry": row.id}


async def _h_death_flag(db, rules, req, actor) -> dict:
    m = await db.get(CoopMember, req.member_id)
    m.status, m.death_flagged_at, m.pool_listed = "deceased_hold", rules.now(), False
    return {"member": str(m.id)}


async def _h_estate(db, rules, req, actor) -> dict:
    m = await db.get(CoopMember, req.member_id)
    bal = await ledger.balance(db, m.id, "contribution")
    if bal > 0:
        await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="estate_payout", delta=-bal,
                          reference=f"estate:{m.id}", actor=actor, note="Balance paid to next of kin")
    m.status, m.closed_at = "closed", rules.now()
    return {"paid_kobo": bal, "next_of_kin": m.next_of_kin}


async def _h_sweep(db, rules, req, actor) -> dict:
    sw = CoopSweep(direction=req.payload["direction"], amount_kobo=req.amount_kobo, reference=(req.evidence or "")[:120], note=(req.reason or "")[:300],
                   request_id=req.id, created_by=req.created_by)
    db.add(sw)
    await db.flush()
    return {"sweep": str(sw.id)}


async def _h_golive(db, rules, req, actor) -> dict:
    from app.coop import ops, settings_store
    ck = await ops.go_live_checklist(db, rules)
    if not ck["ready"]:
        raise CoopError("Not ready to go live: " + "; ".join(i["label"] for i in ck["items"] if not i["ok"]), 409, "not_ready")
    await settings_store._upsert(db, "coop_live_funds", "true", actor if isinstance(actor, uuid.UUID) else None)
    rules.overrides["coop_live_funds"] = "true"
    return {"live": True}


async def _h_dividend(db, rules, req, actor) -> dict:
    run = await db.get(CoopDividendRun, uuid.UUID(req.ref_id))
    if not run or run.status != "reconciled":
        raise CoopError("The dividend must be reconciled before it is approved", 409)
    run.status, run.approved_at = "approved", rules.now()
    return {"run": str(run.id)}


HANDLERS = {"final_release": _h_final_release, "waiver": _h_waiver, "restructure": _h_restructure, "write_off": _h_write_off,
            "expense": _h_expense, "general_debit": _h_general_debit, "reversal": _h_reversal, "death_flag": _h_death_flag,
            "estate_payout": _h_estate, "sweep": _h_sweep, "golive": _h_golive, "dividend_run": _h_dividend}


# ── reading ───────────────────────────────────────────────────────────────
async def view(db: AsyncSession, req: CoopRequest, viewer: Optional[User] = None) -> dict:
    votes = (await db.execute(select(CoopRequestVote).where(CoopRequestVote.request_id == req.id).order_by(CoopRequestVote.created_at))).scalars().all()
    names = {}
    for v in votes:
        u = await db.get(User, v.director_id)
        names[v.director_id] = u.full_name if u else "?"
    loan = await db.get(CoopLoan, req.loan_id) if req.loan_id else None
    m = await db.get(CoopMember, req.member_id) if req.member_id else None
    mu = await db.get(User, m.user_id) if m else None
    cs = []
    for c in req.consents:
        cm = await db.get(CoopMember, uuid.UUID(c["member_id"]))
        cu = await db.get(User, cm.user_id)
        cs.append({**c, "name": cu.full_name})
    return {"id": str(req.id), "kind": req.kind, "label": label(req.kind), "status": req.status, "amount_kobo": req.amount_kobo,
            "loan_no": loan.loan_no if loan else None, "loan_id": str(req.loan_id) if req.loan_id else None,
            "member": {"id": str(m.id), "name": mu.full_name, "card_no": m.card_no} if m else None,
            "payload": req.payload, "reason": req.reason, "evidence": req.evidence, "needed": req.needed,
            "approvals": sum(1 for v in votes if v.decision == "approve"),
            "votes": [{"director": names[v.director_id], "decision": v.decision, "note": v.note, "at": v.created_at.isoformat()} for v in votes],
            "you_voted": bool(viewer and any(v.director_id == viewer.id for v in votes)),
            "mine": bool(viewer and req.created_by == viewer.id), "consents": cs, "result": req.result, "ref_id": req.ref_id,
            "created_at": req.created_at.isoformat(), "executed_at": req.executed_at.isoformat() if req.executed_at else None}


async def list_requests(db: AsyncSession, viewer: User, status: Optional[str] = None, kind: Optional[str] = None, limit: int = 100) -> list[dict]:
    q = select(CoopRequest).order_by(CoopRequest.created_at.desc()).limit(limit)
    if status:
        q = q.where(CoopRequest.status == status)
    if kind:
        q = q.where(CoopRequest.kind == kind)
    return [await view(db, r, viewer) for r in (await db.execute(q)).scalars().all()]
