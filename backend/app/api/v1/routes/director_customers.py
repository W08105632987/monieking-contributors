"""Director's full view of one customer: contacts, next of kin, officer, disputes,
per-card detail (contributions, withdrawals, disputes) and direct messaging."""
import uuid
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.integrations.termii import send_sms
from app.models.card import ContributionCard, ContributionRecord
from app.models.dispute import Dispute
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.models.withdrawal import Withdrawal
from app.models.zone import Zone
from app.services import nin_vault, sms_service
from app.services.notification_service import send_notification
from app.services.user_service import resolve_user
from app.utils.audit import log_action

router = APIRouter(prefix="/director-customers", tags=["director-customers"])


class MessageBody(BaseModel):
    title: str = Field(default="Message from MonieKing", max_length=120)
    body: str = Field(min_length=1, max_length=1000)
    also_sms: bool = False


class KinBody(BaseModel):
    body: str = Field(min_length=1, max_length=600)


def _dispute_row(d: Dispute) -> dict:
    return {"id": str(d.id), "status": d.status.value if hasattr(d.status, "value") else str(d.status),
            "reason": d.reason.value if hasattr(d.reason, "value") else str(d.reason),
            "entity_type": d.entity_type.value if hasattr(d.entity_type, "value") else str(d.entity_type),
            "entity_id": str(d.entity_id) if d.entity_id else None,
            "created_at": d.created_at, "resolved_at": d.resolved_at}


async def _customer(db: AsyncSession, user_id: str) -> User:
    c = await resolve_user(db, user_id)
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    return c


@router.get("/{user_id}/nin")
async def reveal_nin(user_id: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Director-only: the customer's NIN, decrypted on demand. Every reveal is written to the audit log."""
    user = await resolve_user(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    nin = nin_vault.unseal(user.nin_encrypted)
    await log_action(db, actor_id=director.id, action="kyc.nin_viewed", entity_type="user", entity_id=str(user.id),
                     new_value={"found": bool(nin)})
    await db.commit()
    if not nin:
        return {"nin": None, "last4": user.nin_last4, "linked": bool(user.nin_linked),
                "message": "Verified earlier; the full NIN was not kept. It is saved the next time they verify or create their account number." if user.nin_linked else "No NIN yet."}
    return {"nin": nin, "last4": user.nin_last4, "linked": True, "message": None}


@router.get("/{user_id}/extra")
async def customer_extra(user_id: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    c = await _customer(db, user_id)
    zone = await db.get(Zone, c.zone_id) if c.zone_id else None
    officer = None
    if c.managing_officer_id:
        officer = await db.get(User, c.managing_officer_id)
    if not officer and c.zone_id:
        officer = (await db.execute(select(User).where(User.zone_id == c.zone_id, User.role == UserRole.OFFICER))).scalars().first()
    disputes = (await db.execute(select(Dispute).where(Dispute.raised_by == c.id).order_by(Dispute.created_at.desc()).limit(50))).scalars().all()
    return {
        "zone_name": zone.name if zone else None,
        "officer": {"id": str(officer.id), "full_name": officer.full_name, "phone_number": officer.phone_number} if officer else None,
        "is_manual_customer": bool(c.is_manual_customer),
        "bank": {"bank_name": c.bank_name, "account_number": c.account_number, "account_name": c.account_name},
        "next_of_kin": {"name": c.next_of_kin_name, "phone": c.next_of_kin_phone},
        "sms_alerts_enabled": bool(c.sms_alerts_enabled),
        "sms_accrued_kobo": c.sms_accrued_kobo or 0,
        "disputes": [_dispute_row(d) for d in disputes],
    }


@router.get("/{user_id}/cards/{card_id}")
async def card_detail(user_id: str, card_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    c = await _customer(db, user_id)
    card = await db.get(ContributionCard, card_id)
    if not card or card.owner_id != c.id:
        raise HTTPException(status_code=404, detail="Card not found for this customer")

    records = (await db.execute(
        select(ContributionRecord).where(ContributionRecord.card_id == card.id).order_by(ContributionRecord.created_at.asc())
    )).scalars().all()
    # one line per payment (a payment of several days shares a reference prefix "<ref>-D001")
    payments: "OrderedDict[str, dict]" = OrderedDict()
    for r in records:
        key = r.reference.rsplit("-D", 1)[0]
        p = payments.setdefault(key, {"reference": key, "days": 0, "amount_kobo": 0, "method": r.method.value if hasattr(r.method, "value") else str(r.method),
                                      "contributed_by": str(r.contributed_by), "created_at": r.created_at, "withdrawn_days": 0})
        p["days"] += 1
        p["amount_kobo"] += r.amount_kobo
        p["withdrawn_days"] += 1 if r.is_withdrawn else 0
    by_ids = {uuid.UUID(p["contributed_by"]) for p in payments.values()}
    names = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(by_ids)))).scalars().all()} if by_ids else {}
    pay_list = [{**p, "contributed_by_name": names.get(uuid.UUID(p["contributed_by"]))} for p in payments.values()]

    wds = (await db.execute(select(Withdrawal).where(Withdrawal.card_id == card.id).order_by(Withdrawal.requested_at.desc()))).scalars().all()
    wd_ids = [w.id for w in wds]
    disputes = (await db.execute(select(Dispute).where(Dispute.entity_id.in_(wd_ids)))).scalars().all() if wd_ids else []
    director_names = {}
    dir_ids = {w.claimed_by_director_id for w in wds if w.claimed_by_director_id}
    if dir_ids:
        director_names = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_(dir_ids)))).scalars().all()}

    days = len(records)
    return {
        "card": {"id": str(card.id), "card_number": card.card_number, "card_type": card.card_type.value, "rate_kobo": card.rate_kobo,
                 "status": card.status.value, "completion_status": card.completion_status.value if card.completion_status else None,
                 "total_days_contributed": days, "total_contributed_kobo": card.total_contributed_kobo,
                 "created_at": card.created_at, "completed_at": card.completed_at, "food_collected_at": card.food_collected_at},
        "payments": pay_list,
        "withdrawals": [{
            "id": str(w.id), "status": w.status.value, "requested_amount_kobo": w.requested_amount_kobo, "charge_kobo": w.charge_kobo,
            "sms_charge_kobo": w.sms_charge_kobo or 0, "net_payable_kobo": w.net_payable_kobo, "bank_name": w.bank_name,
            "account_number": w.account_number, "account_name": w.account_name, "requested_at": w.requested_at,
            "claimed_at": w.claimed_at, "processed_at": w.processed_at, "rejection_reason": w.rejection_reason,
            "handled_by": director_names.get(w.claimed_by_director_id),
        } for w in wds],
        "disputes": [_dispute_row(d) for d in disputes],
    }


@router.post("/{user_id}/message")
async def message_customer(user_id: str, body: MessageBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    c = await _customer(db, user_id)
    await send_notification(db, user_id=c.id, title=body.title, body=body.body, type=NotificationType.INFO)
    sms = False
    if body.also_sms and c.phone_number:
        sms = await send_sms(c.phone_number, sms_service.compact(f"MonieKing: {body.body}"))   # director SMS is free to the customer
    await log_action(db, actor_id=director.id, action="customer.message", entity_type="user", entity_id=str(c.id),
                     new_value={"sms": sms})
    return {"ok": True, "sms_sent": sms}


@router.post("/{user_id}/message-kin")
async def message_kin(user_id: str, body: KinBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    c = await _customer(db, user_id)
    if not c.next_of_kin_phone:
        raise HTTPException(status_code=400, detail="This customer has no next-of-kin phone number")
    ok = await send_sms(c.next_of_kin_phone, sms_service.compact(f"MonieKing: {body.body}"))
    await log_action(db, actor_id=director.id, action="customer.message_kin", entity_type="user", entity_id=str(c.id), new_value={"sent": ok})
    if not ok:
        raise HTTPException(status_code=502, detail="The SMS could not be sent right now")
    return {"ok": True}
