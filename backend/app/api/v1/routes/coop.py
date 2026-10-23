"""Cooperative: member-facing endpoints (preview, test money only)."""
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import insights, ledger, logic, ops, safety, service, settings_store, yearend
from app.coop.safety import AuthBody
from app.coop.errors import CoopError
from app.coop.models import CoopGuarantee, CoopLoan, CoopMember, CoopMemberBank, CoopWithdrawal
from app.coop.settings_store import Rules
from app.core.database import get_db
from app.core.dependencies import CurrentUser
from app.models.user import User

router = APIRouter(prefix="/coop", tags=["coop"])


async def _ctx(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    rules = await settings_store.load_rules(db)
    if not await service.has_access(db, rules, user):
        raise CoopError("The cooperative is not open for you yet", 403, "no_access")
    return rules


Ctx = Depends(_ctx)


def _k(v: int) -> int:
    return int(v)


class JoinBody(BaseModel):
    amount_kobo: int = Field(gt=0)
    nin_bypass: bool = False


class AmountBody(BaseModel):
    amount_kobo: int = Field(gt=0)


class WithdrawBody(AmountBody):
    confirm: bool = False
    auth: Optional[AuthBody] = None


class RepayBody(AmountBody):
    source: Optional[str] = None
    auth: Optional[AuthBody] = None


class AuthOnly(BaseModel):
    auth: Optional[AuthBody] = None


class LoanBody(BaseModel):
    amount_kobo: int = Field(gt=0)
    term_months: int = Field(gt=0)
    purpose: Optional[str] = None


class InviteBody(BaseModel):
    guarantor_member_id: uuid.UUID
    amount_kobo: int = Field(gt=0)


class SignBody(BaseModel):
    ticks: dict
    typed_name: str


class PoolBody(BaseModel):
    listed: bool
    offer_kobo: int = Field(ge=0, default=0)
    whatsapp_ok: bool = False
    note: Optional[str] = None


async def _summary(db, rules, m: CoopMember) -> dict:
    await db.flush()
    s = await insights.stats(db, rules, m)
    return {"member_id": str(m.id), "card_no": m.card_no, "status": m.status, **s, "pool_listed": m.pool_listed,
            "pool_offer_kobo": m.pool_offer_kobo, "pool_whatsapp_ok": m.pool_whatsapp_ok, "pool_note": m.pool_note,
            "nin_bypassed": m.nin_bypassed, "disqualified_this_year": m.disqualified_year == logic.accounting_year(rules.today()),
            "balances": await service.itemised(db, rules, m), "fee_paid": bool(m.fee_paid_at), "next_of_kin": m.next_of_kin,
            "has_bank": (await db.get(CoopMemberBank, m.id)) is not None}


@router.get("/status")
async def status(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    rules = await settings_store.load_rules(db)
    access = await service.has_access(db, rules, user)
    out = {"enabled": bool(rules.get("coop_enabled")), "access": access, "test_mode": not rules.get("coop_live_funds"), "is_member": False,
           "now": rules.now().isoformat(), "clock_offset_days": int(rules.get("test_clock_offset_days"))}
    if not access:
        return out
    out["rules"] = settings_store.public_summary(rules)
    out["pilot"] = await safety.pilot_status(db, rules)
    m = await service.member_of(db, user)
    if m and m.status == "active":
        await ops.kick_jobs(db, rules)
        out["is_member"] = True
        out["member"] = await _summary(db, rules, m)
        loan = (await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status.in_(service.ACTIVE_LOAN)).order_by(CoopLoan.created_at.desc()))).scalars().first()
        out["active_loan"] = await _loan_card(db, rules, loan) if loan else None
        from app.coop.models import CoopRequest
        out["pending_consents"] = sum(1 for r in (await db.execute(select(CoopRequest).where(CoopRequest.status == "pending", CoopRequest.kind == "restructure"))).scalars().all()
                                      for c in r.consents if c["member_id"] == str(m.id) and c["status"] == "pending")
        out["offers_waiting"] = len((await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status == "awaiting_acceptance"))).scalars().all())
        out["pending_invites"] = len((await db.execute(select(CoopGuarantee).where(CoopGuarantee.guarantor_id == m.id, CoopGuarantee.status.in_(service.LIVE_INVITE)))).scalars().all())
    return out


@router.post("/join")
async def join(body: JoinBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db),
               idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")):
    async def run():
        m = await service.join(db, rules, user, body.amount_kobo, body.nin_bypass)
        return await _summary(db, rules, m)
    return await safety.idempotent(db, user, idempotency_key, "join", run)


@router.get("/me")
async def me(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return {**await _summary(db, rules, m), "history": await insights.contribution_history(db, m.id, 50)}


@router.post("/contributions")
async def contribute(body: AmountBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db),
                     idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")):
    m = await service.require_member(db, user)

    async def run():
        await service.contribute(db, rules, m, body.amount_kobo, user.id)
        return await _summary(db, rules, m)
    return await safety.idempotent(db, user, idempotency_key, "contribute", run)


@router.post("/withdrawals")
async def withdraw(body: WithdrawBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db),
                   idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")):
    m = await service.require_member(db, user)
    request_mode = service.withdraw_is_request(rules)
    if not body.confirm:
        pv = await service.withdraw_preview(db, rules, m, body.amount_kobo)
        b = await db.get(CoopMemberBank, m.id) if request_mode else None
        return {"preview": True, "step_up": safety.step_up_needed(rules, "member"), "mode": rules.get("withdraw_mode"),
                "account": ({"bank_name": b.bank_name, "account_number": b.account_number, "account_name": b.account_name} if b else None),
                "needs_bank": bool(request_mode and b is None), **pv}

    async def run():
        await safety.require_step_up(db, rules, user, body.auth, "member")
        if request_mode:
            w = await service.request_withdrawal(db, rules, m, body.amount_kobo, user.id)
            return {"preview": False, "mode": "director_payout", "withdrawal": service.withdrawal_view(w),
                    "amount_kobo": w.amount_kobo, "charge_kobo": w.charge_kobo, "you_receive_kobo": w.net_kobo,
                    "member": await _summary(db, rules, m)}
        pv = await service.withdraw(db, rules, m, body.amount_kobo, user.id)
        return {"preview": False, "mode": "instant", **pv, "member": await _summary(db, rules, m)}
    return await safety.idempotent(db, user, idempotency_key, "withdraw", run)


@router.get("/withdrawals")
async def my_withdrawals(user: CurrentUser, limit: int = Query(10, ge=1, le=50), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    total = (await db.execute(select(func.count()).select_from(CoopWithdrawal).where(CoopWithdrawal.member_id == m.id))).scalar_one()
    rows = (await db.execute(select(CoopWithdrawal).where(CoopWithdrawal.member_id == m.id)
                             .order_by(CoopWithdrawal.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return {"total": total, "items": [service.withdrawal_view(w) for w in rows]}


@router.post("/withdrawals/{wid}/cancel")
async def cancel_withdrawal(wid: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    w = await service.cancel_withdrawal(db, rules, wid, user)
    return service.withdrawal_view(w)


@router.get("/transparency")
async def transparency(user: CurrentUser, range: str = Query("30d"), start: Optional[date] = None, end: Optional[date] = None,
                       rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    await service.require_member(db, user)
    today = rules.today()
    if range == "7d":
        s, e = today - timedelta(days=6), today
    elif range == "30d":
        s, e = today - timedelta(days=29), today
    elif range == "year":
        s, e = date(logic.accounting_year(today), 1, 1), today
    elif range == "custom" and start and end:
        s, e = start, end
    else:
        raise CoopError("Choose 7d, 30d, year, or a custom start and end date")
    return await insights.transparency(db, rules, s, e)


@router.get("/settings/public")
async def public_settings(user: CurrentUser, rules: Rules = Ctx):
    return settings_store.public_summary(rules)


# ── loans ──
async def _loan_card(db, rules, loan: CoopLoan) -> dict:
    await db.flush()
    t = await service.guarantee_totals(db, loan)
    pos = service.position(loan, rules.today())
    return {"id": str(loan.id), "loan_no": loan.loan_no, "status": loan.status, "principal_kobo": loan.principal_kobo,
            "interest_kobo": loan.interest_kobo, "total_kobo": loan.total_kobo, "term_months": loan.term_months,
            "rate_bps": loan.rate_bps, "purpose": loan.purpose, "created_at": loan.created_at.isoformat(),
            "expires_at": loan.expires_at.isoformat() if loan.expires_at else None, "due_date": loan.due_date.isoformat() if loan.due_date else None,
            "guaranteed_kobo": t["signed"], "pending_kobo": t["pending"], "cover_needed_kobo": t["need"],
            "total_due_kobo": pos["total_due_kobo"], "overdue": pos["overdue"], "decision_note": loan.decision_note,
            "fee_kobo": loan.offer_fee_kobo, "net_payout_kobo": loan.net_payout_kobo, "payout_status": loan.payout_status,
            "offer_expires_at": loan.offer_expires_at.isoformat() if loan.offer_expires_at else None, "repay_source": loan.repay_source,
            "due_now_kobo": pos["due_now_kobo"]}


async def _loan_detail(db, rules, loan: CoopLoan) -> dict:
    await db.flush()
    card = await _loan_card(db, rules, loan)
    pos = service.position(loan, rules.today())
    gs = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.loan_id == loan.id).order_by(CoopGuarantee.invited_at))).scalars().all()
    guarantors = []
    for g in gs:
        gm = await db.get(CoopMember, g.guarantor_id)
        gu = await db.get(User, gm.user_id)
        guarantors.append({"guarantee_id": str(g.id), "member_id": str(gm.id), "name": gu.full_name, "avatar_url": gu.avatar_url, "amount_kobo": g.amount_kobo,
                           "status": g.status, "signed_at": g.signed_at.isoformat() if g.signed_at else None,
                           "expires_at": g.expires_at.isoformat()})
    approved = loan.status not in ("seeking_guarantors", "awaiting_approval", "expired", "cancelled", "rejected")
    steps = [{"key": "requested", "done": True}, {"key": "guaranteed", "done": loan.status not in ("seeking_guarantors", "expired", "cancelled")},
             {"key": "approved", "done": approved}, {"key": "accepted", "done": loan.accepted_at is not None or loan.status in OWING_PLUS},
             {"key": "paid_out", "done": loan.paid_out_at is not None or loan.status in ("repaying", "awaiting_final_release", "repaid")},
             {"key": "repaid", "done": loan.status in ("repaid", "awaiting_final_release")}]
    bank = await db.get(CoopMemberBank, loan.member_id)
    return {**card, "flags": loan.flags, "schedule": pos["schedule"], "next_instalment": pos["next"], "overdue_days": pos["overdue_days"],
            "accrued_charge_kobo": pos["accrued_charge_kobo"], "charges_due_kobo": pos["charges_due_kobo"],
            "charges_paid_kobo": pos["charges_paid_kobo"], "interest_due_kobo": pos["interest_due_kobo"],
            "principal_due_kobo": pos["principal_due_kobo"], "principal_paid_kobo": loan.principal_paid_kobo,
            "interest_paid_kobo": loan.interest_paid_kobo, "guarantors": guarantors, "steps": steps,
            "overdue_daily_bps": loan.overdue_daily_bps, "overdue_cap_pct": loan.overdue_cap_pct,
            "still_needed_kobo": t_need(card), "offer": service.offer_view(loan) if loan.status == "awaiting_acceptance" else None,
            "payout": {"status": loan.payout_status, "hold_reason": loan.payout_hold_reason, "reference": loan.payout_ref,
                       "paid_at": loan.paid_out_at.isoformat() if loan.paid_out_at else None, "account": loan.payout_account,
                       "bank_on_file": bank is not None}, "allowed_sources": service.allowed_sources(loan), "waived_kobo": loan.waived_kobo,
            "due_now_kobo": pos["due_now_kobo"], "interest_breakdown": await service.interest_breakdown(db, rules, loan),
            "restructured": loan.restructured_count, "written_off_kobo": loan.written_off_kobo, "start_date": loan.start_date.isoformat() if loan.start_date else None,
            "free_kobo": await ledger.free_funds(db, loan.member_id), "step_up": safety.step_up_needed(rules, "member")}


OWING_PLUS = ("awaiting_payout", "repaying", "awaiting_final_release", "repaid", "written_off")


def t_need(card) -> int:
    return max(card["cover_needed_kobo"] - card["guaranteed_kobo"], 0)


@router.get("/loans/preview")
async def loan_preview(amount_kobo: int, term_months: int, user: CurrentUser, rules: Rules = Ctx):
    if amount_kobo <= 0 or term_months < 1 or term_months > int(rules.get("loan_term_months")):
        raise CoopError(f"Choose a term of 1 to {rules.get('loan_term_months')} months and an amount above zero")
    pv = service.instalment_preview(amount_kobo, term_months, int(rules.get("loan_rate_bps")), rules.today())
    fee = service.transfer_fee(rules, amount_kobo)
    return {**pv, "fee_kobo": fee, "net_payout_kobo": amount_kobo - fee, "fee_payer": rules.get("transfer_fee_payer"),
            "rate_bps": int(rules.get("loan_rate_bps")), "cover_needed_kobo": logic.cover_required(amount_kobo, int(rules.get("cover_pct"))),
            "min_kobo": int(rules.get("loan_min_kobo")), "max_kobo": int(rules.get("loan_max_kobo")),
            "note": "Full interest is payable even if you repay early."}


@router.post("/loans")
async def request_loan(body: LoanBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    loan = await service.create_loan(db, rules, m, user, body.amount_kobo, body.term_months, body.purpose)
    return await _loan_detail(db, rules, loan)


@router.get("/loans")
async def my_loans(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    await service.sweep(db, rules)
    ls = (await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id).order_by(CoopLoan.created_at.desc()))).scalars().all()
    return [await _loan_card(db, rules, l) for l in ls]


async def _my_loan(db, user, loan_id) -> CoopLoan:
    m = await service.require_member(db, user)
    loan = await db.get(CoopLoan, loan_id)
    if not loan or loan.member_id != m.id:
        raise CoopError("Loan not found", 404)
    return loan


@router.get("/loans/{loan_id}")
async def loan_detail(loan_id: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    await service.sweep(db, rules)
    loan = await _my_loan(db, user, loan_id)
    return await _loan_detail(db, rules, loan)


@router.post("/loans/{loan_id}/cancel")
async def cancel(loan_id: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    loan = await _my_loan(db, user, loan_id)
    await service.cancel_loan(db, rules, loan, user)
    return await _loan_detail(db, rules, loan)


@router.post("/loans/{loan_id}/invites")
async def invite(loan_id: uuid.UUID, body: InviteBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    loan = await _my_loan(db, user, loan_id)
    gm = await db.get(CoopMember, body.guarantor_member_id)
    if not gm:
        raise CoopError("Guarantor not found", 404)
    await service.invite(db, rules, loan, user, gm, body.amount_kobo)
    return await _loan_detail(db, rules, loan)


@router.post("/loans/{loan_id}/repay")
async def repay(loan_id: uuid.UUID, body: RepayBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db),
                idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")):
    async def run():
        await safety.require_step_up(db, rules, user, body.auth, "member", secret="pin")
        res = await service.repay(db, rules, loan_id, user, body.amount_kobo, body.source)
        loan = await db.get(CoopLoan, loan_id)
        return {**res, "loan": await _loan_detail(db, rules, loan)}
    return await safety.idempotent(db, user, idempotency_key, "repay", run)


@router.post("/loans/{loan_id}/accept")
async def accept_offer(loan_id: uuid.UUID, body: AuthOnly, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db),
                       idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")):
    async def run():
        await safety.require_step_up(db, rules, user, body.auth, "member", secret="pin")
        loan = await service.accept_offer(db, rules, loan_id, user)
        return await _loan_detail(db, rules, loan)
    return await safety.idempotent(db, user, idempotency_key, "accept", run)


@router.post("/loans/{loan_id}/decline-offer")
async def decline_offer(loan_id: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    loan = await service.decline_offer(db, rules, loan_id, user)
    return await _loan_detail(db, rules, loan)


# ── guarantor side ──
@router.get("/invites")
async def invites(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    await service.sweep(db, rules)
    gs = (await db.execute(select(CoopGuarantee).where(CoopGuarantee.guarantor_id == m.id).order_by(CoopGuarantee.invited_at.desc()))).scalars().all()
    out = []
    for g in gs:
        loan = await db.get(CoopLoan, g.loan_id)
        bm = await db.get(CoopMember, loan.member_id)
        bu = await db.get(User, bm.user_id)
        out.append({"guarantee_id": str(g.id), "status": g.status, "amount_kobo": g.amount_kobo, "loan_no": loan.loan_no,
                    "loan_status": loan.status, "principal_kobo": loan.principal_kobo, "borrower": bu.full_name, "borrower_avatar_url": bu.avatar_url,
                    "borrower_member_id": str(bm.id), "invited_at": g.invited_at.isoformat(), "expires_at": g.expires_at.isoformat(),
                    "due_date": loan.due_date.isoformat() if loan.due_date else None})
    return out


async def _my_guarantee(db, user, gid) -> CoopGuarantee:
    g = await db.get(CoopGuarantee, gid)
    m = await service.require_member(db, user)
    if not g or g.guarantor_id != m.id:
        raise CoopError("Not found", 404)
    return g


@router.get("/invites/{gid}")
async def open_invite(gid: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    g = await _my_guarantee(db, user, gid)
    return await service.open_invite(db, rules, g, user)


@router.post("/invites/{gid}/sign")
async def sign(gid: uuid.UUID, body: SignBody, request: Request, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    g = await _my_guarantee(db, user, gid)
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "").split(",")[0].strip()
    await service.sign(db, rules, g, user, body.ticks, body.typed_name, ip, request.headers.get("user-agent", ""))
    return await service.open_invite(db, rules, g, user)


@router.post("/invites/{gid}/decline")
async def decline(gid: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    g = await _my_guarantee(db, user, gid)
    await service.decline(db, rules, g, user)
    return {"ok": True}


# ── pool / profiles / dividend ──
@router.get("/pool")
async def pool(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return await insights.pool_list(db, rules, m)


@router.get("/pool/me")
async def pool_me(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    s = await insights.stats(db, rules, m)
    return {"listed": m.pool_listed, "offer_kobo": m.pool_offer_kobo, "whatsapp_ok": m.pool_whatsapp_ok, "note": m.pool_note,
            "free_kobo": s["free_kobo"], "min_kobo": int(rules.get("guarantee_min_kobo")), "max_kobo": int(rules.get("guarantee_max_kobo"))}


@router.put("/pool/me")
async def pool_set(body: PoolBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    if body.listed:
        if not (int(rules.get("guarantee_min_kobo")) <= body.offer_kobo <= int(rules.get("guarantee_max_kobo"))):
            raise CoopError(f"Your offer must be between {service.naira(int(rules.get('guarantee_min_kobo')))} and {service.naira(int(rules.get('guarantee_max_kobo')))}")
        if not body.whatsapp_ok:
            raise CoopError("Borrowers reach you through WhatsApp, so please allow the WhatsApp link to list yourself")
    m.pool_listed, m.pool_offer_kobo, m.pool_whatsapp_ok = body.listed, body.offer_kobo if body.listed else 0, body.whatsapp_ok
    m.pool_note = (body.note or "").strip()[:300] or None
    return await pool_me(user, rules, db)


@router.get("/members/{member_id}/profile")
async def member_profile(member_id: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    viewer = await service.member_of(db, user)
    target = await db.get(CoopMember, member_id)
    if not target:
        raise CoopError("Member not found", 404)
    return await insights.profile(db, rules, user, viewer, target)


@router.get("/dividend")
async def dividend(user: CurrentUser, extra_kobo: int = 0, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return await insights.dividend(db, rules, m, max(extra_kobo, 0))
