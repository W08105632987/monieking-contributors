"""
The system health monitor — checks database latency, Redis, external
provider reachability (Monnify, Termii), transaction anomalies, and
site traffic, on a schedule (see app/tasks/health_monitor.py), and
alerts the operator by email AND SMS the moment any of them looks
wrong — not waiting for a customer to complain first.

Each check returns a HealthCheckResult-shaped dict: status is one of
'healthy' | 'degraded' | 'down'. Every run is persisted (for the
history/trend view in the admin CRM) regardless of outcome; only a
status change into degraded/down, respecting a cooldown, triggers an
actual alert — see _maybe_alert.
"""
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis_client import get_redis
from app.models.health_check import HealthCheckResult, HealthAlertState
from app.models.withdrawal import Withdrawal, WithdrawalStatus
from app.models.bill_payment import BillPaymentRequest, BillPaymentStatus
from app.models.analytics_event import AnalyticsEvent
from app.integrations.termii import send_sms
from app.integrations.email_sender import send_email
from app.services.admin_crm_service import get_reconciliation_flags


# ── Individual checks ───────────────────────────────────────────────

async def check_database(db: AsyncSession) -> dict:
    start = time.monotonic()
    try:
        await db.execute(text("SELECT 1"))
        latency_ms = round((time.monotonic() - start) * 1000)
    except Exception as e:
        return {"check_name": "database", "status": "down", "message": f"Database query failed: {e}", "metrics": {}}

    if latency_ms >= settings.HEALTH_CHECK_DB_LATENCY_CRITICAL_MS:
        return {"check_name": "database", "status": "down", "message": f"Query latency {latency_ms}ms — critical threshold is {settings.HEALTH_CHECK_DB_LATENCY_CRITICAL_MS}ms", "metrics": {"latency_ms": latency_ms}}
    if latency_ms >= settings.HEALTH_CHECK_DB_LATENCY_WARN_MS:
        return {"check_name": "database", "status": "degraded", "message": f"Query latency {latency_ms}ms — slower than usual", "metrics": {"latency_ms": latency_ms}}
    return {"check_name": "database", "status": "healthy", "message": None, "metrics": {"latency_ms": latency_ms}}


async def check_redis() -> dict:
    start = time.monotonic()
    try:
        redis = get_redis()
        await redis.ping()
        latency_ms = round((time.monotonic() - start) * 1000)
        return {"check_name": "redis", "status": "healthy", "message": None, "metrics": {"latency_ms": latency_ms}}
    except Exception as e:
        # Redis is explicitly non-critical elsewhere in this codebase
        # (idempotency guards fail open) — reflected here as "degraded",
        # not "down", since the app keeps working without it, just with
        # weaker guarantees on a couple of features.
        return {"check_name": "redis", "status": "degraded", "message": f"Redis unreachable: {e}", "metrics": {}}


async def _check_http_reachable(name: str, url: str) -> dict:
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
        latency_ms = round((time.monotonic() - start) * 1000)
        # Any response at all — even a 404/401 — proves the host is
        # reachable, which is specifically what this check is for.
        # Whether individual API calls succeed is a separate, narrower
        # question than "is the provider's network even up."
        return {"check_name": name, "status": "healthy", "message": f"HTTP {resp.status_code}", "metrics": {"latency_ms": latency_ms, "status_code": resp.status_code}}
    except Exception as e:
        return {"check_name": name, "status": "down", "message": f"Could not reach {url}: {e}", "metrics": {}}


async def check_monnify() -> dict:
    return await _check_http_reachable("monnify", settings.MONNIFY_BASE_URL)


async def check_termii() -> dict:
    return await _check_http_reachable("termii", "https://api.ng.termii.com")


async def check_transactions(db: AsyncSession) -> dict:
    """
    Two independent anomaly signals, either one enough to flag:
      1. Withdrawals stuck in 'pending' past your own configured SLA
         (WITHDRAWAL_SLA_HOURS) — the same threshold the app already
         defines for how long a withdrawal should take, reused here
         rather than inventing a second, possibly inconsistent number.
      2. A wallet balance that doesn't match its own transaction
         history — reuses get_reconciliation_flags() (built for the
         admin CRM's reconciliation page) rather than duplicating that
         query here.
    """
    sla_cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.WITHDRAWAL_SLA_HOURS)
    stuck_withdrawals = (await db.execute(
        select(func.count()).select_from(Withdrawal)
        .where(Withdrawal.status == WithdrawalStatus.PENDING, Withdrawal.requested_at < sla_cutoff)
    )).scalar() or 0

    recent_failed_bills = (await db.execute(
        select(func.count()).select_from(BillPaymentRequest)
        .where(BillPaymentRequest.status == BillPaymentStatus.FAILED, BillPaymentRequest.created_at >= datetime.now(timezone.utc) - timedelta(hours=1))
    )).scalar() or 0

    flags = await get_reconciliation_flags(db)

    metrics = {
        "stuck_withdrawals": stuck_withdrawals,
        "failed_bills_last_hour": recent_failed_bills,
        "wallet_discrepancies": len(flags),
    }

    if flags or stuck_withdrawals > 0:
        parts = []
        if stuck_withdrawals: parts.append(f"{stuck_withdrawals} withdrawal(s) past SLA")
        if flags: parts.append(f"{len(flags)} wallet balance discrepancy(ies)")
        return {"check_name": "transactions", "status": "down" if flags else "degraded", "message": "; ".join(parts), "metrics": metrics}

    if recent_failed_bills >= 5:
        return {"check_name": "transactions", "status": "degraded", "message": f"{recent_failed_bills} failed bill payments in the last hour", "metrics": metrics}

    return {"check_name": "transactions", "status": "healthy", "message": None, "metrics": metrics}


async def check_traffic(db: AsyncSession) -> dict:
    """
    Not "is traffic high" — the opposite. A platform that's actually
    down often still LOOKS fine to every other check here (database up,
    Redis up, external providers reachable) if the problem is at the
    frontend, DNS, or a reverse proxy layer none of those checks touch.
    A sudden flatline in pageviews compared to the same hour on recent
    days is a real, independent signal that something's wrong even when
    every backend component reports healthy.
    """
    now = datetime.now(timezone.utc)
    last_hour = (await db.execute(
        select(func.count()).select_from(AnalyticsEvent)
        .where(AnalyticsEvent.event_type == "pageview", AnalyticsEvent.created_at >= now - timedelta(hours=1))
    )).scalar() or 0

    # Same hour-of-day, previous 3 days — a rough same-time baseline
    # rather than a flat "traffic must be above N" threshold, which
    # would false-positive every night when real usage is naturally low.
    baseline_windows = []
    for days_ago in (1, 2, 3):
        start = now - timedelta(days=days_ago, hours=0)
        window_start = start.replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
        window_end = window_start + timedelta(hours=1)
        count = (await db.execute(
            select(func.count()).select_from(AnalyticsEvent)
            .where(AnalyticsEvent.event_type == "pageview", AnalyticsEvent.created_at >= window_start, AnalyticsEvent.created_at < window_end)
        )).scalar() or 0
        baseline_windows.append(count)

    baseline_avg = sum(baseline_windows) / len(baseline_windows) if baseline_windows else 0
    metrics = {"last_hour_pageviews": last_hour, "baseline_avg": round(baseline_avg, 1)}

    # Only judge against a baseline that's actually established —
    # a brand-new deployment with no history yet shouldn't be flagged
    # as "traffic dropped" against a baseline of zero.
    if baseline_avg >= 5 and last_hour == 0:
        return {"check_name": "traffic", "status": "down", "message": "Zero pageviews in the last hour, despite normal traffic at this time on recent days", "metrics": metrics}
    if baseline_avg >= 10 and last_hour < baseline_avg * 0.2:
        return {"check_name": "traffic", "status": "degraded", "message": f"Only {last_hour} pageviews this hour vs a baseline of ~{round(baseline_avg)}", "metrics": metrics}
    return {"check_name": "traffic", "status": "healthy", "message": None, "metrics": metrics}


# ── Orchestration ────────────────────────────────────────────────────

ALL_CHECKS_DB = ["database", "transactions", "traffic"]   # need a db session
ALL_CHECKS_NO_DB = ["redis", "monnify", "termii"]          # don't

STATUS_EMOJI = {"healthy": "\u2705", "degraded": "\u26a0\ufe0f", "down": "\U0001f534"}


async def _persist_result(db: AsyncSession, result: dict) -> None:
    db.add(HealthCheckResult(
        id=uuid.uuid4(), check_name=result["check_name"], status=result["status"],
        message=result.get("message"), metrics=result.get("metrics") or {},
    ))


async def _maybe_alert(db: AsyncSession, result: dict) -> None:
    """
    Alerts on transition INTO a bad state, and on recovery back to
    healthy — never on every single run while something stays broken,
    which is what the cooldown is for. A recovery notification matters
    just as much as the original alert: "still down?" is exactly what
    an operator wants answered without having to go check themselves.
    """
    check_name = result["check_name"]
    status = result["status"]

    state = (await db.execute(select(HealthAlertState).where(HealthAlertState.check_name == check_name))).scalar_one_or_none()
    previous_status = state.last_status if state else "healthy"
    now = datetime.now(timezone.utc)

    should_alert = False
    if status in ("degraded", "down"):
        cooldown_elapsed = (
            not state or not state.last_alerted_at
            or (now - state.last_alerted_at) >= timedelta(minutes=settings.HEALTH_CHECK_ALERT_COOLDOWN_MINUTES)
        )
        if previous_status == "healthy" or cooldown_elapsed:
            should_alert = True
    elif status == "healthy" and previous_status in ("degraded", "down"):
        should_alert = True   # recovery

    if should_alert:
        await _send_alert(check_name=check_name, status=status, previous_status=previous_status, message=result.get("message"))

    if state:
        state.last_status = status
        if should_alert:
            state.last_alerted_at = now
    else:
        db.add(HealthAlertState(check_name=check_name, last_status=status, last_alerted_at=now if should_alert else None))


async def _send_alert(*, check_name: str, status: str, previous_status: str, message: str | None) -> None:
    is_recovery = status == "healthy"
    subject = f"{STATUS_EMOJI[status]} MonieKing: {check_name} {'has recovered' if is_recovery else f'is {status}'}"
    body = (
        f"System health monitor alert\n\n"
        f"Check: {check_name}\n"
        f"Status: {previous_status} -> {status}\n"
        f"Detail: {message or '(no additional detail)'}\n"
        f"Time: {datetime.now(timezone.utc).isoformat()}\n"
    )

    emails = [e.strip() for e in settings.ALERT_EMAIL_TO.split(",") if e.strip()]
    phones = [p.strip() for p in settings.ALERT_PHONE_TO.split(",") if p.strip()]

    if emails:
        await send_email(to=emails, subject=subject, body=body)
    for phone in phones:
        try:
            await send_sms(phone, f"{subject}. {message or ''}"[:300])
        except Exception:
            pass   # the other channel (email) may still have gotten through


async def run_all_checks(db: AsyncSession) -> list[dict]:
    results = []
    for name in ALL_CHECKS_NO_DB:
        fn = {"redis": check_redis, "monnify": check_monnify, "termii": check_termii}[name]
        results.append(await fn())
    for name in ALL_CHECKS_DB:
        fn = {"database": check_database, "transactions": check_transactions, "traffic": check_traffic}[name]
        results.append(await fn(db))

    for result in results:
        await _persist_result(db, result)
        await _maybe_alert(db, result)

    await db.commit()
    return results


async def get_current_status(db: AsyncSession) -> dict:
    """The admin CRM dashboard's read side — latest result per check,
    plus a short recent history for the trend view."""
    check_names = ALL_CHECKS_NO_DB + ALL_CHECKS_DB
    latest: dict[str, dict] = {}
    for name in check_names:
        row = (await db.execute(
            select(HealthCheckResult).where(HealthCheckResult.check_name == name)
            .order_by(HealthCheckResult.checked_at.desc()).limit(1)
        )).scalar_one_or_none()
        if row:
            latest[name] = {
                "check_name": row.check_name, "status": row.status, "message": row.message,
                "metrics": row.metrics, "checked_at": row.checked_at,
            }

    history_rows = (await db.execute(
        select(HealthCheckResult)
        .where(HealthCheckResult.checked_at >= datetime.now(timezone.utc) - timedelta(hours=24))
        .order_by(HealthCheckResult.checked_at.asc())
    )).scalars().all()

    return {
        "checks": list(latest.values()),
        "overall_status": (
            "down" if any(c["status"] == "down" for c in latest.values())
            else "degraded" if any(c["status"] == "degraded" for c in latest.values())
            else "healthy"
        ),
        "history": [
            {"check_name": r.check_name, "status": r.status, "checked_at": r.checked_at, "metrics": r.metrics}
            for r in history_rows
        ],
    }
