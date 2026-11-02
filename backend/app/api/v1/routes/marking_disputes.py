"""Wrong-marking disputes.

An officer who marked a card wrongly (more days than the customer paid for, or the wrong card) raises a dispute.
It lands in the directors' queue and uses the normal dispute conversation. The director can call the customer, then
correct the card: remove the last N days, or every day that officer marked. The days really disappear from the card, the
card totals are recalculated and the officer's wallet is refunded for what was taken from it.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin
from app.models.card import CardCompletionStatus, CardStatus, ContributionCard, ContributionMethod, ContributionRecord
from app.models.dispute import Dispute, DisputeEntityType, DisputeMessage, DisputeReason, DisputeStatus
from app.models.marking_correction import MarkingCorrection
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.models.wallet import TxCategory
from app.services.notification_service import send_notification
from app.services.wallet_service import credit_wallet, get_or_create_wallet
from app.utils.audit import log_action
from app.core.security import generate_reference

router = APIRouter(prefix="/disputes", tags=["marking-disputes"])
LOOKBACK_NOTE = "Marking correction"


class RaiseMarking(BaseModel):
    card_id: uuid.UUID
    reason: DisputeReason
    message: str = Field(min_length=10, max_length=1000)
    days_wrong: int | None = Field(default=None, ge=1, le=372)


@router.post("/marking", status_code=201)
async def raise_marking_dispute(body: RaiseMarking, officer: CurrentUser, db: AsyncSession = Depends(get_db), request: Request = None):
    if officer.role != UserRole.OFFICER:
        raise HTTPException(403, "Only the officer who marked a card can dispute a marking.")
    if body.reason not in (DisputeReason.OVER_MARKED, DisputeReason.WRONG_CARD_MARKED):
        raise HTTPException(400, "Choose 'over marked' or 'wrong card marked'.")
    card = await db.get(ContributionCard, body.card_id)
    if not card:
        raise HTTPException(404, "Card not found")
    mine = (await db.execute(select(ContributionRecord).where(ContributionRecord.card_id == card.id, ContributionRecord.contributed_by == officer.id)
                             .order_by(ContributionRecord.created_at.desc()).limit(1))).scalar_one_or_none()
    if not mine:
        raise HTTPException(403, "You have not marked any days on this card, so you cannot dispute its marking.")
    if (await db.execute(select(Dispute.id).where(Dispute.entity_type == DisputeEntityType.CONTRIBUTION_MARKING, Dispute.entity_id == card.id,
                                                  Dispute.status != DisputeStatus.RESOLVED))).first():
        raise HTTPException(409, "There is already an open marking dispute for this card.")
    owner = await db.get(User, card.owner_id)
    note = f" ({body.days_wrong} day(s) are wrong)" if body.days_wrong else ""
    d = Dispute(raised_by=officer.id, entity_type=DisputeEntityType.CONTRIBUTION_MARKING, entity_id=card.id, reason=body.reason,
                status=DisputeStatus.OPEN, assigned_to=None, zone_id=None, marking_ref=mine.reference.rsplit("-D", 1)[0])
    db.add(d)
    await db.flush()
    db.add(DisputeMessage(dispute_id=d.id, sender_id=officer.id,
                          message=f"[Marking dispute{note}] Card #{card.card_number} of {owner.full_name if owner else 'customer'}. {body.message.strip()}"))
    await db.flush()
    await log_action(db, actor_id=officer.id, action="dispute.marking_raised", entity_type="dispute", entity_id=str(d.id),
                     new_value={"card_id": str(card.id), "reason": body.reason.value, "days_wrong": body.days_wrong},
                     ip_address=request.client.host if request and request.client else None)
    directors = (await db.execute(select(User.id).where(User.role.in_([UserRole.DIRECTOR, UserRole.ADMIN])))).scalars().all()
    for uid in directors:
        await send_notification(db, user_id=uid, type=NotificationType.WARNING, title="Wrong marking reported",
                                body=f"{officer.full_name} says card #{card.card_number} was marked wrongly. Call the customer, then correct the card.",
                                related_entity_id=d.id, deep_link_url=f"/disputes/{d.id}")
    return {"id": str(d.id)}


async def _get_marking(db: AsyncSession, dispute_id: uuid.UUID, user: User) -> Dispute:
    d = await db.get(Dispute, dispute_id)
    if not d or d.entity_type != DisputeEntityType.CONTRIBUTION_MARKING:
        raise HTTPException(404, "Marking dispute not found")
    if user.role not in (UserRole.DIRECTOR, UserRole.ADMIN) and d.raised_by != user.id:
        raise HTTPException(403, "Access denied")
    return d


@router.get("/{dispute_id}/marking")
async def marking_context(dispute_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Everything a director needs to judge it: the card, every day on it (who marked it, when) and the customer's phone."""
    d = await _get_marking(db, dispute_id, user)
    card = await db.get(ContributionCard, d.entity_id)
    if not card:
        raise HTTPException(404, "Card not found")
    is_director = user.role in (UserRole.DIRECTOR, UserRole.ADMIN)
    owner = await db.get(User, card.owner_id)
    officer = await db.get(User, d.raised_by)
    recs = (await db.execute(select(ContributionRecord).where(ContributionRecord.card_id == card.id)
                             .order_by(ContributionRecord.logical_month, ContributionRecord.logical_day))).scalars().all()
    names = {u.id: u.full_name for u in (await db.execute(select(User).where(User.id.in_({r.contributed_by for r in recs} or {d.raised_by})))).scalars().all()}
    days = [{"slot": i + 1, "month": r.logical_month, "day": r.logical_day, "amount_kobo": r.amount_kobo, "reference": r.reference,
             "by_id": str(r.contributed_by), "by_name": names.get(r.contributed_by), "by_officer": r.contributed_by == d.raised_by,
             "method": r.method.value, "at": r.created_at.isoformat(), "withdrawn": r.is_withdrawn} for i, r in enumerate(recs)]
    tail = 0       # how many of the LAST days were marked by the disputing officer (all removable together)
    for r in reversed(recs):
        if r.contributed_by == d.raised_by and not r.is_withdrawn:
            tail += 1
        else:
            break
    officer_total = sum(1 for r in recs if r.contributed_by == d.raised_by and not r.is_withdrawn)
    last_tail_withdrawn = 0
    for r in reversed(recs):
        if r.is_withdrawn:
            last_tail_withdrawn += 1
        else:
            break
    fixes = (await db.execute(select(MarkingCorrection).where(MarkingCorrection.dispute_id == d.id).order_by(MarkingCorrection.created_at))).scalars().all()
    return {
        "dispute_id": str(d.id), "reason": d.reason.value, "status": d.status.value, "claimed_by_me": d.assigned_to == user.id,
        "claimed": d.assigned_to is not None,
        "card": {"id": str(card.id), "card_number": card.card_number, "type": card.card_type.value, "rate_kobo": card.rate_kobo, "status": card.status.value,
                 "days": card.total_days_contributed, "total_kobo": card.total_contributed_kobo},
        "customer": {"id": str(owner.id), "customer_number": owner.customer_number, "name": owner.full_name,
                     "phone": owner.phone_number if is_director else None},
        "officer": {"id": str(officer.id), "name": officer.full_name, "phone": officer.phone_number if is_director else None},
        "days": days[-80:], "total_days_on_card": len(days),
        "officer_days_total": officer_total, "officer_days_at_end": tail, "withdrawn_at_end": last_tail_withdrawn,
        "can_correct": is_director and d.status != DisputeStatus.RESOLVED,
        "corrections": [{"mode": c.mode, "days": c.days_removed, "amount_kobo": c.amount_kobo, "note": c.note, "at": c.created_at.isoformat()} for c in fixes],
    }


class CorrectIn(BaseModel):
    mode: str = Field(pattern="^(remove_days|remove_all)$")
    days: int | None = Field(default=None, ge=1, le=372)   # for remove_days: how many of the LAST days to take off
    note: str = Field(min_length=5, max_length=500)       # what the director found (shown to the officer)


@router.post("/{dispute_id}/marking/correct")
async def correct_marking(dispute_id: uuid.UUID, body: CorrectIn, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    d = await _get_marking(db, dispute_id, director)
    if d.status == DisputeStatus.RESOLVED:
        raise HTTPException(409, "This dispute is already resolved.")
    if d.assigned_to != director.id:
        raise HTTPException(409, "Claim this dispute first, so everyone knows who is handling it.")
    card = (await db.execute(select(ContributionCard).where(ContributionCard.id == d.entity_id).with_for_update())).scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    if card.food_collected_at:
        raise HTTPException(409, "The food package for this card was already collected, so its days can no longer be changed.")
    recs = (await db.execute(select(ContributionRecord).where(ContributionRecord.card_id == card.id)
                             .order_by(ContributionRecord.logical_month.desc(), ContributionRecord.logical_day.desc()))).scalars().all()
    # Days are slots 1..n. Only the LAST days can be taken off, otherwise new days would land on top of old ones.
    if body.mode == "remove_all":
        take = []
        for r in recs:
            if r.contributed_by == d.raised_by and not r.is_withdrawn:
                take.append(r)
            else:
                break
        officer_total = sum(1 for r in recs if r.contributed_by == d.raised_by and not r.is_withdrawn)
        if not take:
            raise HTTPException(409, "None of this officer's days are at the end of the card. Use 'remove the last days' and choose how many.")
        if len(take) < officer_total:
            raise HTTPException(409, f"Only {len(take)} of the officer's {officer_total} days are at the end of the card; the rest have other days after them. "
                                     "Remove the last days instead and choose exactly how many.")
    else:
        if not body.days:
            raise HTTPException(400, "Say how many days to remove.")
        take = recs[:body.days]
        if len(take) < body.days:
            raise HTTPException(409, "The card does not have that many days.")
        if any(r.is_withdrawn for r in take):
            raise HTTPException(409, "Some of those days were already withdrawn and cannot be removed. Choose fewer days.")

    # Money goes back to whoever paid for each day (the officer's wallet for officer markings).
    refund: dict[uuid.UUID, int] = {}
    for r in take:
        refund[r.contributed_by] = refund.get(r.contributed_by, 0) + r.amount_kobo
    amount = sum(refund.values())
    ref = generate_reference()
    for payer, kobo in refund.items():
        w = await get_or_create_wallet(db, payer)
        await credit_wallet(db, wallet=w, amount_kobo=kobo, category=TxCategory.REVERSAL, reference=f"{ref}-FIX-{str(payer)[:6]}",
                            description=f"{LOOKBACK_NOTE}: {sum(1 for r in take if r.contributed_by == payer)} day(s) removed from card #{card.card_number}",
                            initiated_by=director.id, related_card_id=card.id, related_entity_type="contribution_card", related_entity_id=card.id)
    for r in take:
        await db.delete(r)
    card.total_days_contributed = max(card.total_days_contributed - len(take), 0)
    card.total_contributed_kobo = max(card.total_contributed_kobo - amount, 0)
    if card.status == CardStatus.COMPLETED:        # no longer full: it is active again
        card.status = CardStatus.ACTIVE
        card.completed_at = None
        card.completion_status = None
    await db.flush()

    db.add(MarkingCorrection(dispute_id=d.id, card_id=card.id, corrected_by=director.id, officer_id=d.raised_by, mode=body.mode,
                             days_removed=len(take), amount_kobo=amount, refund_reference=ref, note=body.note.strip()))
    d.status = DisputeStatus.UNDER_REVIEW if d.status == DisputeStatus.OPEN else d.status
    db.add(DisputeMessage(dispute_id=d.id, sender_id=director.id,
                          message=f"Correction done: {len(take)} day(s) removed from card #{card.card_number} and ₦{amount // 100:,} returned. {body.note.strip()}"))
    await log_action(db, actor_id=director.id, action="card.marking_corrected", entity_type="card", entity_id=str(card.id),
                     old_value={"days": card.total_days_contributed + len(take)}, new_value={"days": card.total_days_contributed, "removed": len(take),
                                                                                             "amount_kobo": amount, "mode": body.mode, "dispute_id": str(d.id)})
    await send_notification(db, user_id=card.owner_id, type=NotificationType.INFO, title="Your card was corrected",
                            body=f"{len(take)} day(s) that were marked by mistake were removed from card #{card.card_number}.",
                            related_entity_id=card.id, deep_link_url="/customer/dashboard")
    await send_notification(db, user_id=d.raised_by, type=NotificationType.SUCCESS, title="Marking corrected",
                            body=f"{len(take)} day(s) were removed from card #{card.card_number} and ₦{amount // 100:,} was returned to your wallet.",
                            related_entity_id=d.id, deep_link_url=f"/disputes/{d.id}")
    return {"removed": len(take), "amount_kobo": amount, "card_days": card.total_days_contributed, "card_total_kobo": card.total_contributed_kobo}
