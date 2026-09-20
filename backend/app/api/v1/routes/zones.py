import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.dependencies import CurrentUser, DirectorOrAdmin
from app.models.zone import Zone

router = APIRouter(prefix="/zones", tags=["zones"])


class ZoneCreate(BaseModel):
    name: str
    description: str | None = None


class ZoneResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    officer_count: int = 0
    current_officer_name: str | None = None

    class Config:
        from_attributes = True


@router.get("", response_model=list[ZoneResponse])
async def list_zones(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func
    from app.models.user import User, UserRole

    result = await db.execute(
        select(Zone, func.count(User.id), func.max(User.full_name))
        .outerjoin(User, (User.zone_id == Zone.id) & (User.role == UserRole.OFFICER))
        .group_by(Zone.id)
        .order_by(Zone.name)
    )
    return [
        ZoneResponse(
            id=zone.id, name=zone.name, description=zone.description, created_at=zone.created_at,
            officer_count=count, current_officer_name=officer_name,
        )
        for zone, count, officer_name in result.all()
    ]


@router.post("", response_model=ZoneResponse, status_code=201)
async def create_zone(body: ZoneCreate, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Zone).where(Zone.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A zone with this name already exists")

    zone = Zone(name=body.name, description=body.description)
    db.add(zone)
    await db.flush()
    return zone


@router.delete("/{zone_id}", status_code=200)
async def delete_zone(zone_id: uuid.UUID, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """
    Deleting a zone is safe even if officers or customers are currently
    assigned to it — the zone_id foreign key is ON DELETE SET NULL (see
    001_initial_schema.sql), so they just become unassigned rather than
    orphaned or blocking the delete. The frontend warns the director if
    the zone is currently in use, but doesn't need to block it here.
    """
    result = await db.execute(select(Zone).where(Zone.id == zone_id))
    zone = result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    await db.delete(zone)
    await db.flush()
    return {"message": "Zone deleted"}


class AssignOfficerRequest(BaseModel):
    officer_id: uuid.UUID


@router.post("/{zone_id}/assign")
async def assign_officer(
    zone_id: uuid.UUID,
    body: AssignOfficerRequest,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    """
    Assigns an officer to cover this zone — exactly one officer per zone,
    always. If someone else currently covers this zone, they're
    automatically unassigned (evicted). If the officer being assigned
    was covering a different zone, that zone becomes uncovered.
    """
    from app.services.zone_service import assign_officer_to_zone
    return await assign_officer_to_zone(db, zone_id, body.officer_id, director.id)
