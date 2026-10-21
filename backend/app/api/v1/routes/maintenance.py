from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOrAdmin
from app.services import maintenance
from app.services.settings_service import set_config_value

router = APIRouter(tags=["maintenance"])


class MaintenanceBody(BaseModel):
    on: bool
    message: Optional[str] = Field(None, max_length=300)
    eta: Optional[str] = Field(None, max_length=40)   # ISO time the directors expect to be back, optional


@router.get("/maintenance")
async def get_maintenance(db: AsyncSession = Depends(get_db)):
    """Public: the app asks this, even before sign-in, to know whether to show the maintenance screen."""
    s = await maintenance.state(db)
    return {"on": s["on"], "message": s["message"], "eta": s["eta"], "started_at": s["started_at"]}


@router.put("/maintenance")
async def set_maintenance(body: MaintenanceBody, director: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """Director: turn maintenance on or off. Directors and admins keep full access while it is on."""
    await set_config_value(db, key="maintenance_mode", value="true" if body.on else "false", updated_by=director.id)
    await set_config_value(db, key="maintenance_message", value=(body.message or "").strip(), updated_by=director.id)
    await set_config_value(db, key="maintenance_eta", value=(body.eta or "").strip(), updated_by=director.id)
    await set_config_value(db, key="maintenance_started_at", value=datetime.now(timezone.utc).isoformat() if body.on else "", updated_by=director.id)
    maintenance.invalidate()
    s = await maintenance.state(db)
    return {"on": s["on"], "message": s["message"], "eta": s["eta"], "started_at": s["started_at"]}
