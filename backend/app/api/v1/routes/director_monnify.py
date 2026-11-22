"""Monnify center: director-only view of everything Monnify holds, owes and has processed for us."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.services import monnify_center_service as mc
from app.services import settings_service as cfg
from app.utils.audit import log_action

router = APIRouter(prefix="/director/monnify", tags=["monnify-center"])


def _period(start: date | None, end: date | None) -> tuple[date, date]:
    today = datetime.now(mc.WAT).date()
    end = end or today
    start = start or end - timedelta(days=6)
    if start > end:
        raise HTTPException(status_code=422, detail="The start date is after the end date.")
    if (end - start).days > 400:
        raise HTTPException(status_code=422, detail="Pick a period of at most 400 days.")
    return start, end


@router.get("/center")
async def get_center(director: DirectorOnly, start: date | None = None, end: date | None = None, db: AsyncSession = Depends(get_db)):
    s, e = _period(start, end)
    return await mc.center(db, s, e)


@router.get("/transactions")
async def get_transactions(director: DirectorOnly, start: date | None = None, end: date | None = None, section: str | None = Query(None, pattern="^(funding|bills|withdrawals)$"),
                           status: str | None = Query(None, max_length=40), q: str | None = Query(None, max_length=80),
                           limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    s, e = _period(start, end)
    return await mc.transactions(db, s, e, section, status, q, limit, offset)


class MonnifySettings(BaseModel):
    warning_naira: float | None = Field(None, ge=0, le=1_000_000_000)
    critical_naira: float | None = Field(None, ge=0, le=1_000_000_000)
    settlement_days: int | None = Field(None, ge=0, le=10)
    late_alerts_enabled: bool | None = None


@router.put("/settings")
async def save_settings(body: MonnifySettings, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    cur = await mc.thresholds(db)
    warn = body.warning_naira if body.warning_naira is not None else cur["warning_naira"]
    crit = body.critical_naira if body.critical_naira is not None else cur["critical_naira"]
    if crit > warn:
        raise HTTPException(status_code=422, detail="The critical level must be lower than the warning level.")
    if body.warning_naira is not None or body.critical_naira is not None:
        await cfg.set_config_value(db, key=mc.WARNING_KEY, value=str(warn), updated_by=director.id)
        await cfg.set_config_value(db, key=mc.CRITICAL_KEY, value=str(crit), updated_by=director.id)
    if body.settlement_days is not None:
        await cfg.set_config_value(db, key=mc.SETTLEMENT_DAYS_KEY, value=str(body.settlement_days), updated_by=director.id)
    if body.late_alerts_enabled is not None:
        await cfg.set_config_value(db, key=mc.LATE_ALERT_KEY, value="true" if body.late_alerts_enabled else "false", updated_by=director.id)
    await log_action(db, actor_id=director.id, action="monnify.settings", entity_type="system_config", entity_id="monnify",
                     new_value=body.model_dump(exclude_none=True))
    await db.commit()
    return await mc.center(db, *_period(None, None))
