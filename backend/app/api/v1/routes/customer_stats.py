"""
Customer Statistics routes — the director/officer "accounting tool"
panel from the August 2026 directors' meeting. See
customer_stats_service.py for the shared aggregation logic; this file
is deliberately thin — role checks, scope resolution (which zone_id, if
any, a given caller is allowed to see), and wiring the service calls to
HTTP.
"""
import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin, OfficerOnly
from app.models.user import User, UserRole
from app.utils.audit import log_action
from app.services import customer_stats_service as svc

router = APIRouter(prefix="/customer-stats", tags=["customer-stats"])


async def _officer_zone_id(db: AsyncSession, officer_id: uuid.UUID) -> uuid.UUID:
    """Resolves an officer_id (as given by a director drilling into one
    officer) to that officer's current zone_id. Raises 404 if the id
    isn't an officer at all, and 409 if the officer has no zone —
    deliberately NOT falling back to None/platform-wide here, since a
    caller passing a real officer_id always means "this officer's zone
    stats", never "actually, show me everything"."""
    officer = (await db.execute(
        select(User).where(User.id == officer_id, User.role == UserRole.OFFICER)
    )).scalar_one_or_none()
    if officer is None:
        raise HTTPException(status_code=404, detail="Officer not found")
    if officer.zone_id is None:
        raise HTTPException(status_code=409, detail="Officer is not assigned to a zone")
    return officer.zone_id


@router.get("/overview")
async def get_overview(
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    officer_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    all_time: bool = False,
):
    """
    Director's Customer Statistics panel. No officer_id → platform-wide
    (general dashboard). officer_id given → that officer's zone (director
    → officer detail page) — a customer's zone assignment is what's
    authoritative here, not who originally registered them, same as the
    rest of the app.
    """
    zone_id = await _officer_zone_id(db, officer_id) if officer_id else None
    return await svc.get_overview_with_trend(db, zone_id=zone_id, start_date=start_date, end_date=end_date, all_time=all_time)


@router.get("/my-zone-overview")
async def get_my_zone_overview(
    officer: OfficerOnly,
    db: AsyncSession = Depends(get_db),
    start_date: date | None = None,
    end_date: date | None = None,
    all_time: bool = False,
):
    """Officer's own dashboard/detail page — always their own zone,
    never anyone else's, so there's no zone_id param to trust from the
    client here at all."""
    return await svc.get_overview_with_trend(db, zone_id=officer.zone_id, start_date=start_date, end_date=end_date, all_time=all_time)


@router.get("/officer-contribution")
async def get_officer_contribution(
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    officer_id: uuid.UUID = Query(...),
    start_date: date | None = None,
    end_date: date | None = None,
):
    """How much a given officer has personally gathered — day/week/
    custom range, shown alongside the Customer Statistics panel on the
    director → officer detail page."""
    await _officer_zone_id(db, officer_id)  # 404s if officer_id isn't a real officer
    return await svc.get_officer_contribution_stats(db, officer_id=officer_id, start_date=start_date, end_date=end_date)


@router.get("/inactive-customers")
async def list_inactive_customers(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    officer_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
):
    """
    The inactive-customer list with call/ping affordances. Directors get
    the universal definition only (all cards withdrawn or never funded);
    officers additionally get the "hasn't paid in 30 days" badge, since
    that definition is specifically an officer-side concept per the
    product decision.

    - Director, no officer_id → platform-wide, universal definition only.
    - Director, officer_id given → that officer's zone, universal only.
    - Officer → own zone, both definitions.
    """
    if current_user.role == UserRole.DIRECTOR:
        zone_id = await _officer_zone_id(db, officer_id) if officer_id else None
        include_officer_reason = False
    elif current_user.role == UserRole.OFFICER:
        zone_id = current_user.zone_id
        include_officer_reason = True
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    rows, total = await svc.get_inactive_customers(
        db, zone_id=zone_id, include_officer_reason=include_officer_reason,
        page=page, page_size=page_size,
    )
    return {
        "customers": [
            {
                "id": str(r.id),
                "customer_number": r.customer_number,
                "full_name": r.full_name,
                "phone_number": r.phone_number,
                "withdrawn_all": r.withdrawn_all,
                "no_recent_contribution": r.no_recent_contribution,
                "last_contribution_at": r.last_contribution_at.isoformat() if r.last_contribution_at else None,
                "last_contacted_at": r.last_contacted_at.isoformat() if r.last_contacted_at else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


class BulkPingRequest(BaseModel):
    """Body for POST /customer-stats/bulk-ping — a real schema rather
    than a raw dict, same reasoning as the MK-VALIDATION-001 fix on
    /notifications/broadcasts: malformed input should 422 cleanly, not
    reach a manual .get()/parse and risk an unhandled 500."""
    customer_ids: list[uuid.UUID] = Field(..., min_length=1)
    title: str = Field(default="Reminder from MonieKing", min_length=1, max_length=200)
    body: str = Field(..., min_length=1)


@router.post("/bulk-ping")
async def bulk_ping(
    current_user: CurrentUser,
    body: BulkPingRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Sends one notification to every customer id in body.customer_ids.
    The frontend passes the ids from whatever filtered inactive list is
    currently on screen — this endpoint doesn't re-derive "who's
    inactive" itself, it just enforces that every id is actually in the
    caller's scope before sending anything (an officer can only ping
    their own zone's customers; a director can ping anyone).
    """
    customer_ids = body.customer_ids
    title = body.title.strip()
    text  = body.body.strip()

    if current_user.role == UserRole.OFFICER:
        # Every id must belong to this officer's own zone — an officer
        # pinging outside their zone would be pinging customers they
        # have no legitimate reason to message.
        in_scope = (await db.execute(
            select(User.id).where(
                User.id.in_(customer_ids), User.zone_id == current_user.zone_id, User.role == UserRole.CUSTOMER,
            )
        )).scalars().all()
        if len(in_scope) != len(customer_ids):
            raise HTTPException(status_code=403, detail="Some customers are outside your zone")
    elif current_user.role != UserRole.DIRECTOR:
        raise HTTPException(status_code=403, detail="Access denied")

    sent = await svc.bulk_ping_customers(db, customer_ids=customer_ids, title=title, body=text)

    await log_action(
        db, actor_id=current_user.id, action="bulk_ping_customers",
        entity_type="user", entity_id=",".join(str(c) for c in customer_ids[:20]),
        new_value={"count": sent, "title": title},
    )
    await db.commit()
    return {"sent": sent}


@router.post("/mark-contacted/{customer_id}")
async def mark_contacted(
    officer: OfficerOnly,
    customer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Officer taps this after calling an inactive customer, whether or
    not the call led to a payment — keeps the inactive list from looking
    identical for "never tried" vs "tried, no answer yet"."""
    customer = (await db.execute(
        select(User).where(User.id == customer_id, User.role == UserRole.CUSTOMER)
    )).scalar_one_or_none()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.zone_id != officer.zone_id:
        raise HTTPException(status_code=403, detail="Customer is outside your zone")

    await svc.mark_customer_contacted(db, customer_id=customer_id)
    await db.commit()
    return {"message": "Marked as contacted"}
