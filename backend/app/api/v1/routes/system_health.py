"""System health routes — admin/director-only, backs the CRM's status
page and (later, if wanted) a director-portal equivalent."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOrAdmin
from app.services import health_service as svc

router = APIRouter(prefix="/system-health", tags=["system-health"])


@router.get("/status")
async def get_status(staff: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    return await svc.get_current_status(db)


@router.post("/run-now")
async def run_now(staff: DirectorOrAdmin, db: AsyncSession = Depends(get_db)):
    """Manual trigger — for confirming the monitor and alert channels
    actually work, without waiting up to 3 minutes for the next
    scheduled run. Runs inline in the request rather than via Celery so
    the response itself confirms completion."""
    results = await svc.run_all_checks(db)
    return {"results": results}
