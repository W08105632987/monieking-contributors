"""/api/v1/provider — workers send claimed jobs to Techhub; directors control the services."""
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly, ServiceWorkerOnly
from app.provider import service as svc

router = APIRouter(prefix="/provider", tags=["provider"])


class AwaitBody(BaseModel):
    note: str = Field("", max_length=1000)


class TicketAction(BaseModel):
    action: str
    ticket_ref: str | None = Field(None, max_length=120)
    note: str | None = Field(None, max_length=500)


# ── worker ────────────────────────────────────────────────────────────────
@router.get("/jobs/{job_id}/preview")
async def preview(job_id: uuid.UUID, user: ServiceWorkerOnly, db: AsyncSession = Depends(get_db)):
    return await svc.preview(db, user, job_id)


@router.post("/jobs/{job_id}/send")
async def send(job_id: uuid.UUID, user: ServiceWorkerOnly, db: AsyncSession = Depends(get_db)):
    return await svc.submit_job(db, user, job_id)


@router.post("/jobs/{job_id}/await")
async def await_outcome(job_id: uuid.UUID, body: AwaitBody, user: ServiceWorkerOnly, db: AsyncSession = Depends(get_db)):
    return await svc.mark_awaiting(db, user, job_id, body.note)


@router.get("/awaiting")
async def awaiting(user: ServiceWorkerOnly, db: AsyncSession = Depends(get_db)):
    return await svc.list_awaiting(db, user)


# ── director ──────────────────────────────────────────────────────────────
@router.get("/admin/services")
async def admin_services(user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    from app.core.config import settings
    return {"services": await svc.admin_list(db), "techhub_key_set": bool(settings.TECHHUB_API_KEY)}


@router.put("/admin/services/{code}")
async def admin_update(code: str, body: dict, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await svc.admin_update(db, user, code, body)


@router.get("/admin/attention")
async def admin_attention(user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await svc.attention(db)


@router.post("/admin/tickets/{ticket_id}/resolve")
async def admin_resolve(ticket_id: uuid.UUID, body: TicketAction, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    return await svc.resolve_ticket(db, user, ticket_id, body.action, body.ticket_ref, body.note)
