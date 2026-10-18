"""Cooperative: director console endpoints (preview)."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import defs, insights, ledger, logic, ops, safety, service, settings_store
from app.coop.errors import CoopError
from app.coop.models import (CoopCase, CoopEvent, CoopGuarantee, CoopLoan, CoopLoanApproval, CoopMember, CoopPilotMember, CoopRequest,
                             CoopSettingChange, CoopSettingChangeApproval)
from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.user import User, UserRole

router = APIRouter(prefix="/coop/admin", tags=["coop-admin"])


async def _rules(db: AsyncSession = Depends(get_db)):
    return await settings_store.load_rules(db)


R = Depends(_rules)


class ProposeBody(BaseModel):
    value: str
    reason: Optional[str] = None


class VoteBody(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    note: Optional[str] = None


class PilotBody(BaseModel):
    phone_number: str


class DaysBody(BaseModel):
    days: int = Field(ge=1, le=3650)


class ResetBody(BaseModel):
    confirm: str


@router.get("/overview")
async def overview(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    await ops.run_jobs(db, rules)
    counts = dict((await db.execute(select(CoopLoan.status, func.count()).group_by(CoopLoan.status))).all())
    members = (await db.execute(select(func.count()).select_from(CoopMember).where(CoopMember.status == "active"))).scalar_one()
    pilot = (await db.execute(select(func.count()).select_from(CoopPilotMember))).scalar_one()
    pending_settings = (await db.execute(select(func.count()).select_from(CoopSettingChange).where(CoopSettingChange.status == "pending"))).scalar_one()
    loans = (await db.execute(select(CoopLoan).where(CoopLoan.status == "repaying"))).scalars().all()
    overdue = [l for l in loans if service.position(l, rules.today())["overdue"]]
    provisional = [d.key for d in defs.DEFINITIONS if not d.hidden and d.required_for_live and not rules.is_confirmed(d.key)]
    acc = rules.get("accountant_user_id")
    acc_name = None
    if acc:
        u = await db.get(User, uuid.UUID(acc))
        acc_name = u.full_name if u else None
    payouts = (await db.execute(select(func.count()).select_from(CoopLoan).where(CoopLoan.status == "awaiting_payout"))).scalar_one()
    reqs = (await db.execute(select(func.count()).select_from(CoopRequest).where(CoopRequest.status == "pending"))).scalar_one()
    open_cases = dict((await db.execute(select(CoopCase.kind, func.count()).where(CoopCase.status != "closed").group_by(CoopCase.kind))).all())
    ck = await ops.go_live_checklist(db, rules)
    return {"payouts_waiting": payouts, "requests_pending": reqs, "recovery_open": open_cases.get("recovery", 0), "complaints_open": open_cases.get("complaint", 0),
            "pilot": await safety.pilot_status(db, rules), "live": bool(rules.get("coop_live_funds")), "step_up": safety.step_up_needed(rules, "director"),
            "go_live_ready": ck["ready"], "go_live_missing": [i["label"] for i in ck["items"] if not i["ok"]],
            "members": members, "pilot_members": pilot, "loans": counts, "awaiting_approval": counts.get("awaiting_approval", 0),
            "settings_pending": pending_settings, "overdue_loans": len(overdue),
            "total_contributions_kobo": await insights.ledger_total(db, "contribution"),
            "locked_kobo": await insights.ledger_total(db, "locked"), "dividend_pool_kobo": await ledger.pool_total(db),
            "reconciliation": await insights.reconciliation(db), "provisional_blockers": provisional,
            "live_ready": ck["ready"], "live_blocked_reason": ("Live funds are ON." if rules.get("coop_live_funds") else "Live funds are off. Open the Money tab for the go-live checklist. Unconfirmed rules: %d." % len(provisional)),
            "clock_offset_days": int(rules.get("test_clock_offset_days")), "today": rules.today().isoformat(),
            "accountant": acc_name, "coop_enabled": bool(rules.get("coop_enabled")), "pilot_only": bool(rules.get("coop_pilot_only"))}


@router.get("/loans")
async def loans(director: DirectorOnly, status: Optional[str] = None, rules=R, db: AsyncSession = Depends(get_db)):
    await service.sweep(db, rules)
    q = select(CoopLoan).order_by(CoopLoan.created_at.desc()).limit(200)
    if status:
        q = q.where(CoopLoan.status == status)
    out = []
    for l in (await db.execute(q)).scalars().all():
        out.append(await _loan_row(db, rules, l, director))
    return out


async def _loan_row(db, rules, l: CoopLoan, director: User) -> dict:
    await db.flush()
    bm = await db.get(CoopMember, l.member_id)
    bu = await db.get(User, bm.user_id)
    st = await insights.stats(db, rules, bm)
    t = await service.guarantee_totals(db, l)
    pos = service.position(l, rules.today())
    gs = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == l.id, CoopGuarantee.status.in_(("signed", "invited", "viewed"))))).scalars().all()
    glist = []
    for g in gs:
        gm = await db.get(CoopMember, g.guarantor_id)
        gu = await db.get(User, gm.user_id)
        glist.append({"member_id": str(gm.id), "name": gu.full_name, "amount_kobo": g.amount_kobo, "status": g.status})
    votes = (await db.execute(select(CoopLoanApproval).where(CoopLoanApproval.loan_id == l.id))).scalars().all()
    return {"id": str(l.id), "loan_no": l.loan_no, "status": l.status, "principal_kobo": l.principal_kobo, "interest_kobo": l.interest_kobo,
            "total_kobo": l.total_kobo, "term_months": l.term_months, "rate_bps": l.rate_bps, "purpose": l.purpose, "flags": l.flags,
            "borrower": {"member_id": str(bm.id), "name": bu.full_name, "card_no": bm.card_no, "phone": bu.phone_number,
                         "reliability_pct": st["reliability_pct"], "months_member": st["months_member"], "loans_taken": st["loans_taken"],
                         "contribution_kobo": st["contribution_kobo"]},
            "guaranteed_kobo": t["signed"], "cover_needed_kobo": t["need"], "guarantors": glist,
            "approvals_required": l.approvals_required, "approvals": sum(1 for v in votes if v.decision == "approve"),
            "you_voted": any(v.director_id == director.id for v in votes), "decision_note": l.decision_note,
            "due_date": l.due_date.isoformat() if l.due_date else None, "total_due_kobo": pos["total_due_kobo"],
            "overdue_days": pos["overdue_days"], "accrued_charge_kobo": pos["accrued_charge_kobo"], "charges_paid_kobo": l.charges_paid_kobo,
            "schedule": pos["schedule"], "created_at": l.created_at.isoformat(), "fee_kobo": l.offer_fee_kobo, "net_payout_kobo": l.net_payout_kobo,
            "payout_status": l.payout_status, "overdue_charge_waived_kobo": l.waived_kobo, "charges_due_kobo": pos["charges_due_kobo"]}


@router.post("/loans/{loan_id}/decision")
async def decide_loan(loan_id: uuid.UUID, body: VoteBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    loan = await service.decide_loan(db, rules, loan_id, director, body.decision, body.note)
    return await _loan_row(db, rules, loan, director)


@router.get("/members")
async def members(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    out = []
    for m in (await db.execute(select(CoopMember).order_by(CoopMember.registered_at.desc()).limit(300))).scalars().all():
        u = await db.get(User, m.user_id)
        s = await insights.stats(db, rules, m)
        out.append({"member_id": str(m.id), "name": u.full_name, "phone": u.phone_number, "card_no": m.card_no, "status": m.status,
                    "nin_bypassed": m.nin_bypassed, "pool_listed": m.pool_listed, **s})
    return out


# ── settings ──
@router.get("/settings")
async def settings(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    chs = (await db.execute(select(CoopSettingChange).where(CoopSettingChange.status.in_(("pending", "scheduled"))))).scalars().all()
    pending, scheduled = {}, {}
    for c in chs:
        votes = (await db.execute(select(CoopSettingChangeApproval).where(CoopSettingChangeApproval.change_id == c.id))).scalars().all()
        info = {"id": str(c.id), "new_value": c.new_value, "reason": c.reason, "approvals": sum(1 for v in votes if v.decision == "approve"),
                "needed": int(rules.get("approvals_settings")), "you_voted": any(v.director_id == director.id for v in votes),
                "effective_on": c.effective_on.isoformat() if c.effective_on else None}
        (pending if c.status == "pending" else scheduled)[c.key] = info
    # The accountant assignment is a hidden setting, so it is not in the list above. Without this the
    # second director saw nothing to approve and the assignment stayed "pending" forever.
    acc_pending = pending.get("accountant_user_id")
    if acc_pending:
        nu = await db.get(User, uuid.UUID(acc_pending["new_value"])) if acc_pending["new_value"] else None
        acc_pending = {**acc_pending, "new_name": nu.full_name if nu else "(none)"}
    return {"groups": defs.GROUPS, "settings": settings_store.describe(rules, pending, scheduled), "accountant_pending": acc_pending,
            "role_pending": {k: v for k, v in pending.items() if k in defs.ROLE_KEYS}}


@router.post("/settings/{key}/propose")
async def propose(key: str, body: ProposeBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    ch = await settings_store.propose(db, rules, director, key, body.value, body.reason)
    return {"id": str(ch.id), "status": ch.status, "effective_on": ch.effective_on.isoformat() if ch.effective_on else None}


@router.post("/settings/changes/{change_id}/vote")
async def vote(change_id: uuid.UUID, body: VoteBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    ch = await settings_store.decide(db, rules, director, change_id, body.decision)
    return {"id": str(ch.id), "status": ch.status}


@router.get("/settings/history")
async def history(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CoopSettingChange).order_by(CoopSettingChange.created_at.desc()).limit(100))).scalars().all()
    out = []
    for c in rows:
        pu = await db.get(User, c.proposed_by) if c.proposed_by else None
        d = defs.BY_KEY.get(c.key)
        out.append({"id": str(c.id), "key": c.key, "label": d.label if d else c.key, "old": c.old_value, "new": c.new_value, "status": c.status,
                    "reason": c.reason, "proposed_by": pu.full_name if pu else None, "created_at": c.created_at.isoformat(),
                    "effective_on": c.effective_on.isoformat() if c.effective_on else None})
    return out


@router.get("/directors")
async def directors(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    us = (await db.execute(select(User).where(User.role == UserRole.DIRECTOR))).scalars().all()
    acc = rules.get("accountant_user_id")
    return [{"id": str(u.id), "name": u.full_name, "is_accountant": str(u.id) == acc, "is_treasurer": str(u.id) == rules.get("treasurer_user_id"), "is_you": u.id == director.id} for u in us]


# ── pilot list ──
@router.get("/pilot")
async def pilot(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CoopPilotMember, User).join(User, User.id == CoopPilotMember.user_id).order_by(CoopPilotMember.created_at.desc()))).all()
    return [{"user_id": str(p.user_id), "name": u.full_name, "phone": u.phone_number, "added_at": p.created_at.isoformat()} for p, u in rows]


@router.post("/pilot")
async def pilot_add(body: PilotBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    phone = body.phone_number.strip()
    u = (await db.execute(select(User).where(User.phone_number == phone))).scalars().first()
    if not u:
        raise CoopError("No customer found with that phone number", 404)
    if u.role != UserRole.CUSTOMER:
        raise CoopError("Only customers can join the cooperative pilot", 409)
    if not await db.get(CoopPilotMember, u.id):
        db.add(CoopPilotMember(user_id=u.id, added_by=director.id))
    return {"user_id": str(u.id), "name": u.full_name}


@router.delete("/pilot/{user_id}")
async def pilot_remove(user_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    p = await db.get(CoopPilotMember, user_id)
    if p:
        await db.delete(p)
    return {"ok": True}


# ── dividend, events, test tools ──
@router.get("/dividend")
async def dividend(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    return await insights.dividend(db, rules, None, 0, all_members=True)


@router.get("/events")
async def events(director: DirectorOnly, entity: Optional[str] = None, entity_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(CoopEvent).order_by(CoopEvent.id.desc()).limit(200)
    if entity:
        q = q.where(CoopEvent.entity == entity)
    if entity_id:
        q = q.where(CoopEvent.entity_id == entity_id)
    return [{"id": e.id, "entity": e.entity, "entity_id": e.entity_id, "action": e.action, "actor_id": str(e.actor_id) if e.actor_id else None,
             "data": e.data, "at": e.created_at.isoformat()} for e in (await db.execute(q)).scalars().all()]


@router.post("/test/advance")
async def advance(body: DaysBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    if rules.get("coop_live_funds"):
        raise CoopError("Time travel is switched off because live funds are on", 403, "live")
    new = int(rules.get("test_clock_offset_days")) + body.days
    await settings_store.set_test_clock(db, new, director.id)
    await db.flush()
    await service.audit.record(db, "test", "clock", "advance", director.id, {"days": body.days, "offset": new})
    rules.overrides["test_clock_offset_days"] = str(new)
    jobs = await ops.run_jobs(db, rules, force=True)   # due instalments are taken and reminders sent on the new date
    return {"clock_offset_days": new, "jobs": jobs}


@router.post("/test/reset")
async def reset(body: ResetBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    if body.confirm != "RESET":
        raise CoopError("Type RESET to confirm")
    if rules.get("coop_live_funds"):
        raise CoopError("Reset is blocked when live funds are on", 403)
    await db.execute(text("TRUNCATE coop_journal, coop_events, coop_guarantees, coop_loan_approvals, coop_loans, coop_members, coop_requests, coop_cases, "
                          "coop_dividend_runs, coop_expenses, coop_sweeps, coop_idempotency, coop_job_runs, coop_sent, coop_reconciliations RESTART IDENTITY CASCADE"))
    await db.execute(text("ALTER SEQUENCE coop_card_seq RESTART WITH 1"))
    await db.execute(text("ALTER SEQUENCE coop_loan_seq RESTART WITH 1"))
    await db.execute(text("DELETE FROM coop_settings WHERE key = 'test_clock_offset_days'"))
    return {"ok": True}
