"""
The checks the first health monitor did not have. Each returns the same shape as the originals in health_service.py:
    {"check_name", "status": healthy|degraded|down, "message", "metrics", ["hard": True]}
`hard` = a definite failure (an exception, a rejected login), alerted at once instead of waiting for a second bad reading.

  monnify_api     can we actually LOG IN and call the bills API, and is the wallet that pays for bills funded?
                  (the old check only proved the host answered, so a rejected key or an empty wallet looked "healthy")
  monnify_status  Monnify's own status page: incidents and maintenance
  bills           per-biller success rate, and purchases stuck pending
  resources       memory / CPU load / disk of the machine running the monitor
  error_rate      ERROR log lines per 5 minutes
  db_load         connections, long-running queries, lock waits
  integrity       signs of corrupted money data
  fraud           suspicious patterns across accounts and withdrawals
  sms             Termii credit and delivery health
  alerting        can the alert system itself reach a human?
"""
from __future__ import annotations

import os
import shutil
import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.bill_payment import BillPaymentRequest, BillPaymentStatus
from app.models.user import User


def _r(name: str, status: str, message: str | None = None, metrics: dict | None = None, hard: bool = False) -> dict:
    out = {"check_name": name, "status": status, "message": message, "metrics": metrics or {}}
    if hard:
        out["hard"] = True
    return out


# ── Monnify ───────────────────────────────────────────────────────────────

async def fetch_wallet_balance() -> dict | None:
    """Available balance of the Monnify wallet that bills are paid from. None if it cannot be read."""
    from app.integrations.monnify import get_payment_provider
    try:
        headers = await get_payment_provider()._headers()
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(f"{settings.MONNIFY_BASE_URL}/api/v2/disbursements/wallet-balance",
                                    params={"accountNumber": settings.MONNIFY_SOURCE_ACCOUNT_NUMBER}, headers=headers)
        body = resp.json().get("responseBody") or {}
        if resp.status_code == 200 and "availableBalance" in body:
            return {"available": float(body["availableBalance"]), "ledger": body.get("ledgerBalance")}
    except Exception:  # noqa: BLE001
        pass
    return None


def eval_wallet(available_naira: float, minimum_naira: float) -> tuple[str, str | None]:
    if available_naira < minimum_naira * 0.25:
        return "down", f"Monnify wallet is almost empty (₦{available_naira:,.0f}). Bill purchases are about to fail. Fund it now."
    if available_naira < minimum_naira:
        return "degraded", f"Monnify wallet is running low (₦{available_naira:,.0f}, minimum ₦{minimum_naira:,.0f}). Top it up soon."
    return "healthy", None


async def check_monnify_api() -> dict:
    from fastapi import HTTPException
    from app.integrations.monnify import get_payment_provider
    from app.integrations.monnify_bills import MonnifyBillsError, get_bills_provider
    start = time.monotonic()
    try:
        await get_payment_provider()._get_access_token()
    except HTTPException as e:
        return _r("monnify_api", "down", f"Monnify login FAILED (HTTP {e.status_code}): {e.detail}", hard=True)
    except Exception as e:  # noqa: BLE001
        return _r("monnify_api", "down", f"Monnify login FAILED: {type(e).__name__}: {e}", hard=True)
    login_ms = round((time.monotonic() - start) * 1000)
    try:
        cats = await get_bills_provider().get_biller_categories()
    except MonnifyBillsError as e:
        return _r("monnify_api", "down", f"Monnify BILLS API is rejecting calls: {str(e.raw)[:260]}", {"login_ms": login_ms}, hard=True)
    except Exception as e:  # noqa: BLE001
        return _r("monnify_api", "down", f"Monnify bills check crashed: {type(e).__name__}: {e}", {"login_ms": login_ms}, hard=True)
    metrics = {"login_ms": login_ms, "bill_categories": len(cats)}
    if not cats:
        return _r("monnify_api", "degraded", "Monnify returned NO bill categories", metrics)
    wallet = await fetch_wallet_balance()
    if wallet:
        metrics["wallet_available_naira"] = wallet["available"]
        status, msg = eval_wallet(wallet["available"], float(settings.MONNIFY_MIN_WALLET_NAIRA))
        if status != "healthy":
            return _r("monnify_api", status, msg, metrics, hard=(status == "down"))
    return _r("monnify_api", "healthy", None, metrics)


async def check_monnify_status() -> dict:
    from app.services.bill_health_service import monnify_status
    s = await monnify_status(force=True)
    metrics = {"level": s.get("level"), "indicator": s.get("indicator")}
    if not s.get("ok"):
        return _r("monnify_status", "healthy", f"Could not read Monnify's status page ({s.get('description')}); not treated as an outage", metrics)
    parts = [i["name"] for i in s.get("incidents", [])] + [f"{c['name']}: {c['status']}" for c in s.get("components", [])]
    detail = "; ".join(p for p in parts if p)[:300] or s.get("description")
    if s["level"] == "outage":
        return _r("monnify_status", "down", f"Monnify reports an outage: {detail}", metrics)
    if s["level"] == "degraded":
        return _r("monnify_status", "degraded", f"Monnify reports problems: {detail}", metrics)
    if s["level"] == "maintenance":
        return _r("monnify_status", "degraded", f"Monnify maintenance in progress: {detail}", metrics)
    return _r("monnify_status", "healthy", None, metrics)


# ── Billers ───────────────────────────────────────────────────────────────

async def check_bills(db: AsyncSession) -> dict:
    from app.services.bill_health_service import provider_stats
    stats = await provider_stats(db)
    poor = [(p["name"] or pid, p) for pid, p in stats["providers"].items() if p["level"] == "poor"]
    # Purchases stuck "pending" far longer than a vend should take.
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    stuck = (await db.execute(select(func.count()).select_from(BillPaymentRequest).where(
        BillPaymentRequest.status == BillPaymentStatus.PENDING, BillPaymentRequest.created_at < cutoff))).scalar() or 0
    total_ok = sum(p["completed"] for p in stats["providers"].values())
    total_bad = sum(p["failed"] for p in stats["providers"].values())
    overall = round(total_ok * 100 / (total_ok + total_bad)) if (total_ok + total_bad) else None
    metrics = {"window_minutes": stats["window_minutes"], "overall_success_rate": overall, "stuck_pending": stuck, "poor_billers": len(poor)}
    if (total_ok + total_bad) >= stats["min_attempts"] and overall is not None and overall < stats["threshold_percent"]:
        return _r("bills", "down", f"Almost every bill purchase is failing: {overall}% succeeded in the last {stats['window_minutes']} min ({total_ok} ok, {total_bad} failed)", metrics, hard=True)
    if poor or stuck:
        names = ", ".join(f"{n} {p['success_rate']}% ({p['completed']}/{p['attempts']})" for n, p in poor[:6])
        msg = "; ".join(x for x in ([f"Failing billers: {names}"] if poor else []) + ([f"{stuck} purchase(s) stuck pending over 15 min"] if stuck else []))
        return _r("bills", "degraded", msg, metrics)
    return _r("bills", "healthy", None, metrics)


# ── Machine, logs, database ───────────────────────────────────────────────

def eval_resources(mem_pct: float | None, load_per_cpu: float | None, disk_pct: float | None) -> tuple[str, list[str]]:
    notes: list[str] = []
    worst = 0                      # 0 healthy, 1 degraded, 2 down

    def add(level: int, note: str) -> None:
        nonlocal worst
        notes.append(note)
        worst = max(worst, level)

    if mem_pct is not None:
        if mem_pct >= 95: add(2, f"memory {mem_pct:.0f}% (about to run out)")
        elif mem_pct >= 85: add(1, f"memory {mem_pct:.0f}%")
    if load_per_cpu is not None:
        if load_per_cpu >= 4: add(2, f"CPU overloaded (load {load_per_cpu:.1f} per core)")
        elif load_per_cpu >= 2: add(1, f"CPU busy (load {load_per_cpu:.1f} per core)")
    if disk_pct is not None:
        if disk_pct >= 95: add(2, f"disk {disk_pct:.0f}% full")
        elif disk_pct >= 85: add(1, f"disk {disk_pct:.0f}% full")
    return ("healthy", "degraded", "down")[worst], notes


def _read_int(path: str) -> int | None:
    try:
        v = open(path).read().strip()
        return None if v in ("max", "") else int(v)
    except Exception:  # noqa: BLE001
        return None


def memory_percent() -> float | None:
    """Percent of the CONTAINER's memory limit in use (Railway limits per service), else of the machine's memory."""
    for used_p, limit_p in (("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"),
                            ("/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes")):
        used, limit = _read_int(used_p), _read_int(limit_p)
        if used is not None and limit and limit < 1 << 50:
            return used * 100 / limit
    try:
        info = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo")}
        return (1 - info["MemAvailable"] / info["MemTotal"]) * 100
    except Exception:  # noqa: BLE001
        return None


async def check_resources() -> dict:
    mem = memory_percent()
    try:
        load = os.getloadavg()[0] / (os.cpu_count() or 1)
    except Exception:  # noqa: BLE001
        load = None
    try:
        du = shutil.disk_usage("/")
        disk = du.used * 100 / du.total
    except Exception:  # noqa: BLE001
        disk = None
    status, notes = eval_resources(mem, load, disk)
    metrics = {k: round(v, 1) for k, v in (("memory_percent", mem), ("load_per_cpu", load), ("disk_percent", disk)) if v is not None}
    metrics["service"] = os.getenv("RAILWAY_SERVICE_NAME", "monitor")
    return _r("resources", status, f"{metrics['service']}: " + "; ".join(notes) if notes else None, metrics)


def eval_error_rate(count: int, warn: int, down: int) -> str:
    return "down" if count >= down else "degraded" if count >= warn else "healthy"


async def check_error_rate() -> dict:
    from app.core.log_counter import recent_errors
    try:
        e = await recent_errors(5)
    except Exception as ex:  # noqa: BLE001
        return _r("error_rate", "healthy", f"Error counter unavailable ({type(ex).__name__})")
    status = eval_error_rate(e["count"], settings.ERROR_RATE_WARN_PER_5MIN, settings.ERROR_RATE_DOWN_PER_5MIN)
    msg = None
    if status != "healthy":
        msg = f"{e['count']} errors in the last 5 minutes. Most common: " + " | ".join(f"{s} (x{n})" for s, n in e["top"])
    return _r("error_rate", status, msg, {"errors_5min": e["count"]})


async def check_db_load(db: AsyncSession) -> dict:
    try:
        row = (await db.execute(text(
            "SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns,"
            " current_setting('max_connections')::int AS maxc,"
            " (SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid()"
            "    AND now() - query_start > interval '60 seconds') AS slow,"
            " (SELECT count(*) FROM pg_locks WHERE NOT granted) AS waiting"))).one()
    except Exception as e:  # noqa: BLE001
        await db.rollback()
        return _r("db_load", "healthy", f"Database load stats not readable here ({type(e).__name__})")
    conns, maxc, slow, waiting = int(row[0]), int(row[1]), int(row[2]), int(row[3])
    pct = conns * 100 / maxc if maxc else 0
    metrics = {"connections": conns, "max_connections": maxc, "connections_percent": round(pct), "queries_over_60s": slow, "lock_waits": waiting}
    notes = []
    if pct >= 90: notes.append(f"connections {pct:.0f}% of the limit")
    if slow: notes.append(f"{slow} query/queries running over 60s")
    if waiting >= 5: notes.append(f"{waiting} lock waits")
    if not notes:
        return _r("db_load", "healthy", None, metrics)
    return _r("db_load", "down" if (pct >= 97 or waiting >= 25) else "degraded", "Database under strain: " + "; ".join(notes), metrics)


async def check_integrity(db: AsyncSession) -> dict:
    """Cheap tripwires for corrupted money data. (Wallet-vs-history mismatches are already covered by 'transactions'.)"""
    from app.models.wallet import Wallet
    from app.models.withdrawal import Withdrawal, WithdrawalStatus
    problems: dict[str, int] = {}
    problems["negative wallet balances"] = (await db.execute(select(func.count()).select_from(Wallet).where(Wallet.balance_kobo < 0))).scalar() or 0
    problems["completed bills with no completion time"] = (await db.execute(select(func.count()).select_from(BillPaymentRequest).where(
        BillPaymentRequest.status == BillPaymentStatus.COMPLETED, BillPaymentRequest.completed_at.is_(None)))).scalar() or 0
    problems["paid withdrawals with no processed time"] = (await db.execute(select(func.count()).select_from(Withdrawal).where(
        Withdrawal.status == WithdrawalStatus.PAID, Withdrawal.processed_at.is_(None)))).scalar() or 0
    dup = (await db.execute(
        select(func.count()).select_from(
            select(BillPaymentRequest.monnify_transaction_reference)
            .where(BillPaymentRequest.monnify_transaction_reference.is_not(None))
            .group_by(BillPaymentRequest.monnify_transaction_reference).having(func.count() > 1).subquery()))).scalar() or 0
    problems["bill purchases sharing one Monnify reference"] = dup
    bad = {k: v for k, v in problems.items() if v}
    if bad:
        return _r("integrity", "down", "Possible data corruption: " + "; ".join(f"{v} {k}" for k, v in bad.items()), {"problems": bad}, hard=True)
    return _r("integrity", "healthy", None, {"checked": len(problems)})


async def check_fraud(db: AsyncSession) -> dict:
    """Patterns across accounts that individual requests cannot show."""
    from app.models.withdrawal import Withdrawal
    now = datetime.now(timezone.utc)
    flags: list[str] = []
    shared = (await db.execute(
        select(User.account_number, func.count()).where(User.account_number.is_not(None))
        .group_by(User.account_number).having(func.count() >= 3).limit(5))).all()
    for acct, n in shared:
        flags.append(f"bank account ending {str(acct)[-4:]} is on {n} different users")
    velocity = (await db.execute(
        select(Withdrawal.customer_id, func.count()).where(Withdrawal.requested_at >= now - timedelta(hours=1))
        .group_by(Withdrawal.customer_id).having(func.count() >= 4).limit(5))).all()
    for uid, n in velocity:
        flags.append(f"user {str(uid)[:8]} requested {n} withdrawals in the last hour")
    bill_burst = (await db.execute(
        select(BillPaymentRequest.customer_id, func.count()).where(BillPaymentRequest.created_at >= now - timedelta(minutes=10))
        .group_by(BillPaymentRequest.customer_id).having(func.count() >= 10).limit(5))).all()
    for uid, n in bill_burst:
        flags.append(f"user {str(uid)[:8]} made {n} bill purchases in 10 minutes")
    if flags:
        return _r("fraud", "degraded", "Suspicious activity: " + "; ".join(flags), {"flags": len(flags)})
    return _r("fraud", "healthy", None, {"flags": 0})


# ── SMS and the alert system itself ───────────────────────────────────────

async def check_sms() -> dict:
    from app.integrations.termii import get_balance
    if not settings.TERMII_API_KEY:
        return _r("sms", "degraded", "SMS is not configured (TERMII_API_KEY missing): OTPs and critical alerts will not be texted")
    bal = await get_balance()
    metrics: dict = {}
    notes: list[str] = []
    status = "healthy"
    if bal is None:
        status = "degraded"; notes.append("could not read the Termii balance (key rejected or Termii down)")
    else:
        metrics["balance"] = bal["balance"]
        if bal["balance"] < settings.TERMII_MIN_BALANCE_NAIRA * 0.2:
            status = "down"; notes.append(f"SMS credit nearly gone ({bal['currency']} {bal['balance']:,.0f}); OTPs will stop")
        elif bal["balance"] < settings.TERMII_MIN_BALANCE_NAIRA:
            status = "degraded"; notes.append(f"SMS credit low ({bal['currency']} {bal['balance']:,.0f})")
    try:
        from app.core.redis_client import get_redis
        ok, fail = await get_redis().get("sms:last_ok"), await get_redis().get("sms:last_fail")
        if fail and (not ok or fail.split("|")[0] > ok):
            notes.append(f"last SMS attempt failed: {fail.split('|', 1)[-1][:120]}")
            status = status if status == "down" else "degraded"
    except Exception:  # noqa: BLE001
        pass
    return _r("sms", status, "; ".join(notes) or None, metrics, hard=(status == "down"))


async def check_alerting() -> dict:
    """If this is red, an alert may be raised and still reach nobody. It shows on the System Health page and the dashboard."""
    from app.services.alert_service import alerting_status
    s = await alerting_status()
    critical = [p for p in s["problems"] if p.startswith(("No email transport", "No alert recipients", "The last email attempt"))]
    if critical:
        return _r("alerting", "down", "ALERTS MAY NOT REACH YOU: " + " ".join(critical), {"transport": s["email_transport"], "recipients": s["recipient_count"]})
    if s["problems"]:
        return _r("alerting", "degraded", "Alerting can be stronger: " + s["problems"][0], {"transport": s["email_transport"], "recipients": s["recipient_count"]})
    return _r("alerting", "healthy", None, {"transport": s["email_transport"], "recipients": s["recipient_count"]})


async def ping_heartbeat() -> None:
    """The dead-man's switch. We ping an EXTERNAL watchdog on every successful monitor run; if our servers stop, the pings
    stop and THAT service emails you. It is the only way anyone can tell you the whole platform is down."""
    if not settings.ALERT_HEARTBEAT_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.get(settings.ALERT_HEARTBEAT_URL)
    except Exception:  # noqa: BLE001
        pass
