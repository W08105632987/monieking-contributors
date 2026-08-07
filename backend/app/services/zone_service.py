"""
Zone-based officer coverage. Exactly one officer per zone, always — see
012_zone_coverage.sql for the full design rationale.

users.zone_id is the fast, authoritative "who currently covers this
zone" pointer (customers' zone_id too — see the migration for how
authorization now reads this). zone_assignments is purely the audit
trail; the DB has a unique partial index backstopping "one active
assignment per officer/zone" as defense in depth, but the row locking
below is the actual mechanism that keeps a reassignment atomic and
correct under concurrent director actions.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.zone import Zone
from app.models.zone_assignment import ZoneAssignment


async def assign_officer_to_zone(
    db: AsyncSession,
    zone_id,
    officer_id,
    assigned_by_director_id,
) -> dict:
    """
    Assigns `officer_id` to `zone_id`, evicting whoever currently holds
    that zone (if anyone) and vacating whichever zone the officer
    previously covered (if any) — an officer can only ever hold one zone
    at a time, and a zone can only ever have one officer.

    Returns a dict describing what happened, for a clear confirmation
    message on the frontend (e.g. "Mary now covers Zone A — Lucy has
    been unassigned").
    """
    zone_result = await db.execute(select(Zone).where(Zone.id == zone_id))
    zone = zone_result.scalar_one_or_none()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    # Lock the officer row being assigned, and (if different) whoever
    # currently holds this zone — keeps a concurrent double-assignment
    # from interleaving badly. Locked in a consistent order (by id) to
    # avoid a deadlock against another simultaneous reassignment.
    officer_result = await db.execute(
        select(User).where(User.id == officer_id, User.role == UserRole.OFFICER).with_for_update()
    )
    officer = officer_result.scalar_one_or_none()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    current_holder_result = await db.execute(
        select(User).where(
            User.role == UserRole.OFFICER, User.zone_id == zone_id, User.id != officer_id,
        ).with_for_update()
    )
    current_holder = current_holder_result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    evicted_name = None
    vacated_zone_name = None

    # Evict whoever currently holds the target zone.
    if current_holder:
        evicted_name = current_holder.full_name
        await _close_active_assignment(db, current_holder.id, now)
        current_holder.zone_id = None

    # Vacate whichever zone this officer previously covered.
    if officer.zone_id and officer.zone_id != zone_id:
        prev_zone_result = await db.execute(select(Zone).where(Zone.id == officer.zone_id))
        prev_zone = prev_zone_result.scalar_one_or_none()
        vacated_zone_name = prev_zone.name if prev_zone else None
        await _close_active_assignment(db, officer.id, now)
    elif officer.zone_id == zone_id:
        # Already covering this zone — nothing to do.
        return {
            "message": f"{officer.full_name} already covers {zone.name}",
            "evicted_officer_name": None,
            "vacated_zone_name": None,
        }
    else:
        # Officer had no zone before — no previous assignment to close.
        pass

    officer.zone_id = zone_id
    db.add(ZoneAssignment(
        zone_id=zone_id,
        zone_name=zone.name,
        officer_id=officer.id,
        assigned_by_director_id=assigned_by_director_id,
        started_at=now,
        ended_at=None,
    ))

    await db.flush()

    return {
        "message": f"{officer.full_name} now covers {zone.name}",
        "evicted_officer_name": evicted_name,
        "vacated_zone_name": vacated_zone_name,
    }


async def unassign_officer(db: AsyncSession, officer_id, actor_id=None) -> dict:
    """Removes an officer from their current zone without assigning them
    anywhere new — the zone becomes uncovered until a director assigns
    someone else."""
    officer_result = await db.execute(
        select(User).where(User.id == officer_id, User.role == UserRole.OFFICER).with_for_update()
    )
    officer = officer_result.scalar_one_or_none()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")
    if not officer.zone_id:
        raise HTTPException(status_code=400, detail=f"{officer.full_name} isn't currently assigned to a zone")

    now = datetime.now(timezone.utc)
    zone_result = await db.execute(select(Zone).where(Zone.id == officer.zone_id))
    zone = zone_result.scalar_one_or_none()

    await _close_active_assignment(db, officer.id, now)
    officer.zone_id = None
    await db.flush()

    return {"message": f"{officer.full_name} removed from {zone.name if zone else 'their zone'}"}


async def _close_active_assignment(db: AsyncSession, officer_id, ended_at: datetime) -> None:
    result = await db.execute(
        select(ZoneAssignment).where(
            ZoneAssignment.officer_id == officer_id, ZoneAssignment.ended_at.is_(None),
        ).with_for_update()
    )
    active = result.scalar_one_or_none()
    if active:
        active.ended_at = ended_at
