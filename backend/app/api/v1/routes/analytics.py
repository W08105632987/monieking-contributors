"""
Live-metrics routes. Two very different trust levels on purpose:

- POST /analytics/track — deliberately open to anyone, logged in or
  not (the whole point is capturing pre-auth traffic too — the public
  landing page, the login screen). user_id/role are supplied by the
  CLIENT here rather than re-derived from a session cookie server-side,
  since the client already knows its own logged-in state and this data
  is never used for anything security-sensitive — only for aggregate
  counts on a dashboard. A forged user_id here can only skew analytics
  numbers, never grant access to anything.
- GET /analytics/overview — the opposite: strictly admin/director only,
  matching who the two dashboards consuming it are restricted to.
"""
from datetime import date
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.database import get_db
from app.core.dependencies import DirectorOrAdmin
from app.core.limiter import limiter
from app.services import analytics_service as svc

router = APIRouter(prefix="/analytics", tags=["analytics"])


class TrackEventRequest(BaseModel):
    event_type: str = Field(..., pattern="^(pageview|click)$")
    path: str = Field(..., max_length=2000)
    label: str | None = Field(None, max_length=500)
    session_id: str = Field(..., min_length=1, max_length=64)
    user_id: uuid.UUID | None = None
    role: str | None = None
    referrer: str | None = None


@router.post("/track", status_code=202)
@limiter.limit("120/minute")
async def track(request: Request, body: TrackEventRequest, db: AsyncSession = Depends(get_db)):
    """202 regardless of outcome — the frontend tracker never checks
    this response for success/failure (it's fired with sendBeacon on
    page unload half the time, which can't read a response at all), so
    there's nothing to gain from a more specific status code here, and
    a tracking failure must never look like a real error to whoever's
    using the app."""
    try:
        await svc.track_event(
            db, event_type=body.event_type, path=body.path, label=body.label,
            session_id=body.session_id, user_id=body.user_id, role=body.role, referrer=body.referrer,
        )
    except Exception:
        pass   # see docstring — tracking must never be able to break the app it's watching
    return {"ok": True}


@router.get("/overview")
async def overview(
    staff: DirectorOrAdmin,
    db: AsyncSession = Depends(get_db),
    start_date: date | None = None,
    end_date: date | None = None,
    all_time: bool = False,
):
    return await svc.get_overview(db, start_date=start_date, end_date=end_date, all_time=all_time)
