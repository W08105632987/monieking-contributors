"""Director SMS tool: set the per-SMS fee, and send bulk / personal SMS with a live cost preview."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOrAdmin
from app.integrations.termii import send_sms
from app.models.card import ContributionCard, CardType
from app.models.food_entitlement import FoodEntitlement, EntitlementStatus
from app.models.user import User, UserRole, UserStatus
from app.services import sms_service
from app.services.settings_service import set_config_value
from app.utils.audit import log_action

router = APIRouter(prefix="/sms", tags=["sms"])

Audience = Literal["all_customers", "food_contributors", "qualified_food", "regular_contributors", "sms_subscribers", "officers", "personal"]
AUDIENCE_LABEL = {
    "all_customers": "All customers",
    "food_contributors": "Food contributors",
    "qualified_food": "Qualified food contributors (not yet collected)",
    "regular_contributors": "Regular contributors",
    "sms_subscribers": "Customers who turned SMS alerts on",
    "officers": "Officers",
    "personal": "Specific people",
}
MAX_RECIPIENTS = 2000


class FeeBody(BaseModel):
    fee_per_sms_kobo: int = Field(ge=0, le=100_000)
    provider_cost_per_segment_kobo: int | None = Field(default=None, ge=0, le=100_000)


class SmsBody(BaseModel):
    audience: Audience
    message: str = Field(min_length=1, max_length=1000)
    user_ids: list[uuid.UUID] = []


async def _recipients(db: AsyncSession, audience: str, user_ids: list[uuid.UUID]) -> list[User]:
    base = select(User).where(User.phone_number.isnot(None), User.phone_number != "", User.status == UserStatus.ACTIVE)
    if audience == "officers":
        stmt = base.where(User.role == UserRole.OFFICER)
    elif audience == "personal":
        if not user_ids:
            return []
        stmt = base.where(User.id.in_(user_ids))
    else:
        stmt = base.where(User.role == UserRole.CUSTOMER)
        if audience == "food_contributors":
            stmt = stmt.where(User.id.in_(select(ContributionCard.owner_id).where(ContributionCard.card_type == CardType.FOOD)))
        elif audience == "regular_contributors":
            stmt = stmt.where(
                User.id.in_(select(ContributionCard.owner_id).where(ContributionCard.card_type != CardType.FOOD)),
                User.id.notin_(select(ContributionCard.owner_id).where(ContributionCard.card_type == CardType.FOOD)),
            )
        elif audience == "qualified_food":
            stmt = stmt.where(User.id.in_(
                select(FoodEntitlement.customer_id).where(
                    FoodEntitlement.archived_in_year_id.is_(None), FoodEntitlement.status == EntitlementStatus.ACTIVE)))
        elif audience == "sms_subscribers":
            stmt = stmt.where(User.sms_alerts_enabled.is_(True))
    return list((await db.execute(stmt.order_by(User.full_name))).scalars().all())


@router.get("/config")
async def sms_config(director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    fee = await sms_service.get_fee_kobo(db)
    cost = await sms_service.get_provider_cost_kobo(db)
    return {"fee_per_sms_kobo": fee, "provider_cost_per_segment_kobo": cost,
            "audiences": [{"key": k, "label": v} for k, v in AUDIENCE_LABEL.items()]}


@router.put("/fee")
async def set_fee(body: FeeBody, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    await set_config_value(db, key="sms_fee_per_sms_kobo", value=str(body.fee_per_sms_kobo), updated_by=director.id)
    if body.provider_cost_per_segment_kobo is not None:
        await set_config_value(db, key="sms_provider_cost_per_segment_kobo", value=str(body.provider_cost_per_segment_kobo), updated_by=director.id)
    await log_action(db, actor_id=director.id, action="sms.fee_changed", entity_type="system_config", entity_id="sms_fee_per_sms_kobo",
                     new_value=body.model_dump())
    return await sms_config(director, db)


@router.post("/preview")
async def preview(body: SmsBody, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    text = sms_service.compact(body.message)
    info = sms_service.count_segments(text)
    people = await _recipients(db, body.audience, body.user_ids)
    cost = await sms_service.get_provider_cost_kobo(db)
    saved = sms_service.count_segments(body.message)
    return {
        "recipients": len(people),
        "sample": [p.full_name for p in people[:5]],
        **info,
        "text_sent": text,
        "provider_cost_kobo": cost * info["segments"] * len(people),
        "segments_total": info["segments"] * len(people),
        "extra_segments_avoided": max(0, saved["segments"] - info["segments"]) * len(people),
        "too_many": len(people) > MAX_RECIPIENTS,
    }


@router.post("/send")
async def send(body: SmsBody, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    people = await _recipients(db, body.audience, body.user_ids)
    if not people:
        raise HTTPException(status_code=400, detail="Nobody to send to — no one in that group has a phone number")
    if len(people) > MAX_RECIPIENTS:
        raise HTTPException(status_code=400, detail=f"That is {len(people)} people; send in groups of at most {MAX_RECIPIENTS}")
    text = sms_service.compact(body.message)
    segs = sms_service.count_segments(text)["segments"]
    sent = failed = 0
    seen: set[str] = set()
    for p in people:
        if p.phone_number in seen:      # one SMS per phone number
            continue
        seen.add(p.phone_number)
        ok = await send_sms(p.phone_number, text)
        sent += 1 if ok else 0
        failed += 0 if ok else 1
    cost = await sms_service.get_provider_cost_kobo(db)
    await log_action(db, actor_id=director.id, action="sms.bulk_sent", entity_type="sms", entity_id=body.audience,
                     new_value={"audience": body.audience, "sent": sent, "failed": failed, "segments": segs})
    return {"sent": sent, "failed": failed, "segments_each": segs, "provider_cost_kobo": cost * segs * sent}
