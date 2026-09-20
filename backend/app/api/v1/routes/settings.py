import uuid
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOrAdmin
from app.models.settings import SystemConfig, PendingRateChange, PendingRateChangeStatus
from app.schemas.settings import (
    SystemConfigItem, SystemConfigUpdate,
    RateChangeRequest, RateChangePreview, PendingRateChangeResponse, RateChangeEditRequest,
)
from app.services.settings_service import get_config_value, set_config_value
from app.utils.audit import log_action

router = APIRouter(prefix="/settings", tags=["settings"])

# Keys that require the deferred-change flow instead of an immediate PATCH —
# these affect a per-customer number that's already locked in for the year.
DEFERRED_KEYS = {"food_card_rate_kobo"}


def _next_jan_1(from_date: date) -> date:
    return date(from_date.year + 1, 1, 1)


# ── Plain immediate settings ────────────────────────────────────
@router.get("/sms-fee")
async def get_sms_fee(db: AsyncSession = Depends(get_db)):
    """Fetch the active monthly SMS subscription fee configured by Directors."""
    val = await get_config_value(db, "monthly_sms_fee_kobo")
    fee_kobo = int(val) if val else 10000
    return {
        "monthly_sms_fee_kobo": fee_kobo,
        "monthly_sms_fee_naira": fee_kobo / 100,
    }


@router.get("", response_model=list[SystemConfigItem])
async def list_settings(director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
    return result.scalars().all()


@router.patch("/{key}", response_model=SystemConfigItem)
async def update_setting(
    key: str,
    body: SystemConfigUpdate,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    if key in DEFERRED_KEYS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{key}' can't be changed immediately — it affects an already-locked-in "
                "customer rate. Use POST /settings/rate-changes instead; the change will "
                "take effect on the next January 1st."
            ),
        )
    try:
        row = await set_config_value(db, key=key, value=body.value, updated_by=director.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return row


# ── Deferred rate changes ───────────────────────────────────────
@router.post("/rate-changes/preview", response_model=RateChangePreview)
async def preview_rate_change(
    body: RateChangeRequest,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    if body.setting_key not in DEFERRED_KEYS:
        raise HTTPException(status_code=400, detail=f"'{body.setting_key}' does not use the deferred-change flow")

    current_value = await get_config_value(db, body.setting_key)
    if current_value is None:
        raise HTTPException(status_code=404, detail="Unknown setting key")

    today = datetime.now(timezone.utc).date()
    effective_date = _next_jan_1(today)

    return RateChangePreview(
        setting_key=                     body.setting_key,
        current_value_kobo=              int(current_value),
        new_value_kobo=                  body.new_value_kobo,
        effective_date=                  effective_date,
        days_until_effective=            (effective_date - today).days,
        customers_will_be_notified_on=   date(effective_date.year - 1, 12, 31),
    )


@router.post("/rate-changes", response_model=PendingRateChangeResponse, status_code=201)
async def create_rate_change(
    body: RateChangeRequest,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    if body.setting_key not in DEFERRED_KEYS:
        raise HTTPException(status_code=400, detail=f"'{body.setting_key}' does not use the deferred-change flow")

    current_value = await get_config_value(db, body.setting_key)
    if current_value is None:
        raise HTTPException(status_code=404, detail="Unknown setting key")

    # Enforce "one active pending change per setting" at the app level too
    # (the DB also has a partial unique index as a hard backstop)
    existing = await db.execute(
        select(PendingRateChange).where(
            PendingRateChange.setting_key == body.setting_key,
            PendingRateChange.status == PendingRateChangeStatus.SCHEDULED,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="A change is already scheduled for this setting. Edit or cancel it instead of creating a new one.",
        )

    today = datetime.now(timezone.utc).date()
    effective_date = _next_jan_1(today)

    change = PendingRateChange(
        setting_key=        body.setting_key,
        current_value_kobo= int(current_value),
        new_value_kobo=      body.new_value_kobo,
        effective_date=      effective_date,
        created_by=           director.id,
    )
    db.add(change)
    await db.flush()

    await log_action(
        db,
        actor_id=    director.id,
        action=      "rate_change.scheduled",
        entity_type= "pending_rate_change",
        entity_id=   str(change.id),
        new_value=   {"setting_key": body.setting_key, "new_value_kobo": body.new_value_kobo, "effective_date": str(effective_date)},
    )

    resp = PendingRateChangeResponse.model_validate(change)
    resp.days_until_effective = (effective_date - today).days
    return resp


@router.get("/rate-changes", response_model=list[PendingRateChangeResponse])
async def list_rate_changes(director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PendingRateChange).order_by(PendingRateChange.created_at.desc()))
    rows = result.scalars().all()
    today = datetime.now(timezone.utc).date()
    out = []
    for row in rows:
        resp = PendingRateChangeResponse.model_validate(row)
        if row.status == PendingRateChangeStatus.SCHEDULED:
            resp.days_until_effective = (row.effective_date - today).days
        out.append(resp)
    return out


@router.patch("/rate-changes/{change_id}", response_model=PendingRateChangeResponse)
async def edit_rate_change(
    change_id: uuid.UUID,
    body: RateChangeEditRequest,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PendingRateChange).where(PendingRateChange.id == change_id))
    change = result.scalar_one_or_none()
    if not change:
        raise HTTPException(status_code=404, detail="Pending rate change not found")
    if change.status != PendingRateChangeStatus.SCHEDULED:
        raise HTTPException(status_code=400, detail=f"Can't edit a change that is already {change.status.value}")
    if change.notified_at is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Customers were already notified of this change on Dec 31 — the number they were "
                "told can't be silently changed now. Contact engineering to issue a correction notice instead."
            ),
        )

    old_value = change.new_value_kobo
    change.new_value_kobo = body.new_value_kobo
    await db.flush()

    await log_action(
        db,
        actor_id=    director.id,
        action=      "rate_change.edited",
        entity_type= "pending_rate_change",
        entity_id=   str(change.id),
        old_value=   {"new_value_kobo": old_value},
        new_value=   {"new_value_kobo": body.new_value_kobo},
    )

    today = datetime.now(timezone.utc).date()
    resp = PendingRateChangeResponse.model_validate(change)
    resp.days_until_effective = (change.effective_date - today).days
    return resp


@router.delete("/rate-changes/{change_id}", status_code=200)
async def cancel_rate_change(
    change_id: uuid.UUID,
    director: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PendingRateChange).where(PendingRateChange.id == change_id))
    change = result.scalar_one_or_none()
    if not change:
        raise HTTPException(status_code=404, detail="Pending rate change not found")
    if change.status != PendingRateChangeStatus.SCHEDULED:
        raise HTTPException(status_code=400, detail=f"Can't cancel a change that is already {change.status.value}")
    if change.notified_at is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Customers were already notified of this change on Dec 31 — it can no longer be "
                "silently cancelled. Contact engineering to issue a correction notice instead."
            ),
        )

    change.status       = PendingRateChangeStatus.CANCELLED
    change.cancelled_by = director.id
    change.cancelled_at = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db,
        actor_id=    director.id,
        action=      "rate_change.cancelled",
        entity_type= "pending_rate_change",
        entity_id=   str(change.id),
    )

    return {"message": "Pending rate change cancelled"}
