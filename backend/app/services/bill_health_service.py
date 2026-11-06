"""
Biller health: "how likely is a purchase on this biller to work right now?"

Two independent sources, shown together:
  1. OUR OWN RESULTS. Of the purchases on each biller in the last N minutes (default 3 hours), how many completed vs failed.
     Monnify publishes no per-biller feed, so the real outcome of real purchases is the most honest "status level" there is.
     A biller with too few recent purchases is "unknown" (no warning is shown on a sample of one).
  2. MONNIFY'S OWN STATUS PAGE (monnify.statuspage.io), cached for a minute, for platform-wide incidents and maintenance.

Levels:  good >= 80%   fair 30-80%   poor < threshold (default 30%)   unknown = not enough recent purchases.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill_payment import Biller, BillerCategory, BillPaymentRequest, BillPaymentStatus
from app.services.settings_service import get_config_int

STATUSPAGE_URL = "https://monnify.statuspage.io/api/v2/summary.json"
_STATUS_CACHE: dict = {"at": 0.0, "value": None}
_STATUS_TTL = 60.0

DEFAULT_THRESHOLD = 30
DEFAULT_MIN_ATTEMPTS = 5
DEFAULT_WINDOW_MINUTES = 180


def level_for(success_rate: float | None, attempts: int, *, min_attempts: int, threshold: int) -> str:
    if success_rate is None or attempts < min_attempts:
        return "unknown"
    if success_rate < threshold:
        return "poor"
    if success_rate < 80:
        return "fair"
    return "good"


def make_stat(completed: int, failed: int, *, min_attempts: int, threshold: int) -> dict:
    attempts = completed + failed
    rate = round(completed * 100 / attempts) if attempts else None
    return {"success_rate": rate, "attempts": attempts, "completed": completed, "failed": failed,
            "level": level_for(rate, attempts, min_attempts=min_attempts, threshold=threshold)}


async def load_settings(db: AsyncSession) -> tuple[int, int, int]:
    threshold = max(0, min(100, await get_config_int(db, "bill_warning_threshold_percent", DEFAULT_THRESHOLD)))
    min_attempts = max(1, await get_config_int(db, "bill_health_min_attempts", DEFAULT_MIN_ATTEMPTS))
    window = max(10, await get_config_int(db, "bill_health_window_minutes", DEFAULT_WINDOW_MINUTES))
    return threshold, min_attempts, window


async def provider_stats(db: AsyncSession, category: str | None = None) -> dict:
    """Success rate per PROVIDER (all products that share a Monnify biller), plus a biller_id -> provider lookup."""
    threshold, min_attempts, window = await load_settings(db)
    since = datetime.now(timezone.utc) - timedelta(minutes=window)
    if isinstance(category, str):
        category = BillerCategory(category)      # an unknown category raises ValueError; the route turns it into a 400

    ok = func.count().filter(BillPaymentRequest.status == BillPaymentStatus.COMPLETED)
    bad = func.count().filter(BillPaymentRequest.status == BillPaymentStatus.FAILED)
    q = (select(Biller.monnify_biller_id, ok, bad)
         .join(Biller, Biller.id == BillPaymentRequest.biller_id)
         .where(BillPaymentRequest.created_at >= since,
                BillPaymentRequest.status.in_([BillPaymentStatus.COMPLETED, BillPaymentStatus.FAILED]))
         .group_by(Biller.monnify_biller_id))
    if category:
        q = q.where(Biller.category == category)
    by_provider = {pid: make_stat(int(c), int(f), min_attempts=min_attempts, threshold=threshold) for pid, c, f in (await db.execute(q)).all()}

    rows_q = select(Biller.id, Biller.monnify_biller_id, Biller.name, Biller.category).where(Biller.is_active.is_(True))
    if category:
        rows_q = rows_q.where(Biller.category == category)
    unknown = make_stat(0, 0, min_attempts=min_attempts, threshold=threshold)
    by_biller, names = {}, {}
    for bid, pid, name, cat in (await db.execute(rows_q)).all():
        stat = by_provider.get(pid, unknown)
        by_biller[str(bid)] = {**stat, "provider": pid}
        names.setdefault(pid, name)
    return {"window_minutes": window, "min_attempts": min_attempts, "threshold_percent": threshold,
            "providers": {pid: {**s, "name": names.get(pid)} for pid, s in by_provider.items()}, "billers": by_biller}


async def stat_for_biller(db: AsyncSession, biller_id) -> dict:
    """The verdict for ONE biller (used right before a payment). Provider-level, like the picker's bars."""
    threshold, min_attempts, window = await load_settings(db)
    biller = await db.get(Biller, biller_id)
    if biller is None:
        return {**make_stat(0, 0, min_attempts=min_attempts, threshold=threshold), "threshold_percent": threshold, "name": None}
    since = datetime.now(timezone.utc) - timedelta(minutes=window)
    ok = func.count().filter(BillPaymentRequest.status == BillPaymentStatus.COMPLETED)
    bad = func.count().filter(BillPaymentRequest.status == BillPaymentStatus.FAILED)
    row = (await db.execute(
        select(ok, bad).join(Biller, Biller.id == BillPaymentRequest.biller_id)
        .where(Biller.monnify_biller_id == biller.monnify_biller_id, BillPaymentRequest.created_at >= since,
               BillPaymentRequest.status.in_([BillPaymentStatus.COMPLETED, BillPaymentStatus.FAILED])))).one()
    return {**make_stat(int(row[0]), int(row[1]), min_attempts=min_attempts, threshold=threshold),
            "threshold_percent": threshold, "name": biller.name, "window_minutes": window}


# ── Monnify's status page ─────────────────────────────────────────────────

def map_statuspage(summary: dict) -> dict:
    """Atlassian-Statuspage 'summary.json' -> a small shape the app can show. Pure, so it is unit-tested."""
    status = summary.get("status") or {}
    indicator = status.get("indicator") or "none"
    components = [{"name": c.get("name"), "status": c.get("status")} for c in (summary.get("components") or [])
                  if c.get("status") not in (None, "operational") and not c.get("group")]
    incidents = [{"name": i.get("name"), "status": i.get("status"), "impact": i.get("impact")} for i in (summary.get("incidents") or [])]
    maintenance = [{"name": m.get("name"), "status": m.get("status"), "scheduled_for": m.get("scheduled_for")}
                   for m in (summary.get("scheduled_maintenances") or []) if m.get("status") in ("in_progress", "scheduled")]
    level = {"none": "operational", "minor": "degraded", "major": "outage", "critical": "outage"}.get(indicator, "degraded")
    if level == "operational" and any(m["status"] == "in_progress" for m in maintenance):
        level = "maintenance"
    return {"ok": True, "level": level, "indicator": indicator, "description": status.get("description"),
            "components": components, "incidents": incidents, "maintenance": maintenance}


async def monnify_status(force: bool = False) -> dict:
    """Cached for a minute. If the status page itself cannot be reached, say so without claiming Monnify is down."""
    now = time.monotonic()
    if not force and _STATUS_CACHE["value"] is not None and now - _STATUS_CACHE["at"] < _STATUS_TTL:
        return _STATUS_CACHE["value"]
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(STATUSPAGE_URL)
        value = map_statuspage(resp.json()) if resp.status_code == 200 else {"ok": False, "level": "unknown", "description": f"Status page returned HTTP {resp.status_code}"}
    except Exception as e:  # noqa: BLE001
        value = {"ok": False, "level": "unknown", "description": f"Status page unreachable ({type(e).__name__})"}
    value = {**value, "checked_at": datetime.now(timezone.utc).isoformat()}
    _STATUS_CACHE.update(at=now, value=value)
    return value
