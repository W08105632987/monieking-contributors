"""Affiliated-officer earnings: the officer's own earnings page and payouts, and the director's control of it all."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly, invalidate_user_cache
from app.models.notification import NotificationType
from app.models.officer_earnings import OfficerCommission, OfficerPayout
from app.models.user import User, UserRole
from app.services import officer_earnings_service as svc
from app.services.notification_service import send_notification
from app.services.pin_service import check_pin
from app.services.user_service import resolve_user
from app.utils.audit import log_action

router = APIRouter(prefix="/officer-earnings", tags=["officer-earnings"])

NO_BANK = "Bank details have not been set for payout. Go to your profile and set your bank details first."


def _commission_row(c: OfficerCommission, names: dict) -> dict:
    return {"id": str(c.id), "customer_name": names.get(c.customer_id, "Customer"), "company_charge_kobo": c.company_charge_kobo,
            "percent": c.percent, "amount_kobo": c.amount_kobo, "created_at": c.created_at.isoformat()}


def _payout_row(p: OfficerPayout, officer_name: str | None = None) -> dict:
    return {"id": str(p.id), "officer_id": str(p.officer_id), "officer_name": officer_name, "amount_kobo": p.amount_kobo,
            "bank_name": p.bank_name, "account_number": p.account_number, "account_name": p.account_name, "status": p.status,
            "rejection_reason": p.rejection_reason, "requested_at": p.requested_at.isoformat(),
            "processed_at": p.processed_at.isoformat() if p.processed_at else None}


async def _names(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all()
    return {i: n for i, n in rows}


async def _summary(db: AsyncSession, officer: User) -> dict:
    bal = await svc.balance(db, officer.id)
    pct = await svc.percent_for(db, officer)
    customers = (await db.execute(select(func.count(User.id)).where(User.commission_officer_id == officer.id))).scalar_one()
    commissions = (await db.execute(select(OfficerCommission).where(OfficerCommission.officer_id == officer.id)
                                    .order_by(OfficerCommission.created_at.desc()).limit(50))).scalars().all()
    payouts = (await db.execute(select(OfficerPayout).where(OfficerPayout.officer_id == officer.id)
                                .order_by(OfficerPayout.requested_at.desc()).limit(50))).scalars().all()
    names = await _names(db, {c.customer_id for c in commissions})
    return {**bal, "percent": pct, "own_percent": officer.officer_commission_percent, "customers": int(customers),
            "has_bank_details": bool(officer.bank_name and officer.account_number and officer.account_name),
            "commissions": [_commission_row(c, names) for c in commissions], "payouts": [_payout_row(p) for p in payouts]}


# ── The officer's own side ─────────────────────────────────────────────
async def _affiliated_me(db: AsyncSession, current_user: User) -> User:
    user = await db.get(User, current_user.id)
    if not svc.is_affiliated(user):
        raise HTTPException(status_code=403, detail="This account does not earn commission.")
    return user


@router.get("/me")
async def my_earnings(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    return await _summary(db, await _affiliated_me(db, current_user))


class PayoutBody(BaseModel):
    amount_naira: float | None = Field(default=None, gt=0, le=100_000_000)   # empty = everything available
    pin: str


@router.post("/me/payout")
async def request_payout(body: PayoutBody, current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    officer = await _affiliated_me(db, current_user)
    # Same rule as a customer withdrawal: the bank details come WITH the request. None on file = it fails.
    if not (officer.bank_name and officer.account_number and officer.account_name):
        raise HTTPException(status_code=400, detail=NO_BANK)
    await check_pin(db, officer, body.pin, need_kyc=False)
    bal = await svc.balance(db, officer.id)
    kobo = int(round(body.amount_naira * 100)) if body.amount_naira else bal["available_kobo"]
    if kobo <= 0 or kobo > bal["available_kobo"]:
        raise HTTPException(status_code=400, detail=f"You can request up to ₦{bal['available_kobo'] / 100:,.2f}.")
    payout = OfficerPayout(officer_id=officer.id, amount_kobo=kobo, bank_name=officer.bank_name,
                           account_number=officer.account_number, account_name=officer.account_name)
    db.add(payout)
    await db.flush()
    await log_action(db, actor_id=officer.id, action="officer_payout.requested", entity_type="officer_payout", entity_id=str(payout.id),
                     new_value={"amount_kobo": kobo})
    return _payout_row(payout)


@router.post("/me/welcome-seen")
async def welcome_seen(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, current_user.id)
    if user and not user.officer_welcome_seen_at:
        user.officer_welcome_seen_at = datetime.now(timezone.utc)
        await db.flush()
        await invalidate_user_cache(str(user.id))
    return {"ok": True}


# ── The director's side ────────────────────────────────────────────────
@router.get("/unclassified")
async def unclassified_officers(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Officers the director has not yet chosen 'salary' or 'affiliated' for."""
    rows = (await db.execute(select(User).where(User.role == UserRole.OFFICER, User.officer_type.is_(None))
                             .order_by(User.full_name))).scalars().all()
    return [{"id": str(o.id), "full_name": o.full_name, "phone_number": o.phone_number} for o in rows]


@router.get("/officers/{officer_id}")
async def officer_earnings_for_director(officer_id: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    officer = await resolve_user(db, officer_id)
    if not officer or officer.role != UserRole.OFFICER:
        raise HTTPException(status_code=404, detail="Officer not found")
    base = {"id": str(officer.id), "officer_type": officer.officer_type}
    if not svc.is_affiliated(officer):
        return base
    return {**base, **(await _summary(db, officer))}


class TypeBody(BaseModel):
    officer_type: str = Field(pattern="^(salary|affiliated)$")
    commission_percent: int | None = Field(default=None, ge=0, le=100)   # affiliated only; empty = global setting
    pin: str


@router.patch("/officers/{officer_id}/type")
async def set_officer_type(officer_id: str, body: TypeBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    officer = await resolve_user(db, officer_id)
    if not officer or officer.role != UserRole.OFFICER:
        raise HTTPException(status_code=404, detail="Officer not found")
    await check_pin(db, director, body.pin)
    if officer.officer_type == "affiliated" and body.officer_type == "salary":
        bal = await svc.balance(db, officer.id)
        if bal["available_kobo"] > 0 or bal["pending_payout_kobo"] > 0:
            raise HTTPException(status_code=409, detail=(
                f"This officer still has ₦{(bal['available_kobo'] + bal['pending_payout_kobo']) / 100:,.2f} of unpaid commission. "
                "Pay it out (or reject the requests) before making them a salary officer."))
    before = {"officer_type": officer.officer_type, "percent": officer.officer_commission_percent}
    officer.officer_type = body.officer_type
    officer.officer_commission_percent = body.commission_percent if body.officer_type == "affiliated" else None
    await log_action(db, actor_id=director.id, action="officer.type_set", entity_type="user", entity_id=str(officer.id),
                     old_value=before, new_value={"officer_type": officer.officer_type, "percent": officer.officer_commission_percent})
    await db.flush()
    await invalidate_user_cache(str(officer.id))
    return {"officer_type": officer.officer_type, "commission_percent": officer.officer_commission_percent}


@router.get("/officers/{officer_id}/customers")
async def commission_customers(officer_id: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    officer = await resolve_user(db, officer_id)
    if not officer or officer.role != UserRole.OFFICER:
        raise HTTPException(status_code=404, detail="Officer not found")
    rows = (await db.execute(select(User).where(User.commission_officer_id == officer.id).order_by(User.full_name).limit(500))).scalars().all()
    return [{"id": str(c.id), "full_name": c.full_name, "phone_number": c.phone_number} for c in rows]


class AssignBody(BaseModel):
    officer_id: uuid.UUID | None = None   # None = nobody earns commission on this customer
    pin: str


@router.put("/customers/{customer_id}/commission-officer")
async def assign_commission_officer(customer_id: str, body: AssignBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """The director decides, per customer, who (if anyone) earns commission on their withdrawals."""
    await check_pin(db, director, body.pin)
    customer = await resolve_user(db, customer_id)
    if not customer or customer.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=404, detail="Customer not found")
    officer = None
    if body.officer_id:
        officer = await db.get(User, body.officer_id)
        if not svc.is_affiliated(officer):
            raise HTTPException(status_code=400, detail="Commission can only go to an affiliated officer.")
    before = str(customer.commission_officer_id) if customer.commission_officer_id else None
    customer.commission_officer_id = officer.id if officer else None
    await log_action(db, actor_id=director.id, action="customer.commission_officer_set", entity_type="user", entity_id=str(customer.id),
                     old_value={"officer_id": before}, new_value={"officer_id": str(officer.id) if officer else None})
    await db.flush()
    return {"commission_officer_id": str(officer.id) if officer else None, "commission_officer_name": officer.full_name if officer else None}


@router.get("/customers/{customer_id}/commission-officer")
async def get_commission_officer(customer_id: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    customer = await resolve_user(db, customer_id)
    if not customer or customer.role != UserRole.CUSTOMER:
        raise HTTPException(status_code=404, detail="Customer not found")
    officer = await db.get(User, customer.commission_officer_id) if customer.commission_officer_id else None
    affiliated = (await db.execute(select(User).where(User.role == UserRole.OFFICER, User.officer_type == "affiliated").order_by(User.full_name))).scalars().all()
    return {"commission_officer_id": str(officer.id) if officer else None, "commission_officer_name": officer.full_name if officer else None,
            "affiliated_officers": [{"id": str(o.id), "full_name": o.full_name} for o in affiliated]}


@router.get("/payouts")
async def list_payouts(director: DirectorOnly, status: str = "pending", db: AsyncSession = Depends(get_db)):
    q = select(OfficerPayout).order_by(OfficerPayout.requested_at.desc()).limit(200)
    if status in ("pending", "paid", "rejected"):
        q = q.where(OfficerPayout.status == status)
    rows = (await db.execute(q)).scalars().all()
    names = await _names(db, {p.officer_id for p in rows})
    return [_payout_row(p, names.get(p.officer_id)) for p in rows]


async def _pending_payout(db: AsyncSession, payout_id: uuid.UUID) -> OfficerPayout:
    p = (await db.execute(select(OfficerPayout).where(OfficerPayout.id == payout_id).with_for_update())).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Payout not found")
    if p.status != "pending":
        raise HTTPException(status_code=409, detail=f"This payout is already {p.status}.")
    return p


@router.post("/payouts/{payout_id}/paid")
async def mark_payout_paid(payout_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    p = await _pending_payout(db, payout_id)
    p.status, p.processed_by, p.processed_at = "paid", director.id, datetime.now(timezone.utc)
    await log_action(db, actor_id=director.id, action="officer_payout.paid", entity_type="officer_payout", entity_id=str(p.id), new_value={"amount_kobo": p.amount_kobo})
    await send_notification(db, user_id=p.officer_id, title="Payout sent ✓",
                            body=f"₦{p.amount_kobo / 100:,.2f} was sent to your account {p.account_number}.",
                            type=NotificationType.SUCCESS, related_entity_id=p.id, deep_link_url="/officer/earnings")
    await db.flush()
    return _payout_row(p)


class RejectBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/payouts/{payout_id}/reject")
async def reject_payout(payout_id: uuid.UUID, body: RejectBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    p = await _pending_payout(db, payout_id)
    p.status, p.rejection_reason, p.processed_by, p.processed_at = "rejected", body.reason.strip(), director.id, datetime.now(timezone.utc)
    await log_action(db, actor_id=director.id, action="officer_payout.rejected", entity_type="officer_payout", entity_id=str(p.id),
                     new_value={"amount_kobo": p.amount_kobo, "reason": p.rejection_reason})
    await send_notification(db, user_id=p.officer_id, title="Payout not sent",
                            body=f"Your payout request of ₦{p.amount_kobo / 100:,.2f} was rejected: {p.rejection_reason}. The money is back in your earnings.",
                            type=NotificationType.WARNING, related_entity_id=p.id, deep_link_url="/officer/earnings")
    await db.flush()
    return _payout_row(p)
