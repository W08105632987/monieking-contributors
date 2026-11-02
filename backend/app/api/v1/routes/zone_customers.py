"""Director: every customer of a zone / officer (affiliated or salary) with analytics and filters, plus moving customers
between zones (or out of every zone, leaving them under no officer)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly, invalidate_user_cache
from app.models.card import CardStatus, CardType, ContributionCard, ContributionRecord
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.models.zone import Zone
from app.services.customer_stats_service import date_range_filters
from app.services.notification_service import send_notification
from app.utils.audit import log_action

router = APIRouter(prefix="/director-zones", tags=["director-zones"])
LAGOS = ZoneInfo("Africa/Lagos")
INACTIVE_DAYS = 30


async def _scope(db: AsyncSession, *, zone_id: uuid.UUID | None, officer_id: uuid.UUID | None):
    """-> (customer condition, label dict). An officer's customers are the ones in their zone, plus (for an affiliated
    officer) the ones the director gave them commission on."""
    if officer_id:
        o = await db.get(User, officer_id)
        if not o or o.role != UserRole.OFFICER:
            raise HTTPException(404, "Officer not found")
        parts = []
        if o.zone_id:
            parts.append(User.zone_id == o.zone_id)
        parts.append(User.commission_officer_id == o.id)
        z = await db.get(Zone, o.zone_id) if o.zone_id else None
        return or_(*parts), {"officer_id": str(o.id), "officer_name": o.full_name, "officer_type": o.officer_type,
                             "zone_id": str(z.id) if z else None, "zone_name": z.name if z else None}
    z = await db.get(Zone, zone_id) if zone_id else None
    if not z:
        raise HTTPException(404, "Zone not found")
    return User.zone_id == z.id, {"officer_id": None, "officer_name": None, "officer_type": None, "zone_id": str(z.id), "zone_name": z.name}


async def _customers(db, cond, *, start_date, end_date, card_type, status, q, sort, limit, offset):
    base = [User.role == UserRole.CUSTOMER, User.deleted_at.is_(None), cond]
    start_dt, end_dt = date_range_filters(start_date, end_date)

    food_owners = select(ContributionCard.owner_id).where(ContributionCard.card_type == CardType.FOOD).distinct()
    any_card = select(ContributionCard.owner_id).distinct()
    cutoff = datetime.now(timezone.utc) - timedelta(days=INACTIVE_DAYS)
    recent = (select(ContributionCard.owner_id).join(ContributionRecord, ContributionRecord.card_id == ContributionCard.id)
              .where(ContributionRecord.created_at >= cutoff).distinct())

    # ── analytics (whole scope, unaffected by the list filters except the date range for "new") ──
    total = (await db.execute(select(func.count()).select_from(User).where(*base))).scalar_one()
    food = (await db.execute(select(func.count()).select_from(User).where(*base, User.id.in_(food_owners)))).scalar_one()
    with_cards = (await db.execute(select(func.count()).select_from(User).where(*base, User.id.in_(any_card)))).scalar_one()
    inactive = (await db.execute(select(func.count()).select_from(User).where(*base, User.id.not_in(recent)))).scalar_one()
    nconds = list(base)
    if start_dt:
        nconds.append(User.created_at >= start_dt)
    if end_dt:
        nconds.append(User.created_at < end_dt)
    new_in_range = (await db.execute(select(func.count()).select_from(User).where(*nconds))).scalar_one()
    day = func.date(func.timezone("Africa/Lagos", User.created_at))
    series_from = start_dt or (datetime.now(timezone.utc) - timedelta(days=29))
    series = (await db.execute(select(day, func.count()).where(*base, User.created_at >= series_from, *( [User.created_at < end_dt] if end_dt else [] )).group_by(day).order_by(day))).all()
    analytics = {"total": total, "food": food, "regular": max(with_cards - food, 0), "no_cards": total - with_cards, "inactive_30d": inactive,
                 "new_in_range": new_in_range, "new_by_day": [{"day": d.isoformat(), "count": n} for d, n in series]}

    # ── the list (filters applied) ──
    lc = list(nconds if (start_dt or end_dt) else base)
    if card_type == "food":
        lc.append(User.id.in_(food_owners))
    elif card_type == "regular":
        lc += [User.id.in_(any_card), User.id.not_in(food_owners)]
    elif card_type == "none":
        lc.append(User.id.not_in(any_card))
    if status == "inactive":
        lc.append(User.id.not_in(recent))
    elif status == "active":
        lc.append(User.id.in_(recent))
    if q:
        like = f"%{q.strip()}%"
        digits = q.strip()
        lc.append(or_(User.full_name.ilike(like), User.phone_number.ilike(like), *( [User.customer_number == int(digits)] if digits.isdigit() else [] )))
    count = (await db.execute(select(func.count()).select_from(User).where(*lc))).scalar_one()
    order = {"name": User.full_name.asc(), "oldest": User.created_at.asc()}.get(sort, User.created_at.desc())
    rows = (await db.execute(select(User).where(*lc).order_by(order).limit(limit).offset(offset))).scalars().all()
    ids = [u.id for u in rows]
    cards: dict = {}
    last: dict = {}
    if ids:
        for owner, ctype, n, saved in (await db.execute(
                select(ContributionCard.owner_id, ContributionCard.card_type, func.count(), func.coalesce(func.sum(ContributionCard.total_contributed_kobo), 0))
                .where(ContributionCard.owner_id.in_(ids)).group_by(ContributionCard.owner_id, ContributionCard.card_type))).all():
            c = cards.setdefault(owner, {"food": 0, "regular": 0, "saved": 0})
            c["food" if ctype == CardType.FOOD else "regular"] += n
            c["saved"] += int(saved)
        last = {o: t for o, t in (await db.execute(
            select(ContributionCard.owner_id, func.max(ContributionRecord.created_at)).join(ContributionRecord, ContributionRecord.card_id == ContributionCard.id)
            .where(ContributionCard.owner_id.in_(ids)).group_by(ContributionCard.owner_id))).all()}
    zones = {z.id: z.name for z in (await db.execute(select(Zone))).scalars().all()}
    items = [{
        "id": str(u.id), "customer_number": u.customer_number, "full_name": u.full_name, "phone_number": u.phone_number,
        "joined_at": u.created_at.isoformat(), "zone_id": str(u.zone_id) if u.zone_id else None, "zone_name": zones.get(u.zone_id),
        "food_cards": cards.get(u.id, {}).get("food", 0), "regular_cards": cards.get(u.id, {}).get("regular", 0),
        "saved_kobo": cards.get(u.id, {}).get("saved", 0), "last_contribution_at": last[u.id].isoformat() if last.get(u.id) else None,
        "inactive": not (last.get(u.id) and last[u.id] >= cutoff), "commission_officer_id": str(u.commission_officer_id) if u.commission_officer_id else None,
    } for u in rows]
    return {"analytics": analytics, "total": count, "items": items}


@router.get("/officers/{officer_id}/customers")
async def officer_customers(officer_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db),
                            start_date: date | None = None, end_date: date | None = None,
                            card_type: str | None = Query(default=None, pattern="^(food|regular|none)$"),
                            status: str | None = Query(default=None, pattern="^(active|inactive)$"),
                            q: str | None = Query(default=None, max_length=60), sort: str = Query(default="newest", pattern="^(newest|oldest|name)$"),
                            limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    cond, who = await _scope(db, zone_id=None, officer_id=officer_id)
    return {**who, **await _customers(db, cond, start_date=start_date, end_date=end_date, card_type=card_type, status=status, q=q, sort=sort, limit=limit, offset=offset)}


@router.get("/zones/{zone_id}/customers")
async def zone_customers(zone_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db),
                         start_date: date | None = None, end_date: date | None = None,
                         card_type: str | None = Query(default=None, pattern="^(food|regular|none)$"),
                         status: str | None = Query(default=None, pattern="^(active|inactive)$"),
                         q: str | None = Query(default=None, max_length=60), sort: str = Query(default="newest", pattern="^(newest|oldest|name)$"),
                         limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    cond, who = await _scope(db, zone_id=zone_id, officer_id=None)
    return {**who, **await _customers(db, cond, start_date=start_date, end_date=end_date, card_type=card_type, status=status, q=q, sort=sort, limit=limit, offset=offset)}


class MoveIn(BaseModel):
    customer_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    zone_id: uuid.UUID | None = None            # None = take them out of every zone (no officer)
    clear_commission: bool = False              # also stop commission going to an affiliated officer


@router.post("/customers/move")
async def move_customers(body: MoveIn, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Move customers to a zone (the same one is fine), or out of every zone. Cards, money and history are untouched."""
    zone = None
    if body.zone_id:
        zone = await db.get(Zone, body.zone_id)
        if not zone:
            raise HTTPException(404, "Zone not found")
    users = (await db.execute(select(User).where(User.id.in_(body.customer_ids), User.role == UserRole.CUSTOMER))).scalars().all()
    if not users:
        raise HTTPException(404, "No matching customers")
    for u in users:
        before = {"zone_id": str(u.zone_id) if u.zone_id else None, "managing_officer_id": str(u.managing_officer_id) if u.managing_officer_id else None,
                  "commission_officer_id": str(u.commission_officer_id) if u.commission_officer_id else None}
        u.zone_id = zone.id if zone else None
        if zone is None and u.is_manual_customer:
            u.managing_officer_id = None
        if body.clear_commission:
            u.commission_officer_id = None
        await log_action(db, actor_id=director.id, action="customer.zone_moved" if zone else "customer.zone_removed", entity_type="user", entity_id=str(u.id),
                         old_value=before, new_value={"zone_id": str(zone.id) if zone else None, "clear_commission": body.clear_commission})
        await send_notification(db, user_id=u.id, title="Your zone was updated",
                                body=(f"You are now in {zone.name}. Your new officer will look after your cards." if zone else
                                      "You are not under a zone officer right now. Contact support if you need help marking your card."),
                                type=NotificationType.INFO)
    await db.flush()
    for u in users:
        await invalidate_user_cache(str(u.id))
    return {"moved": len(users), "zone_id": str(zone.id) if zone else None, "zone_name": zone.name if zone else None}
