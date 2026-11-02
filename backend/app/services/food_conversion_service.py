"""Food Card completion deadline: automatic conversion of unfinished Food Cards, and the reminders sent before it.

Until now a Food Card could only be converted by hand. This service converts every unfinished Food Card to a Regular
Card once the director's deadline has passed (nightly job in tasks/food_conversion.py), and lets directors warn the
customers who are behind, one by one or in bulk, with a message they can edit.
"""
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import CardStatus, CardType, ContributionCard
from app.models.food_conversion import FoodConversionReminder
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.models.zone import Zone
from app.services.notification_service import send_notification
from app.services.settings_service import get_config_value
from app.utils.audit import log_action

LAGOS = ZoneInfo("Africa/Lagos")
TOTAL_DAYS = 372
DEADLINE_KEY = "food_card_conversion_deadline"
DEADLINE_DEFAULT = "2026-11-30"
TEMPLATE_KEY = "food_conversion.reminder_template"
DEFAULT_TEMPLATE = ("Hello {name}, your Food Card #{card_number} has {days_done} of {total_days} days done. Please complete it before "
                    "{deadline} ({days_left} days left). If it is not complete by then, it will be converted to a Regular Card and you will "
                    "lose your food package for that card.")


def today() -> date:
    return datetime.now(LAGOS).date()


async def get_deadline(db: AsyncSession) -> date:
    raw = await get_config_value(db, DEADLINE_KEY, DEADLINE_DEFAULT) or DEADLINE_DEFAULT
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return date.fromisoformat(DEADLINE_DEFAULT)


async def get_template(db: AsyncSession) -> str:
    return (await get_config_value(db, TEMPLATE_KEY, DEFAULT_TEMPLATE)) or DEFAULT_TEMPLATE


def unfinished_cards_query():
    """Food Cards still being filled. (A completed Food Card is safe and is never converted.)"""
    return (select(ContributionCard, User).join(User, User.id == ContributionCard.owner_id)
            .where(ContributionCard.card_type == CardType.FOOD, ContributionCard.status == CardStatus.ACTIVE, User.deleted_at.is_(None)))


async def summary(db: AsyncSession) -> dict:
    dl = await get_deadline(db)
    rows = (await db.execute(unfinished_cards_query())).all()
    owners = {u.id for _, u in rows}
    buckets = {"under_25": 0, "25_to_50": 0, "50_to_75": 0, "over_75": 0}
    for c, _ in rows:
        pct = c.total_days_contributed / TOTAL_DAYS * 100
        buckets["under_25" if pct < 25 else "25_to_50" if pct < 50 else "50_to_75" if pct < 75 else "over_75"] += 1
    converted = (await db.execute(select(func.count()).select_from(ContributionCard).where(ContributionCard.auto_converted_at.is_not(None)))).scalar_one()
    start = datetime.combine(today(), datetime.min.time(), tzinfo=LAGOS).astimezone(timezone.utc)
    sent_today = (await db.execute(select(func.count(func.distinct(FoodConversionReminder.customer_id))).where(FoodConversionReminder.created_at >= start))).scalar_one()
    return {"deadline": dl.isoformat(), "today": today().isoformat(), "days_left": (dl - today()).days, "passed": today() > dl,
            "unfinished_cards": len(rows), "unfinished_customers": len(owners), "buckets": buckets,
            "auto_converted_total": converted, "reminded_today": sent_today, "template": await get_template(db), "total_days": TOTAL_DAYS}


def render(template: str, *, name: str, cards: list[ContributionCard], deadline: date) -> str:
    """Placeholders: {name} {card_number} {days_done} {total_days} {days_left} {deadline} {cards}. Uses the least-finished card."""
    c = min(cards, key=lambda x: x.total_days_contributed)
    days_left = max((deadline - today()).days, 0)

    class _Safe(dict):
        def __missing__(self, k):  # an unknown {placeholder} is left as typed instead of crashing the send
            return "{" + k + "}"

    return template.format_map(_Safe(
        name=name.split()[0] if name else "there", card_number=c.card_number, days_done=c.total_days_contributed, total_days=TOTAL_DAYS,
        days_left=days_left, deadline=deadline.strftime("%d %b %Y"),
        cards=", ".join(f"Card #{x.card_number} ({x.total_days_contributed}/{TOTAL_DAYS})" for x in cards)))


async def list_unfinished(db: AsyncSession, *, q: str | None, zone_id: uuid.UUID | None, max_percent: int | None, min_percent: int | None,
                          reminded: str | None, limit: int, offset: int) -> dict:
    """One row per customer (a customer with two unfinished Food Cards appears once, with both cards)."""
    rows = (await db.execute(unfinished_cards_query().order_by(User.full_name))).all()
    reminded_at = {cid: t for cid, t in (await db.execute(select(FoodConversionReminder.customer_id, func.max(FoodConversionReminder.created_at))
                                                       .group_by(FoodConversionReminder.customer_id))).all()}
    zones = {z.id: z.name for z in (await db.execute(select(Zone))).scalars().all()}
    by: dict[uuid.UUID, dict] = {}
    for c, u in rows:
        e = by.setdefault(u.id, {"customer": u, "cards": []})
        e["cards"].append(c)
    out = []
    ql = (q or "").strip().lower()
    for uid, e in by.items():
        u, cards = e["customer"], e["cards"]
        low = min(c.total_days_contributed for c in cards) / TOTAL_DAYS * 100
        if ql and ql not in u.full_name.lower() and ql not in (u.phone_number or "") and ql != str(u.customer_number):
            continue
        if zone_id and u.zone_id != zone_id:
            continue
        if max_percent is not None and low > max_percent:
            continue
        if min_percent is not None and low < min_percent:
            continue
        if reminded == "never" and uid in reminded_at:
            continue
        if reminded == "reminded" and uid not in reminded_at:
            continue
        out.append({"customer_id": str(uid), "customer_number": u.customer_number, "full_name": u.full_name, "phone_number": u.phone_number,
                    "zone_name": zones.get(u.zone_id), "last_reminded_at": reminded_at[uid].isoformat() if uid in reminded_at else None,
                    "lowest_percent": round(low), "cards": [{"id": str(c.id), "card_number": c.card_number, "days_done": c.total_days_contributed,
                                                              "percent": round(c.total_days_contributed / TOTAL_DAYS * 100)} for c in cards]})
    out.sort(key=lambda r: r["lowest_percent"])
    return {"total": len(out), "items": out[offset:offset + limit], "_all_ids": [r["customer_id"] for r in out]}


async def remind(db: AsyncSession, *, director: User, customer_ids: list[uuid.UUID], template: str, dry_run: bool = False) -> dict:
    if not (template or "").strip():
        raise ValueError("Write the message first.")
    deadline = await get_deadline(db)
    rows = (await db.execute(unfinished_cards_query().where(ContributionCard.owner_id.in_(customer_ids)))).all()
    by: dict[uuid.UUID, dict] = {}
    for c, u in rows:
        by.setdefault(u.id, {"user": u, "cards": []})["cards"].append(c)
    sample = None
    sent = 0
    for uid, e in by.items():
        msg = render(template, name=e["user"].full_name, cards=e["cards"], deadline=deadline)
        sample = sample or msg
        if dry_run:
            sent += 1
            continue
        await send_notification(db, user_id=uid, title="Complete your Food Card", body=msg, type=NotificationType.WARNING,
                                related_entity_id=min(e["cards"], key=lambda x: x.total_days_contributed).id, deep_link_url="/customer/dashboard")
        db.add(FoodConversionReminder(customer_id=uid, card_id=min(e["cards"], key=lambda x: x.total_days_contributed).id, sent_by=director.id, message=msg))
        sent += 1
    if not dry_run:
        await log_action(db, actor_id=director.id, action="food_conversion.reminded", entity_type="food_conversion", entity_id=str(uuid.uuid4()),
                         new_value={"customers": sent, "template": template[:300]})
    return {"sent": sent, "skipped": len(customer_ids) - sent, "sample": sample, "dry_run": dry_run}


async def _system_actor(db: AsyncSession) -> uuid.UUID | None:
    return (await db.execute(select(User.id).where(User.role == UserRole.DIRECTOR).order_by(User.created_at).limit(1))).scalar_one_or_none()


async def convert_overdue(db: AsyncSession, *, actor_id: uuid.UUID | None = None, force: bool = False) -> dict:
    """Convert every unfinished Food Card once the deadline day is over. Safe to run any number of times."""
    deadline = await get_deadline(db)
    if not force and today() <= deadline:
        return {"converted": 0, "reason": "deadline_not_passed", "deadline": deadline.isoformat()}
    actor = actor_id or await _system_actor(db)
    rows = (await db.execute(unfinished_cards_query().with_for_update(of=ContributionCard))).all()
    now = datetime.now(timezone.utc)
    n = 0
    for c, u in rows:
        c.card_type = CardType.REGULAR
        c.food_eligibility_lost_at = now
        c.auto_converted_at = now
        if actor:
            await log_action(db, actor_id=actor, action="card.auto_converted", entity_type="card", entity_id=str(c.id),
                             new_value={"card_type": "regular", "days_done": c.total_days_contributed, "deadline": deadline.isoformat()})
        await send_notification(db, user_id=u.id, title="Food Card converted to Regular",
                                body=(f"The Food Card deadline ({deadline.strftime('%d %b %Y')}) has passed and Card #{c.card_number} was not complete "
                                      f"({c.total_days_contributed} of {TOTAL_DAYS} days), so it is now a Regular Card. You lose the food package for this card, "
                                      "but your money is now withdrawable. Contact support if you think this is a mistake."),
                                type=NotificationType.WARNING, related_entity_id=c.id, deep_link_url="/customer/dashboard")
        n += 1
    await db.flush()
    return {"converted": n, "deadline": deadline.isoformat()}
