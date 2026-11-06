"""Director's alert console: the incident history, acknowledge / resolve, whether the alert channels themselves work, and a
test button that sends a real email (and optionally SMS) so you KNOW alerts will reach you before you need them."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.system_alert import SystemAlert
from app.services import alert_service
from app.utils.audit import log_action

router = APIRouter(prefix="/system-alerts", tags=["system-alerts"])


def _row(a: SystemAlert) -> dict:
    return {"id": str(a.id), "severity": a.severity, "category": a.category, "title": a.title, "detail": a.detail, "occurrences": a.occurrences,
            "status": a.status, "created_at": a.created_at.isoformat(), "last_seen_at": a.last_seen_at.isoformat(),
            "emailed_at": a.emailed_at.isoformat() if a.emailed_at else None, "email_ok": a.email_ok,
            "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None}


@router.get("")
async def list_alerts(director: DirectorOnly, status: str = "active", db: AsyncSession = Depends(get_db)):
    q = select(SystemAlert).order_by(SystemAlert.last_seen_at.desc()).limit(100)
    if status == "active":
        q = q.where(SystemAlert.status != "resolved")
    elif status in ("open", "acknowledged", "resolved"):
        q = q.where(SystemAlert.status == status)
    rows = (await db.execute(q)).scalars().all()
    active = (await db.execute(select(func.count()).select_from(SystemAlert).where(SystemAlert.status != "resolved"))).scalar() or 0
    critical = (await db.execute(select(func.count()).select_from(SystemAlert).where(SystemAlert.status != "resolved", SystemAlert.severity == "critical"))).scalar() or 0
    return {"alerts": [_row(a) for a in rows], "active": int(active), "critical": int(critical)}


@router.get("/summary")
async def summary(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Small and cheap: powers the dashboard banner."""
    active = (await db.execute(select(func.count()).select_from(SystemAlert).where(SystemAlert.status != "resolved"))).scalar() or 0
    critical = (await db.execute(select(func.count()).select_from(SystemAlert).where(SystemAlert.status != "resolved", SystemAlert.severity == "critical"))).scalar() or 0
    st = await alert_service.alerting_status()
    return {"active": int(active), "critical": int(critical), "alerting_ready": st["ready"], "alerting_problems": st["problems"][:3]}


@router.get("/status")
async def alerting_status(director: DirectorOnly):
    return await alert_service.alerting_status()


async def _get(db: AsyncSession, alert_id: uuid.UUID) -> SystemAlert:
    a = await db.get(SystemAlert, alert_id)
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    return a


@router.post("/{alert_id}/acknowledge")
async def acknowledge(alert_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    a = await _get(db, alert_id)
    if a.status == "open":
        a.status, a.acknowledged_by, a.acknowledged_at = "acknowledged", director.id, datetime.now(timezone.utc)
        await log_action(db, actor_id=director.id, action="alert.acknowledged", entity_type="system_alert", entity_id=str(a.id), new_value={"title": a.title})
        await db.flush()
    return _row(a)


@router.post("/{alert_id}/resolve")
async def resolve(alert_id: uuid.UUID, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    a = await _get(db, alert_id)
    if a.status != "resolved":
        a.status, a.resolved_at = "resolved", datetime.now(timezone.utc)
        await log_action(db, actor_id=director.id, action="alert.resolved", entity_type="system_alert", entity_id=str(a.id), new_value={"title": a.title})
        await db.flush()
    return _row(a)


class TestBody(BaseModel):
    include_sms: bool = False


@router.post("/test")
async def send_test(body: TestBody, director: DirectorOnly):
    """Sends a REAL alert through the whole pipeline and reports what happened. Run it after any change to email/SMS settings."""
    before = await alert_service.alerting_status()
    await alert_service.raise_alert(
        severity="critical" if body.include_sms else "warning", category="messaging", title="TEST alert: if you can read this, alerts reach you",
        detail={"sent_by": director.full_name, "note": "This is only a test. Nothing is wrong."}, notify="always", sms=body.include_sms)
    after = await alert_service.alerting_status()
    delivered = after["email_last_ok"] and after["email_last_ok"] != before["email_last_ok"]
    return {"email_sent": bool(delivered), "recipients": after["recipients"], "problems": after["problems"],
            "email_last_fail_reason": None if delivered else after["email_last_fail_reason"], "sms_requested": body.include_sms}
