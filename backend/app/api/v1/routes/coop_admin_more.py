"""Cooperative: director endpoints added in Modules 10b-10e (payouts, requests, cases, roles, year end, money, go-live, audit)."""
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import approvals, cases, defs, ops, safety, service, settings_store, yearend
from app.coop.errors import CoopError
from app.coop.models import CoopCase, CoopDividendDispute, CoopDividendRun, CoopEvent, CoopLoan, CoopMember, CoopRequest, CoopSettingChange
from app.coop.safety import AuthBody
from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.user import User, UserRole

router = APIRouter(prefix="/coop/admin", tags=["coop-admin"])


async def _rules(db: AsyncSession = Depends(get_db)):
    return await settings_store.load_rules(db)


R = Depends(_rules)


class AuthBodyOpt(BaseModel):
    auth: Optional[AuthBody] = None


class PayoutBody(AuthBodyOpt):
    reference: Optional[str] = None
    evidence: Optional[str] = None


class NoteBody(BaseModel):
    note: str = ""


class OpenRequestBody(BaseModel):
    kind: str
    loan_id: Optional[uuid.UUID] = None
    member_id: Optional[uuid.UUID] = None
    amount_kobo: int = Field(default=0, ge=0)
    payload: dict = {}
    reason: Optional[str] = None
    evidence: Optional[str] = None


class VoteBody(AuthBodyOpt):
    decision: str = Field(pattern="^(approve|reject)$")
    note: Optional[str] = None


class CaseNoteBody(BaseModel):
    kind: str = "note"
    body: str
    visible_to_member: bool = False


class CaseCloseBody(BaseModel):
    resolution: str


class RecoveryBody(BaseModel):
    loan_id: uuid.UUID


class PrepareBody(BaseModel):
    year: Optional[int] = None


class DisputeResolveBody(BaseModel):
    uphold: bool
    adjust_kobo: int = 0
    resolution: str
    fund_from: str = "pool"


class ExpenseBody(BaseModel):
    category: str
    amount_kobo: int = Field(gt=0)
    description: str
    spent_on: date
    evidence: Optional[str] = None


OPENABLE = ("waiver", "restructure", "write_off", "general_debit", "reversal", "death_flag", "estate_payout", "sweep")


# ── payouts (Treasurer) ──
@router.get("/payouts")
async def payouts(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    await ops.kick_jobs(db, rules)
    ls = (await db.execute(select(CoopLoan).where(CoopLoan.status.in_(("awaiting_acceptance", "awaiting_payout"))).order_by(CoopLoan.approved_at))).scalars().all()
    out = []
    for l in ls:
        m = await db.get(CoopMember, l.member_id)
        u = await db.get(User, m.user_id)
        out.append({"id": str(l.id), "loan_no": l.loan_no, "status": l.status, "borrower": u.full_name, "phone": u.phone_number, "card_no": m.card_no,
                    "principal_kobo": l.principal_kobo, "fee_kobo": l.offer_fee_kobo, "net_payout_kobo": l.net_payout_kobo,
                    "payout_status": l.payout_status, "hold_reason": l.payout_hold_reason, "account": l.payout_account,
                    "offer_expires_at": l.offer_expires_at.isoformat() if l.offer_expires_at else None, "term_months": l.term_months,
                    "mode": rules.get("payout_mode"), "evidence_required": bool(rules.get("payout_evidence_required")),
                    "can_send": (rules.get("payout_executor") == "any_director" or str(director.id) == rules.get("treasurer_user_id")),
                    "step_up": safety.step_up_needed(rules, "director")})
    return out


@router.post("/loans/{loan_id}/payout")
async def confirm_payout(loan_id: uuid.UUID, body: PayoutBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    await safety.require_step_up(db, rules, director, body.auth, "director")
    l = await service.confirm_payout(db, rules, loan_id, director, body.reference, body.evidence)
    return {"id": str(l.id), "status": l.status}


@router.get("/withdrawals")
async def withdrawals(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db), status: str = Query("pending"),
                      q: str = Query(""), limit: int = Query(10, ge=1, le=50), offset: int = Query(0, ge=0),
                      min_kobo: Optional[int] = Query(None), max_kobo: Optional[int] = Query(None),
                      date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None)):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import func, or_
    from app.coop.models import CoopWithdrawal as W
    base = select(W, CoopMember, User).join(CoopMember, CoopMember.id == W.member_id).join(User, User.id == CoopMember.user_id)
    if status != "all":
        base = base.where(W.status == status)
    if q.strip():
        like = f"%{q.strip()}%"
        base = base.where(or_(User.full_name.ilike(like), User.phone_number.ilike(like), CoopMember.card_no.ilike(like)))
    if min_kobo is not None:
        base = base.where(W.amount_kobo >= min_kobo)
    if max_kobo is not None:
        base = base.where(W.amount_kobo <= max_kobo)
    try:
        if date_from:
            base = base.where(W.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
        if date_to:
            base = base.where(W.created_at < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1))
    except ValueError:
        raise CoopError("Dates must look like 2026-10-31")
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(base.order_by(W.created_at.desc()).limit(limit).offset(offset))).all()
    counts = {k: int(c) for k, c in (await db.execute(select(W.status, func.count()).group_by(W.status))).all()}
    can_send = rules.get("payout_executor") == "any_director" or str(director.id) == rules.get("treasurer_user_id")
    return {"total": total, "counts": counts, "can_send": can_send, "evidence_required": bool(rules.get("payout_evidence_required")),
            "step_up": safety.step_up_needed(rules, "director"),
            "items": [service.withdrawal_view(w, u.full_name, m.card_no, u.phone_number, True) for w, m, u in rows]}


@router.post("/withdrawals/{wid}/pay")
async def pay_withdrawal(wid: uuid.UUID, body: PayoutBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    await safety.require_step_up(db, rules, director, body.auth, "director")
    w = await service.pay_withdrawal(db, rules, wid, director, body.reference, body.evidence)
    return service.withdrawal_view(w)


@router.post("/withdrawals/{wid}/reject")
async def reject_withdrawal(wid: uuid.UUID, body: NoteBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    w = await service.reject_withdrawal(db, rules, wid, director, body.note)
    return service.withdrawal_view(w)


@router.post("/withdrawals/{wid}/clear-hold")
async def clear_withdrawal_hold(wid: uuid.UUID, body: NoteBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    w = await service.clear_withdrawal_hold(db, rules, wid, director, body.note)
    return service.withdrawal_view(w)


@router.post("/loans/{loan_id}/clear-hold")
async def clear_hold(loan_id: uuid.UUID, body: NoteBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    l = await service.clear_hold(db, rules, loan_id, director, body.note)
    return {"id": str(l.id), "payout_status": l.payout_status}


# ── requests ──
@router.get("/requests")
async def requests_list(director: DirectorOnly, status: Optional[str] = None, kind: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    return await approvals.list_requests(db, director, status, kind)


@router.post("/requests")
async def requests_open(body: OpenRequestBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    if body.kind not in OPENABLE:
        raise CoopError("That request is opened from its own screen")
    ref = str(body.payload.get("journal_id")) if body.kind == "reversal" else None
    r = await approvals.open_request(db, rules, kind=body.kind, actor=director, member_id=body.member_id, loan_id=body.loan_id, amount=body.amount_kobo,
                                     payload=body.payload, reason=body.reason, evidence=body.evidence, ref_id=ref)
    return await approvals.view(db, r, director)


@router.post("/requests/{request_id}/vote")
async def requests_vote(request_id: uuid.UUID, body: VoteBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    if body.decision == "approve":
        req = await db.get(CoopRequest, request_id)
        if req and req.kind in ("final_release", "golive", "dividend_run", "sweep"):
            await safety.require_step_up(db, rules, director, body.auth, "director")
    r = await approvals.vote(db, rules, request_id, director, body.decision, body.note)
    return await approvals.view(db, r, director)


@router.post("/requests/{request_id}/cancel")
async def requests_cancel(request_id: uuid.UUID, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    r = await approvals.cancel(db, rules, request_id, director)
    return await approvals.view(db, r, director)


# ── cases ──
@router.get("/cases")
async def cases_list(director: DirectorOnly, kind: Optional[str] = None, status: Optional[str] = "open", db: AsyncSession = Depends(get_db)):
    cs = await cases.list_cases(db, kind, None if status == "all" else status)
    return [await cases.case_view(db, c) for c in cs]


@router.get("/cases/{case_id}")
async def case_get(case_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    c = await db.get(CoopCase, case_id)
    if not c:
        raise CoopError("Case not found", 404)
    return await cases.case_view(db, c)


@router.post("/cases/recovery")
async def case_open(body: RecoveryBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    c = await cases.open_recovery(db, rules, body.loan_id, director)
    return await cases.case_view(db, c)


@router.post("/cases/{case_id}/notes")
async def case_note(case_id: uuid.UUID, body: CaseNoteBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await cases.add_note(db, case_id, director, body.kind, body.body, body.visible_to_member)
    return await cases.case_view(db, await db.get(CoopCase, case_id))


@router.post("/cases/{case_id}/respond")
async def case_respond(case_id: uuid.UUID, body: CaseCloseBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    c = await cases.respond(db, rules, case_id, director, body.resolution)
    return await cases.case_view(db, c)


@router.post("/cases/{case_id}/close")
async def case_close(case_id: uuid.UUID, body: CaseCloseBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    c = await cases.close_case(db, rules, case_id, director, body.resolution)
    return await cases.case_view(db, c)


# ── roles ──
@router.get("/roles")
async def roles(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    dirs = (await db.execute(select(User).where(User.role == UserRole.DIRECTOR))).scalars().all()
    pend = {}
    for c in (await db.execute(select(CoopSettingChange).where(CoopSettingChange.status == "pending", CoopSettingChange.key.in_(defs.ROLE_KEYS)))).scalars().all():
        from app.coop.models import CoopSettingChangeApproval as A
        votes = (await db.execute(select(A).where(A.change_id == c.id))).scalars().all()
        pend[c.key] = {"id": str(c.id), "new_value": c.new_value, "approvals": sum(1 for v in votes if v.decision == "approve"),
                       "needed": int(rules.get("approvals_settings")), "you_voted": any(v.director_id == director.id for v in votes)}
    names = {str(u.id): u.full_name for u in dirs}
    def cur(k):
        return [x for x in (rules.get(k) or "").split(",") if x]
    return {"directors": [{"id": str(u.id), "name": u.full_name, "is_you": u.id == director.id} for u in dirs],
            "roles": [
                {"key": "accountant_user_id", "label": "Accountant", "help": "Prepares and reconciles the dividend. Cannot approve it unless the rule allows.", "multi": False, "current": cur("accountant_user_id"), "pending": pend.get("accountant_user_id")},
                {"key": "treasurer_user_id", "label": "Treasurer", "help": "Sends loan payouts and records the bank evidence.", "multi": False, "current": cur("treasurer_user_id"), "pending": pend.get("treasurer_user_id")},
                {"key": "final_release_directors", "label": "Final repayment confirmers", "help": "Directors who confirm a final repayment. Leave empty for any director.", "multi": True, "current": cur("final_release_directors"), "pending": pend.get("final_release_directors")}],
            "names": names,
            "permissions": [
                {"action": "Approve a loan", "who": f"{rules.get('approvals_loan')} directors"},
                {"action": "Send a loan payout", "who": "Treasurer" if rules.get("payout_executor") == "treasurer" else "Any director"},
                {"action": "Prepare and reconcile the dividend", "who": "Accountant" if rules.get("accountant_user_id") else "Any director (no accountant set)"},
                {"action": "Approve the dividend", "who": f"{rules.get('approvals_dividend')} directors" + ("" if rules.get("dividend_accountant_can_approve") else ", not the accountant")},
                {"action": "Confirm a final repayment", "who": f"{rules.get('approvals_final_release')} directors" + (" from the designated list" if cur("final_release_directors") else "")},
                {"action": "Write off a loan", "who": f"{rules.get('approvals_write_off')} directors, with Board reference and lawyer's report"},
                {"action": "Change any rule", "who": f"{rules.get('approvals_settings')} directors"},
                {"action": "Switch on live funds", "who": f"{rules.get('approvals_golive')} directors"}]}


# ── audit view ──
@router.get("/audit")
async def audit_view(director: DirectorOnly, entity: Optional[str] = None, action: Optional[str] = None, q: Optional[str] = None,
                     actor_id: Optional[uuid.UUID] = None, limit: int = 100, offset: int = 0, db: AsyncSession = Depends(get_db)):
    qq = select(CoopEvent).order_by(CoopEvent.id.desc()).limit(min(limit, 300)).offset(offset)
    if entity:
        qq = qq.where(CoopEvent.entity == entity)
    if action:
        qq = qq.where(CoopEvent.action.ilike(f"%{action}%"))
    if actor_id:
        qq = qq.where(CoopEvent.actor_id == actor_id)
    if q:
        qq = qq.where(or_(CoopEvent.entity_id.ilike(f"%{q}%"), CoopEvent.action.ilike(f"%{q}%")))
    rows = (await db.execute(qq)).scalars().all()
    names = {}
    out = []
    for e in rows:
        if e.actor_id and e.actor_id not in names:
            u = await db.get(User, e.actor_id)
            names[e.actor_id] = u.full_name if u else "?"
        out.append({"id": e.id, "entity": e.entity, "entity_id": e.entity_id, "action": e.action, "actor": names.get(e.actor_id, "System"), "data": e.data,
                    "at": e.created_at.isoformat()})
    return out


# ── year end ──
@router.post("/year-end/fees")
async def fees(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    return await yearend.collect_fees(db, rules, director)


@router.get("/dividend-runs")
async def runs(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    rs = (await db.execute(select(CoopDividendRun).order_by(CoopDividendRun.created_at.desc()).limit(20))).scalars().all()
    disputes = (await db.execute(select(CoopDividendDispute).order_by(CoopDividendDispute.created_at.desc()).limit(50))).scalars().all()
    dd = []
    for d in disputes:
        m = await db.get(CoopMember, d.member_id)
        u = await db.get(User, m.user_id)
        run = await db.get(CoopDividendRun, d.run_id)
        dd.append({"id": str(d.id), "run_id": str(d.run_id), "year": run.year, "member": u.full_name, "card_no": m.card_no, "body": d.body, "status": d.status,
                   "resolution": d.resolution, "adjust_kobo": d.adjust_kobo, "created_at": d.created_at.isoformat()})
    return {"runs": [await yearend.run_view(db, r, with_lines=False) for r in rs], "disputes": dd, "year": rules.today().year,
            "accountant": rules.get("accountant_user_id") or None, "you_are_accountant": (not rules.get("accountant_user_id")) or str(director.id) == rules.get("accountant_user_id")}


@router.get("/dividend-runs/{run_id}")
async def run_get(run_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    r = await db.get(CoopDividendRun, run_id)
    if not r:
        raise CoopError("Not found", 404)
    out = await yearend.run_view(db, r)
    if r.request_id:
        out["request"] = await approvals.view(db, await db.get(CoopRequest, r.request_id), director)
    return out


@router.post("/dividend-runs/prepare")
async def run_prepare(body: PrepareBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    r = await yearend.prepare_dividend(db, rules, director, body.year)
    return await yearend.run_view(db, r)


@router.post("/dividend-runs/{run_id}/reconcile")
async def run_reconcile(run_id: uuid.UUID, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    r, checks = await yearend.reconcile_dividend(db, rules, director, run_id)
    return {**await yearend.run_view(db, r), "checks": checks}


@router.post("/dividend-runs/{run_id}/pay")
async def run_pay(run_id: uuid.UUID, body: AuthBodyOpt, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    await safety.require_step_up(db, rules, director, body.auth, "director")
    r = await yearend.pay_dividend(db, rules, director, run_id)
    return await yearend.run_view(db, r)


@router.post("/disputes/{dispute_id}/resolve")
async def dispute_resolve(dispute_id: uuid.UUID, body: DisputeResolveBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    d = await yearend.resolve_dispute(db, rules, director, dispute_id, body.uphold, body.adjust_kobo, body.resolution, body.fund_from)
    return {"id": str(d.id), "status": d.status}


@router.get("/expenses")
async def expenses(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    return await yearend.expense_register(db, rules)


@router.post("/expenses")
async def expense_add(body: ExpenseBody, director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    ex = await yearend.record_expense(db, rules, director, body.category, body.amount_kobo, body.description, body.spent_on, body.evidence)
    return {"id": str(ex.id), "status": ex.status}


@router.get("/reports/monthly")
async def report(director: DirectorOnly, year: Optional[int] = None, month: Optional[int] = None, rules=R, db: AsyncSession = Depends(get_db)):
    t = rules.today()
    return await yearend.monthly_report(db, rules, year or t.year, month or t.month)


@router.get("/reports/monthly.pdf")
async def report_pdf(director: DirectorOnly, year: Optional[int] = None, month: Optional[int] = None, rules=R, db: AsyncSession = Depends(get_db)):
    t = rules.today()
    rep = await yearend.monthly_report(db, rules, year or t.year, month or t.month)
    return Response(yearend.report_pdf(rep), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="monieking-coop-{rep["year"]}-{rep["month"]:02d}.pdf"'})


# ── money, jobs, go-live ──
@router.get("/money")
async def money(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    last = await ops.last_reconciliation(db)
    return {"position": await ops.money_position(db, rules), "pilot": await safety.pilot_status(db, rules),
            "last_reconciliation": {"ok": last.ok, "run_at": last.run_at.isoformat(), "checks": last.checks} if last else None,
            "jobs": await ops.job_status(db)}


@router.post("/money/reconcile")
async def money_reconcile(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    return await ops.run_reconciliation(db, rules)


@router.post("/jobs/run")
async def jobs_run(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    return await ops.run_jobs(db, rules, force=True)


@router.get("/go-live")
async def go_live(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    ck = await ops.go_live_checklist(db, rules)
    pend = (await db.execute(select(CoopRequest).where(CoopRequest.kind == "golive", CoopRequest.status == "pending"))).scalars().first()
    return {**ck, "request": await approvals.view(db, pend, director) if pend else None}


@router.post("/go-live/request")
async def go_live_request(director: DirectorOnly, rules=R, db: AsyncSession = Depends(get_db)):
    r = await approvals.open_request(db, rules, kind="golive", actor=director, reason="Switch on live funds")
    return await approvals.view(db, r, director)
