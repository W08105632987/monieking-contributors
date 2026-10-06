"""
Food Collection Ledger — the reporting/reconciliation layer on top of the
already-correct food_entitlements/food_collection_audits data. Nothing in
this file changes the scan/verify/confirm/revoke flow in food_collections.py;
it only adds the ability to read back what's already being recorded, plus
genuinely new pieces: admin-editable package items, a director-editable
distribution announcement, and a formal year-end close/archive workflow.

Three roles touch this file:
  - Director/Admin: package-item management, the oversight table, ping,
    the announcement template, and closing a year.
  - Officer: their own distribution ledger, with "my zone" vs other-zone
    pills on each row.
  - Any authenticated user: reads the active package-item list (what the
    customer-facing rules modal renders).
"""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOnly, OfficerOnly
from app.models.user import User, UserRole
from app.models.zone import Zone
from app.models.card import ContributionCard, CardType
from app.models.food_entitlement import FoodEntitlement, EntitlementStatus
from app.models.food_ledger import FoodPackageItem, FoodCollectionYearArchive, FoodCollectionYearArchiveCost
from app.services.settings_service import get_config_value, set_config_value
from app.services.notification_service import send_notification
from app.services.food_entitlement_service import create_missing_entitlements
from app.models.notification import NotificationType
from app.utils.audit import log_action

router = APIRouter(prefix="/food-collections", tags=["food-ledger"])

ANNOUNCEMENT_CONFIG_KEY = "food_distribution_announcement"
DEFAULT_ANNOUNCEMENT = (
    "Food distribution has started! Once your food card is fully completed, "
    "visit your nearest collection point with your QR pass and collection PIN "
    "to receive your package. Bring a valid means of identification."
)


# ── Shared helper: keep the live oversight set complete ──────────────────
async def _backfill_entitlements(db: AsyncSession) -> None:
    """
    Entitlements are normally created lazily, only when a customer opens
    their food page after qualifying (see food_collections.py's /me).
    That's fine for the customer-facing flow, but it means a director's
    oversight view built purely from existing FoodEntitlement rows would
    silently miss anyone who completed their card but hasn't opened the
    app yet. Run this before any oversight read/close so the live set is
    always a true reflection of who's actually qualified — same token/PIN
    generation logic as the lazy endpoint, just swept in bulk.
    """
    qualified_stmt = select(ContributionCard).where(
        and_(
            ContributionCard.card_type == CardType.FOOD,
            ContributionCard.total_days_contributed >= 372,
        )
    )
    qualified_cards = (await db.execute(qualified_stmt)).scalars().all()
    if not qualified_cards:
        return

    existing_stmt = select(FoodEntitlement.card_id)
    existing_card_ids = {row for row in (await db.execute(existing_stmt)).scalars().all()}

    missing_cards = [card for card in qualified_cards if card.id not in existing_card_ids]
    # One entitlement per qualified CARD (a customer can hold several food
    # cards, each its own pass). The insert is ON CONFLICT DO NOTHING, so a
    # customer opening their food page at the same moment can't make this
    # request fail on the UNIQUE(card_id) constraint.
    await create_missing_entitlements(db, missing_cards, datetime.now(timezone.utc).year)


def _entitlement_owner_zone_id(user: User | None) -> uuid.UUID | None:
    return user.zone_id if user else None


# ── Package items ─────────────────────────────────────────────────────────
@router.get("/package-items")
async def list_package_items(
    current_user: CurrentUser,
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    """Read-only for any authenticated user — this is what the customer-facing
    rules modal renders, and what the director's year-end cost step pulls from."""
    stmt = select(FoodPackageItem).order_by(FoodPackageItem.display_order, FoodPackageItem.name)
    if active_only:
        stmt = stmt.where(FoodPackageItem.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": str(r.id), "name": r.name, "description": r.description,
            "icon": r.icon, "display_order": r.display_order, "is_active": r.is_active,
        }
        for r in rows
    ]


@router.post("/package-items", status_code=201)
async def create_package_item(body: dict, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Item name is required")
    item = FoodPackageItem(
        name=name,
        description=body.get("description"),
        icon=body.get("icon"),
        display_order=int(body.get("display_order") or 0),
    )
    db.add(item)
    await db.flush()
    await log_action(db, actor_id=director.id, action="food.package_item.created",
                      entity_type="food_package_item", entity_id=str(item.id), new_value={"name": name})
    return {"id": str(item.id)}


@router.patch("/package-items/{item_id}")
async def update_package_item(item_id: uuid.UUID, body: dict, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    item = await db.get(FoodPackageItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Package item not found")
    old = {"name": item.name, "is_active": item.is_active, "display_order": item.display_order}
    if "name" in body and body["name"]:
        item.name = body["name"].strip()
    if "description" in body:
        item.description = body["description"]
    if "icon" in body:
        item.icon = body["icon"]
    if "display_order" in body:
        item.display_order = int(body["display_order"])
    if "is_active" in body:
        item.is_active = bool(body["is_active"])
    await db.flush()
    await log_action(db, actor_id=director.id, action="food.package_item.updated",
                      entity_type="food_package_item", entity_id=str(item.id),
                      old_value=old, new_value={"name": item.name, "is_active": item.is_active, "display_order": item.display_order})
    return {"ok": True}


# ── Distribution announcement template ────────────────────────────────────
@router.get("/announcement")
async def get_announcement(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    text = await get_config_value(db, ANNOUNCEMENT_CONFIG_KEY, default=DEFAULT_ANNOUNCEMENT)
    return {"text": text}


@router.patch("/announcement")
async def update_announcement(body: dict, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Announcement text cannot be empty")
    await set_config_value(db, key=ANNOUNCEMENT_CONFIG_KEY, value=text, updated_by=director.id)
    return {"text": text}


# ── Officer's own distribution ledger ──────────────────────────────────────
@router.get("/mine")
async def list_my_confirmed_collections(
    officer: OfficerOnly,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(FoodEntitlement)
        .options(selectinload(FoodEntitlement.customer))
        .where(FoodEntitlement.collected_by == officer.id)
        .order_by(FoodEntitlement.collected_at.desc())
    )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))).scalars().all()

    out = []
    for r in rows:
        customer_zone_id = _entitlement_owner_zone_id(r.customer)
        zone_name = None
        if customer_zone_id:
            zone = await db.get(Zone, customer_zone_id)
            zone_name = zone.name if zone else None
        out.append({
            "id": str(r.id),
            "customer_name": r.customer.full_name if r.customer else None,
            "package_name": r.package_name,
            "collected_at": r.collected_at.isoformat() if r.collected_at else None,
            "is_my_zone": customer_zone_id is not None and customer_zone_id == officer.zone_id,
            "zone_name": zone_name,
        })

    today = datetime.now(timezone.utc).date()
    today_count = sum(1 for r in rows if r.collected_at and r.collected_at.date() == today)

    return {
        "items": out, "total": total, "page": page, "page_size": page_size,
        "stats": {"today": today_count, "total": total},
    }


# ── Director oversight ──────────────────────────────────────────────────
@router.get("/oversight")
async def oversight_list(
    director: DirectorOnly,
    status: str | None = Query(None, description="collected | not_collected"),
    zone_id: uuid.UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    await _backfill_entitlements(db)

    stmt = (
        select(FoodEntitlement)
        .options(selectinload(FoodEntitlement.customer), selectinload(FoodEntitlement.card))
        .where(FoodEntitlement.archived_in_year_id.is_(None))
    )
    if status == "collected":
        stmt = stmt.where(FoodEntitlement.status == EntitlementStatus.USED)
    elif status == "not_collected":
        stmt = stmt.where(FoodEntitlement.status == EntitlementStatus.ACTIVE)
    if zone_id:
        stmt = stmt.join(User, FoodEntitlement.customer_id == User.id).where(User.zone_id == zone_id)

    stmt = stmt.order_by(FoodEntitlement.created_at.desc())
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))).scalars().all()

    out = []
    for r in rows:
        zone_name = None
        if r.customer and r.customer.zone_id:
            zone = await db.get(Zone, r.customer.zone_id)
            zone_name = zone.name if zone else None
        officer_name = None
        if r.collected_by:
            officer = await db.get(User, r.collected_by)
            officer_name = officer.full_name if officer else None
        out.append({
            "id": str(r.id),
            "customer_id": str(r.customer_id),
            "customer_name": r.customer.full_name if r.customer else None,
            "zone_name": zone_name,
            "status": r.status.value,
            "collected_at": r.collected_at.isoformat() if r.collected_at else None,
            "confirmed_by": officer_name,
        })

    return {"items": out, "total": total, "page": page, "page_size": page_size}


@router.get("/oversight/stats")
async def oversight_stats(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    await _backfill_entitlements(db)

    base = select(FoodEntitlement).where(FoodEntitlement.archived_in_year_id.is_(None))
    total_qualified = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()

    collected_stmt = base.where(FoodEntitlement.status == EntitlementStatus.USED)
    total_collected = (await db.execute(select(func.count()).select_from(collected_stmt.subquery()))).scalar_one()

    # By zone
    zone_stmt = (
        select(User.zone_id, func.count(FoodEntitlement.id))
        .select_from(FoodEntitlement)
        .join(User, FoodEntitlement.customer_id == User.id)
        .where(FoodEntitlement.archived_in_year_id.is_(None), FoodEntitlement.status == EntitlementStatus.USED)
        .group_by(User.zone_id)
    )
    by_zone_raw = (await db.execute(zone_stmt)).all()
    by_zone = []
    for zone_id, count in by_zone_raw:
        zone = await db.get(Zone, zone_id) if zone_id else None
        by_zone.append({"zone_name": zone.name if zone else "Unassigned", "collected": count})

    # By confirming officer
    officer_stmt = (
        select(FoodEntitlement.collected_by, func.count(FoodEntitlement.id))
        .where(FoodEntitlement.archived_in_year_id.is_(None), FoodEntitlement.collected_by.isnot(None))
        .group_by(FoodEntitlement.collected_by)
    )
    by_officer_raw = (await db.execute(officer_stmt)).all()
    by_officer = []
    for officer_id, count in by_officer_raw:
        officer = await db.get(User, officer_id)
        by_officer.append({"officer_name": officer.full_name if officer else "Unknown", "collected": count})

    return {
        "total_qualified": total_qualified,
        "total_collected": total_collected,
        "total_not_collected": total_qualified - total_collected,
        "by_zone": by_zone,
        "by_officer": by_officer,
    }


@router.post("/oversight/{customer_id}/ping")
async def ping_customer(customer_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    customer = await db.get(User, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    announcement = await get_config_value(db, ANNOUNCEMENT_CONFIG_KEY, default=DEFAULT_ANNOUNCEMENT)
    await send_notification(
        db,
        user_id=customer.id,
        title="Your food package is ready for pickup",
        body=announcement,
        type=NotificationType.INFO,
    )
    return {"ok": True}


# ── Year-end close & archive ───────────────────────────────────────────────
@router.post("/year/close")
async def close_year(body: dict, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """
    Irreversible. Confirmation must already have happened on the frontend
    before this is ever called — there is no undo endpoint by design, this
    is meant to be a real financial record, same as every other close/
    audit action in this codebase.

    Body: { year_label: str, item_costs: [{item_id, unit_cost_kobo}],
            adjustment_kobo: int, adjustment_note: str | None }
    """
    year_label = (body.get("year_label") or "").strip()
    if not year_label:
        raise HTTPException(status_code=400, detail="year_label is required")

    existing = (await db.execute(
        select(FoodCollectionYearArchive).where(FoodCollectionYearArchive.year_label == year_label)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"A record for '{year_label}' already exists")

    await _backfill_entitlements(db)

    open_stmt = (
        select(FoodEntitlement)
        .options(selectinload(FoodEntitlement.card))
        .where(FoodEntitlement.archived_in_year_id.is_(None))
    )
    open_entitlements = (await db.execute(open_stmt)).scalars().all()

    total_qualified = len(open_entitlements)
    collected = [e for e in open_entitlements if e.status == EntitlementStatus.USED]
    total_collected = len(collected)
    total_not_collected = total_qualified - total_collected

    total_contributions_kobo = sum(
        (e.card.total_contributed_kobo if e.card else 0) for e in open_entitlements
    )

    item_costs = body.get("item_costs") or []
    per_person_cost_kobo = sum(int(ic.get("unit_cost_kobo") or 0) for ic in item_costs)
    adjustment_kobo = int(body.get("adjustment_kobo") or 0)
    adjustment_note = body.get("adjustment_note")
    if adjustment_kobo != 0 and not adjustment_note:
        raise HTTPException(status_code=400, detail="An adjustment amount requires a note explaining it")

    total_cost_kobo = (per_person_cost_kobo * total_collected) + adjustment_kobo
    net_result_kobo = total_contributions_kobo - total_cost_kobo

    archive = FoodCollectionYearArchive(
        year_label=year_label,
        closed_by=director.id,
        total_qualified=total_qualified,
        total_collected=total_collected,
        total_not_collected=total_not_collected,
        total_customer_contributions_kobo=total_contributions_kobo,
        adjustment_kobo=adjustment_kobo,
        adjustment_note=adjustment_note,
        total_cost_kobo=total_cost_kobo,
        net_result_kobo=net_result_kobo,
    )
    db.add(archive)
    await db.flush()

    for ic in item_costs:
        item_id = ic.get("item_id")
        item = await db.get(FoodPackageItem, uuid.UUID(item_id)) if item_id else None
        db.add(FoodCollectionYearArchiveCost(
            archive_id=archive.id,
            item_id=item.id if item else None,
            item_name_snapshot=(item.name if item else ic.get("name") or "Unnamed item"),
            unit_cost_kobo=int(ic.get("unit_cost_kobo") or 0),
        ))

    # Stamp every entitlement swept into this close — this is what makes
    # the live oversight view fresh again going forward.
    for e in open_entitlements:
        e.archived_in_year_id = archive.id

    await db.flush()
    await log_action(
        db, actor_id=director.id, action="food.year.closed",
        entity_type="food_collection_year_archive", entity_id=str(archive.id),
        new_value={
            "year_label": year_label, "total_qualified": total_qualified,
            "total_collected": total_collected, "net_result_kobo": net_result_kobo,
        },
    )
    return {"id": str(archive.id), "year_label": year_label, "net_result_kobo": net_result_kobo}


@router.get("/year/archives")
async def list_archives(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(FoodCollectionYearArchive).order_by(FoodCollectionYearArchive.year_label.desc())
    )).scalars().all()
    return [
        {
            "id": str(r.id), "year_label": r.year_label, "closed_at": r.closed_at.isoformat(),
            "total_qualified": r.total_qualified, "total_collected": r.total_collected,
            "net_result_kobo": r.net_result_kobo,
        }
        for r in rows
    ]


@router.get("/year/archives/{year_label}")
async def get_archive_detail(year_label: str, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    archive = (await db.execute(
        select(FoodCollectionYearArchive)
        .options(selectinload(FoodCollectionYearArchive.cost_lines), selectinload(FoodCollectionYearArchive.closed_by_user))
        .where(FoodCollectionYearArchive.year_label == year_label)
    )).scalar_one_or_none()
    if not archive:
        raise HTTPException(status_code=404, detail="No archive found for that year")

    return {
        "id": str(archive.id),
        "year_label": archive.year_label,
        "closed_at": archive.closed_at.isoformat(),
        "closed_by": archive.closed_by_user.full_name if archive.closed_by_user else None,
        "total_qualified": archive.total_qualified,
        "total_collected": archive.total_collected,
        "total_not_collected": archive.total_not_collected,
        "total_customer_contributions_kobo": archive.total_customer_contributions_kobo,
        "adjustment_kobo": archive.adjustment_kobo,
        "adjustment_note": archive.adjustment_note,
        "total_cost_kobo": archive.total_cost_kobo,
        "net_result_kobo": archive.net_result_kobo,
        "cost_lines": [
            {"item_name": c.item_name_snapshot, "unit_cost_kobo": c.unit_cost_kobo}
            for c in archive.cost_lines
        ],
    }
