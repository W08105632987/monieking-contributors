"""Send a claimed job to Techhub, wait for the outcome, then pay the worker or refund the customer.

Money rules:
  * the customer was charged when the job was submitted (existing behaviour) and is refunded in full
    when the provider fails the request, unless a director switched the refund off for that service;
  * the worker's commission is paid only when the provider reports success;
  * a job is sent to the provider AT MOST ONCE (a ticket row is written before the call and is unique
    per job). If we cannot tell whether a request went through, nothing is ever re-sent automatically:
    a director decides;
  * a job in the waiting state is never returned to the pool by the SLA timer."""
from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.job_pool_event import JobPoolEvent
from app.models.manual_service_request import CommissionStatus, ManualServiceRequest, ManualServiceStatus
from app.models.notification import NotificationType
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.models.user import User, UserRole
from app.provider import client, defaults
from app.provider import rules as R
from app.provider.models import ProviderServiceConfig, ProviderTicket
from app.services import job_pool_service as jp
from app.services.notification_service import send_notification
from app.services.refund_rules import naira
from app.services.refund_service import refund_manual_job
from app.utils.audit import log_action

logger = logging.getLogger(__name__)
OPEN = ("sending", "pending", "unknown")
MAX_FILE_BYTES = 5 * 1024 * 1024
SYSTEM_NOTE = "Techhub"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def cfg_to_dict(code: str, row: ProviderServiceConfig | None) -> dict:
    base = defaults.DEFAULT_CONFIGS.get(code, {})
    d = {
        "service_code": code, "enabled": False, "endpoint": base.get("endpoint", ""),
        "field_map": base.get("field_map", {}), "value_maps": base.get("value_maps", {}),
        "static_params": base.get("static_params", {}), "file_params": base.get("file_params", {}),
        "applies_when": base.get("applies_when", {}), "status_param": base.get("status_param", "ticket_id"),
        "refund_on_failure": True, "alert_after_days": 5, "poll_minutes": 30,
    }
    if row is not None:
        for k in list(d):
            if k != "service_code":
                d[k] = getattr(row, k)
    return d


async def get_cfg(db: AsyncSession, code: str) -> dict | None:
    """None if this service is not a provider service at all."""
    row = await db.get(ProviderServiceConfig, code)
    if row is None and code not in defaults.DEFAULT_CONFIGS:
        return None
    return cfg_to_dict(code, row)


async def has_open_ticket(db: AsyncSession, job_id: uuid.UUID) -> bool:
    return (await db.execute(select(ProviderTicket.id).where(
        ProviderTicket.job_id == job_id, ProviderTicket.status.in_(OPEN)).limit(1))).first() is not None


async def _directors(db: AsyncSession) -> list[User]:
    return list((await db.scalars(select(User).where(User.role == UserRole.DIRECTOR))).all())


async def tell_directors(db: AsyncSession, title: str, body: str, job_id: uuid.UUID | None = None) -> None:
    for d in await _directors(db):
        await send_notification(db, user_id=d.id, title=title, body=body, type=NotificationType.WARNING,
                                related_entity_id=job_id)
    try:
        from app.verification.service import alert_directors
        await alert_directors(f"MonieKing: {title}", body)
    except Exception:
        logger.warning("director alert could not be sent")


def _view(job: ManualServiceRequest) -> dict:
    return R.job_view(job.form_data, job.service_type)


# ── worker: preview / send ────────────────────────────────────────────────
async def _worker_job(db: AsyncSession, actor: User, job_id: uuid.UUID, *, lock: bool = False) -> ManualServiceRequest:
    q = select(ManualServiceRequest).where(ManualServiceRequest.id == job_id)
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    job = (await db.execute(q)).scalar_one_or_none()
    if job is None or job.claimed_by_id != actor.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


async def preview(db: AsyncSession, actor: User, job_id: uuid.UUID) -> dict:
    job = await _worker_job(db, actor, job_id)
    cfg = await get_cfg(db, job.service_category)
    out = {"available": False, "reason": "", "sent": False, "params": [], "files": [], "service_code": job.service_category,
           "provider_service": cfg is not None, "title": defaults.TITLES.get(job.service_category, "")}
    if cfg is None:
        out["reason"] = "This service is not handled through Techhub."
        return out
    ticket = (await db.scalars(select(ProviderTicket).where(ProviderTicket.job_id == job.id))).first()
    if ticket:
        return {**out, "sent": True, "reason": "Already sent to Techhub."}
    if job.status != ManualServiceStatus.PROCESSING:
        out["reason"] = "Only a job you are working on can be sent."
        return out
    ok, why = R.eligibility(cfg, _view(job))
    out["available"], out["reason"] = ok, why
    if ok:
        payload, _, files = R.build_payload(cfg, _view(job))
        out["params"] = [{"name": k, "value": R.mask_for_preview(k, v)} for k, v in payload.items()]
        out["files"] = sorted(files)
    return out


async def _load_file_b64(src: str) -> str:
    if src.startswith("data:") and "base64," in src[:100]:
        b64 = src.split("base64,", 1)[1]
        if len(b64) * 3 // 4 > MAX_FILE_BYTES:
            raise ValueError("The uploaded file is too large (max 5MB).")
        return b64
    base = (settings.SUPABASE_URL or "").rstrip("/")
    if not base or not src.startswith(base + "/storage/"):
        raise ValueError("The uploaded file is not stored in our storage, so it cannot be sent.")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as c:
            r = await c.get(src)
    except httpx.HTTPError:
        raise ValueError("The uploaded file could not be loaded right now. Please try again.")
    if r.status_code != 200 or len(r.content) > MAX_FILE_BYTES:
        raise ValueError("The uploaded file could not be loaded or is too large.")
    return base64.b64encode(r.content).decode()


async def submit_job(db: AsyncSession, actor: User, job_id: uuid.UUID) -> dict:
    job = await _worker_job(db, actor, job_id, lock=True)
    cfg = await get_cfg(db, job.service_category)
    if cfg is None:
        raise HTTPException(status_code=400, detail="This service is not handled through Techhub.")
    existing = (await db.scalars(select(ProviderTicket).where(ProviderTicket.job_id == job.id))).first()
    if existing:
        return {"status": existing.status, "already_sent": True}      # a double tap is a no-op
    if job.status != ManualServiceStatus.PROCESSING:
        raise HTTPException(status_code=409, detail="Only a job you are working on can be sent.")
    ok, why = R.eligibility(cfg, _view(job))
    if not ok:
        raise HTTPException(status_code=422, detail=why)
    payload, _, files = R.build_payload(cfg, _view(job))
    try:
        for param, src in files.items():
            payload[param] = await _load_file_b64(src)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # 1) write the guard row and commit BEFORE calling out: a crash or double tap can never send twice
    ticket = ProviderTicket(job_id=job.id, service_code=job.service_category, seq=1, status="sending",
                            submitted_by=actor.id)
    db.add(ticket)
    await db.commit()
    ticket_id = ticket.id

    out = await client.submit(cfg["endpoint"], payload)

    job = await _worker_job(db, actor, job_id, lock=True)
    ticket = await db.get(ProviderTicket, ticket_id)
    if out.kind in ("rejected", "busy", "auth", "off", "balance"):
        await db.delete(ticket)            # nothing was charged and nothing is waiting: the worker can fix and retry
        await db.commit()
        if out.kind in ("auth", "off", "balance"):
            await tell_directors(db, "Techhub service problem",
                                 f"{defaults.TITLES.get(job.service_category, job.service_category)}: {out.message}")
            await db.commit()
        raise HTTPException(status_code=422 if out.kind == "rejected" else 503, detail=out.message)

    now = _now()
    job.status, job.expires_at = ManualServiceStatus.AWAITING_PROVIDER, None
    if out.kind == "ok":
        ticket.status, ticket.ticket_ref, ticket.cost_raw = "pending", out.ticket_ref, out.cost_raw
        ticket.provider_note = out.message[:500] or None
        event = "sent_to_provider"
    else:   # unknown: it may have gone through. Park it; never re-send automatically.
        ticket.status = "unknown"
        ticket.provider_note = out.message[:500] or None
        event = "provider_send_unclear"
    db.add(JobPoolEvent(job_id=job.id, event_type=event, actor_id=actor.id,
                        details={"service": job.service_category, "ticket": ticket.ticket_ref, "at": now.isoformat()}))
    title = defaults.TITLES.get(job.service_category, "Service")
    await send_notification(db, user_id=job.user_id, title="Request being processed",
                            body=f"Your {title} request has been sent for processing. We will tell you as soon as there is an outcome.",
                            type=NotificationType.INFO, related_entity_id=job.id)
    await log_action(db, actor_id=actor.id, action="provider.job_sent", entity_type="manual_service_request",
                     entity_id=str(job.id), new_value={"service": job.service_category, "kind": out.kind})
    await db.commit()
    if out.kind == "unknown":
        await tell_directors(db, "Techhub request needs a check",
                             f"A {title} request was sent but Techhub's answer was unclear. Check the Techhub dashboard, "
                             "then open Provider services in the director area to say whether it went through.", job.id)
        await db.commit()
    return {"status": ticket.status, "already_sent": False, "unclear": out.kind == "unknown"}


async def mark_awaiting(db: AsyncSession, actor: User, job_id: uuid.UUID, note: str) -> dict:
    """A worker finished their part of a manual job that now depends on someone else: park it under them."""
    note = (note or "").strip()
    if len(note) < 5:
        raise HTTPException(status_code=422, detail="Say what you are waiting for (at least a few words).")
    job = await _worker_job(db, actor, job_id, lock=True)
    if job.status != ManualServiceStatus.PROCESSING:
        raise HTTPException(status_code=409, detail="Only a job you are working on can be moved to Awaiting outcome.")
    job.status, job.expires_at = ManualServiceStatus.AWAITING_PROVIDER, None
    job.worker_additional_info = note[:1000]
    db.add(JobPoolEvent(job_id=job.id, event_type="awaiting_outcome", actor_id=actor.id, details={"note": note[:200]}))
    await send_notification(db, user_id=job.user_id, title="Request being processed",
                            body="Your request is being processed. We will tell you as soon as there is an outcome.",
                            type=NotificationType.INFO, related_entity_id=job.id)
    await db.commit()
    return {"status": "awaiting_provider"}


async def list_awaiting(db: AsyncSession, actor: User) -> list[dict]:
    jobs = (await db.scalars(select(ManualServiceRequest).where(
        ManualServiceRequest.claimed_by_id == actor.id,
        ManualServiceRequest.status == ManualServiceStatus.AWAITING_PROVIDER,
    ).order_by(ManualServiceRequest.claimed_at))).all()
    tickets = {}
    if jobs:
        for t in (await db.scalars(select(ProviderTicket).where(ProviderTicket.job_id.in_([j.id for j in jobs])))).all():
            tickets[t.job_id] = t
    now = _now()
    out = []
    for j in jobs:
        t = tickets.get(j.id)
        since = t.submitted_at if t else (j.claimed_at or j.created_at)
        out.append({
            "id": str(j.id), "service_category": j.service_category, "service_type": j.service_type,
            "title": defaults.TITLES.get(j.service_category) or j.service_category.replace("_", " ").title(),
            "price_kobo": j.price_kobo, "created_at": j.created_at.isoformat(),
            "waiting_since": since.isoformat(), "days_waiting": (now - since).days,
            "via_provider": t is not None, "ticket_status": t.status if t else None,
            "ticket_ref": t.ticket_ref if t else None, "provider_note": t.provider_note if t else None,
            "note": j.worker_additional_info,
        })
    return out


# ── finishing a job (called by the poller and by director overrides) ──────
async def _finish_success(db: AsyncSession, job: ManualServiceRequest, ticket: ProviderTicket, note: str, extras: dict) -> None:
    now = _now()
    commission = await jp.compute_commission(db, job)
    job.status, job.worker_status, job.expires_at = ManualServiceStatus.SUCCESSFUL, "successful", None
    job.worker_response = R.success_text(job.service_category, note, extras)
    job.worker_remarks = "Completed through Techhub"
    job.worker_commission_kobo, job.commission_status, job.completed_at = commission, CommissionStatus.CLEARED, now
    if job.claimed_by_id:
        await jp.credit_worker_commission(db, job.claimed_by_id, commission)
    ticket.status, ticket.closed_at, ticket.provider_note = "success", now, note[:500] or None
    ticket.result = {k: ("***" if k == "bvn" else v) for k, v in extras.items()}    # the BVN itself lives only in the job text the customer sees
    db.add(JobPoolEvent(job_id=job.id, event_type="resolved", actor_id=job.claimed_by_id,
                        details={"status": "successful", "via": "techhub", "commission_kobo": commission}))
    title = defaults.TITLES.get(job.service_category, "Service")
    await send_notification(db, user_id=job.user_id, title="Service Request Successful",
                            body=f"Your {title} request was completed. Open it to see the result.",
                            type=NotificationType.SUCCESS, related_entity_id=job.id)
    if job.claimed_by_id:
        await send_notification(db, user_id=job.claimed_by_id, title="Job completed",
                                body=f"The {title} job you sent to Techhub succeeded. Commission {naira(commission)} added.",
                                type=NotificationType.SUCCESS, related_entity_id=job.id)
    await _notify_officer(db, job, f"The {title} request you submitted for a customer was completed.", NotificationType.SUCCESS)


async def _finish_failed(db: AsyncSession, job: ManualServiceRequest, ticket: ProviderTicket, note: str,
                         refund: bool, actor_id: uuid.UUID | None) -> int:
    """Fail the job and (if the service's policy says so) refund the customer. Returns kobo refunded.
    Raises ValueError (nothing changed) if the refund cannot be made."""
    now = _now()
    refunded = 0
    if refund:
        refunded = await refund_manual_job(db, job, actor_id=actor_id or job.claimed_by_id or job.user_id, why="provider failed the request")
    job.status, job.worker_status, job.expires_at = ManualServiceStatus.FAILED, "failed", None
    job.worker_response = "Techhub could not complete this request." + (f" {note}" if note else "")
    job.worker_remarks = note[:500] or "The provider could not complete this request."
    job.worker_commission_kobo, job.completed_at = 0, now
    ticket.status, ticket.closed_at, ticket.provider_note = "failed", now, note[:500] or None
    db.add(JobPoolEvent(job_id=job.id, event_type="resolved", actor_id=job.claimed_by_id,
                        details={"status": "failed", "via": "techhub", "refund_kobo": refunded}))
    title = defaults.TITLES.get(job.service_category, "Service")
    extra = f" {naira(refunded)} has been returned to your wallet." if refunded else ""
    await send_notification(db, user_id=job.user_id, title="Service Request Failed",
                            body=f"Your {title} request could not be completed." + (f" Reason: {note}." if note else "") + extra,
                            type=NotificationType.ERROR, related_entity_id=job.id)
    if job.claimed_by_id:
        await send_notification(db, user_id=job.claimed_by_id, title="Job failed at Techhub",
                                body=f"The {title} job you sent to Techhub failed" + (f": {note}" if note else "") + ". No commission is paid.",
                                type=NotificationType.ERROR, related_entity_id=job.id)
    await _notify_officer(db, job, f"The {title} request you submitted for a customer could not be completed.", NotificationType.ERROR)
    return refunded


async def _notify_officer(db: AsyncSession, job: ManualServiceRequest, body: str, kind: NotificationType) -> None:
    oid = (job.form_data or {}).get("submitted_by_officer_id")
    try:
        officer_id = uuid.UUID(oid) if oid else None
    except ValueError:
        officer_id = None
    if officer_id and officer_id != job.user_id:
        await send_notification(db, user_id=officer_id, title="Service request update", body=body, type=kind,
                                related_entity_id=job.id)


# ── poller (Celery) ───────────────────────────────────────────────────────
async def poll_open_tickets(db: AsyncSession, limit: int = 60) -> dict:
    now = _now()
    tickets = (await db.scalars(select(ProviderTicket).where(ProviderTicket.status == "pending")
                                .order_by(ProviderTicket.last_checked_at.asc().nullsfirst()).limit(limit * 3))).all()
    stats = {"checked": 0, "success": 0, "failed": 0, "alerts": 0, "stuck_refunds": 0}
    done = 0
    for t in tickets:
        if done >= limit:
            break
        cfg = await get_cfg(db, t.service_code)
        if cfg is None or not t.ticket_ref:
            continue
        # overdue alert (independent of the check below)
        if R.overdue(t.submitted_at, now, cfg["alert_after_days"], t.alerted_at):
            t.alerted_at = now
            job = await db.get(ManualServiceRequest, t.job_id)
            title = defaults.TITLES.get(t.service_code, t.service_code)
            await tell_directors(db, "Techhub request is taking long",
                                 f"A {title} request has been waiting {cfg['alert_after_days']}+ days at Techhub "
                                 f"(reference {t.ticket_ref}). Open Provider services to decide what to do.", t.job_id)
            stats["alerts"] += 1
            await db.commit()
        if not R.due_for_check(t.last_checked_at, t.submitted_at, now, cfg["poll_minutes"]):
            continue
        done += 1
        kind, body = await client.check(cfg["endpoint"], cfg["status_param"], t.ticket_ref)
        t.last_checked_at = now
        stats["checked"] += 1
        if kind != "ok":
            await db.commit()
            continue
        state, note, extras = R.parse_check_body(body)
        if state == "pending":
            if note:
                t.provider_note = note[:500]
            await db.commit()
            continue
        job = (await db.execute(select(ManualServiceRequest).where(ManualServiceRequest.id == t.job_id)
                                .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if job is None or job.status != ManualServiceStatus.AWAITING_PROVIDER:
            t.status, t.closed_at = state, now
            await db.commit()
            continue
        try:
            async with db.begin_nested():
                if state == "success":
                    await _finish_success(db, job, t, note, extras)
                else:
                    await _finish_failed(db, job, t, note, cfg["refund_on_failure"], None)
            stats[state] += 1
        except ValueError as e:      # refund blocked (e.g. wallet frozen): keep waiting, tell a director once
            t.provider_note = f"Failed at Techhub but could not refund: {e}"[:500]
            stats["stuck_refunds"] += 1
            await tell_directors(db, "Refund blocked", f"A failed Techhub request could not be refunded: {e}", t.job_id)
        except Exception:        # one bad ticket must never stop the others from being checked
            logger.exception("provider poll: could not finish ticket %s", t.id)
            stats["errors"] = stats.get("errors", 0) + 1
            await db.rollback()
            continue
        await db.commit()
    return stats


# ── director ──────────────────────────────────────────────────────────────
async def _form_keys(db: AsyncSession, code: str) -> set[str] | None:
    tpl = (await db.scalars(select(ServiceTemplate).where(ServiceTemplate.service_code == code))).first()
    if tpl is None or tpl.current_version_id is None:
        return None
    ver = await db.get(ServiceTemplateVersion, tpl.current_version_id)
    if ver is None:
        return None
    sc = ver.schema or {}
    keys = {f["key"] for f in sc.get("fields", [])} | {s["key"] for s in sc.get("selectors", [])}
    keys |= {e["key"] for e in sc.get("legacy_extras", [])} | set((sc.get("legacy_key_aliases") or {}).values())
    keys |= {"service_type"}
    return keys


async def admin_list(db: AsyncSession) -> list[dict]:
    rows = {r.service_code: r for r in (await db.scalars(select(ProviderServiceConfig))).all()}
    codes = list(defaults.DEFAULT_CONFIGS) + [c for c in rows if c not in defaults.DEFAULT_CONFIGS]
    tpls = {t.service_code: t for t in (await db.scalars(select(ServiceTemplate).where(ServiceTemplate.service_code.in_(codes)))).all()}
    open_counts = {}
    for t in (await db.scalars(select(ProviderTicket).where(ProviderTicket.status.in_(OPEN)))).all():
        open_counts[t.service_code] = open_counts.get(t.service_code, 0) + 1
    out = []
    for code in codes:
        d = cfg_to_dict(code, rows.get(code))
        tpl = tpls.get(code)
        d.update({
            "title": defaults.TITLES.get(code) or (tpl.title if tpl else code),
            "template_exists": tpl is not None, "template_enabled": bool(tpl and tpl.is_enabled),
            "form_keys": sorted(await _form_keys(db, code) or []), "open_tickets": open_counts.get(code, 0),
            "saved": code in rows,
        })
        out.append(d)
    return out


async def admin_update(db: AsyncSession, director: User, code: str, patch: dict) -> dict:
    if code not in defaults.DEFAULT_CONFIGS and await db.get(ProviderServiceConfig, code) is None:
        raise HTTPException(status_code=404, detail="Unknown provider service.")
    allowed = {"enabled", "endpoint", "field_map", "value_maps", "static_params", "file_params", "applies_when",
               "status_param", "refund_on_failure", "alert_after_days", "poll_minutes"}
    patch = {k: v for k, v in patch.items() if k in allowed}
    errors = R.validate_config_patch(patch, await _form_keys(db, code))
    for k in ("value_maps", "static_params", "applies_when"):
        if k in patch and not isinstance(patch[k], dict):
            errors.append(f"{k} must be an object.")
    if errors:
        raise HTTPException(status_code=422, detail=errors[0])
    row = await db.get(ProviderServiceConfig, code)
    if row is None:
        row = ProviderServiceConfig(service_code=code, **{k: v for k, v in cfg_to_dict(code, None).items() if k != "service_code"})
        db.add(row)
    if patch.get("enabled") is True and not settings.TECHHUB_API_KEY:
        raise HTTPException(status_code=422, detail="The Techhub key is not set on the server, so this cannot be switched on yet.")
    old = {k: getattr(row, k, None) for k in patch}
    for k, v in patch.items():
        setattr(row, k, v)
    row.updated_by = director.id
    await log_action(db, actor_id=director.id, action="provider.config_updated", entity_type="provider_service_config",
                     entity_id=code, old_value={k: old[k] for k in old if k in ("enabled", "refund_on_failure", "alert_after_days", "poll_minutes", "endpoint")},
                     new_value={k: v for k, v in patch.items() if k in ("enabled", "refund_on_failure", "alert_after_days", "poll_minutes", "endpoint")})
    await db.flush()
    return cfg_to_dict(code, row)


async def attention(db: AsyncSession) -> list[dict]:
    """Tickets a director must look at: unclear sends, and anything past its alert days."""
    now = _now()
    rows = (await db.scalars(select(ProviderTicket).where(ProviderTicket.status.in_(("unknown", "sending", "pending"))))).all()
    out = []
    for t in rows:
        cfg = await get_cfg(db, t.service_code) or {"alert_after_days": 5}
        late = (now - t.submitted_at).days >= cfg["alert_after_days"]
        stale_sending = t.status == "sending" and (now - t.submitted_at).total_seconds() > 300
        if t.status == "unknown" or stale_sending or (t.status == "pending" and late):
            out.append({"id": str(t.id), "job_id": str(t.job_id), "service_code": t.service_code,
                        "title": defaults.TITLES.get(t.service_code, t.service_code),
                        "status": "unknown" if stale_sending else t.status, "ticket_ref": t.ticket_ref,
                        "days_waiting": (now - t.submitted_at).days, "note": t.provider_note})
    return sorted(out, key=lambda x: -x["days_waiting"])


async def resolve_ticket(db: AsyncSession, director: User, ticket_id: uuid.UUID, action: str,
                         ticket_ref: str | None = None, note: str | None = None) -> dict:
    """Director decisions:
       entered_reference  an unclear send DID go through: record Techhub's reference and keep waiting
       not_sent           it did NOT go through: give the job back to its worker to send again
       close_success      mark done (we checked with Techhub); pays the worker
       close_failed       mark failed; the customer is refunded per the service's refund policy"""
    t = (await db.execute(select(ProviderTicket).where(ProviderTicket.id == ticket_id).with_for_update())).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Not found.")
    job = (await db.execute(select(ManualServiceRequest).where(ManualServiceRequest.id == t.job_id).with_for_update())).scalar_one()
    if t.status not in OPEN or job.status != ManualServiceStatus.AWAITING_PROVIDER:
        raise HTTPException(status_code=409, detail="This request is already closed.")
    cfg = await get_cfg(db, t.service_code) or {"refund_on_failure": True}
    note = (note or "").strip()[:500]
    if action == "entered_reference":
        if not (ticket_ref or "").strip():
            raise HTTPException(status_code=422, detail="Enter the reference shown in the Techhub dashboard.")
        t.ticket_ref, t.status, t.last_checked_at = ticket_ref.strip()[:120], "pending", None
    elif action == "not_sent":
        if t.status != "unknown" and not (t.status == "sending"):
            raise HTTPException(status_code=409, detail="Only an unclear send can be given back.")
        await db.delete(t)
        job.status = ManualServiceStatus.PROCESSING
        job.expires_at = _now() + timedelta(minutes=await jp._get_timeout_minutes(db))
    elif action == "close_success":
        await _finish_success(db, job, t, note or "Confirmed by a director.", {})
    elif action == "close_failed":
        try:
            await _finish_failed(db, job, t, note or "Closed by a director.", cfg["refund_on_failure"], director.id)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e))
    else:
        raise HTTPException(status_code=422, detail="Unknown action.")
    await log_action(db, actor_id=director.id, action=f"provider.ticket_{action}", entity_type="provider_ticket",
                     entity_id=str(ticket_id), new_value={"job_id": str(job.id)})
    await db.flush()
    return {"ok": True}
