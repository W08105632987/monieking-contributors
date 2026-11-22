"""Monnify center: what Monnify holds for us, what it still owes us (pending settlement), and every Monnify-related transaction.

Wallet balance      read live from Monnify (the same call the health monitor uses).
Pending settlement  COMPUTED, not read: when a customer funds a wallet, Monnify settles that money into our Monnify wallet
                    (net of its fee) a number of business days later. Funding records store the gross and Monnify's fee, so
                    pending = money funded whose settlement day has not arrived yet. The number of business days is a
                    director setting (monnify.settlement_days).
A payment whose settlement day has passed is NOT counted as pending (it should already be in the wallet, and counting it
again would double it); it is listed as late instead, and alerted on.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.services import settings_service as cfg

settings = get_settings()
WAT = timezone(timedelta(hours=1))

SETTLEMENT_DAYS_KEY = "monnify.settlement_days"
WARNING_KEY = "monnify.low_warning_naira"
CRITICAL_KEY = "monnify.low_critical_naira"
LATE_ALERT_KEY = "monnify.late_settlement_alerts"

SECTIONS = {
    "funding": "Wallet funding (customers paying into their accounts)",
    "bills": "Bills, airtime and data paid through Monnify",
    "withdrawals": "Withdrawals paid out",
}


def add_business_days(d: date, n: int) -> date:
    """Monnify does not settle on weekends. (Bank holidays are not modelled: settlement then looks a day late, never early.)"""
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    while d.weekday() >= 5:     # paid on a weekend: settles on the next business day at the earliest
        d += timedelta(days=1)
    return d


def expected_settlement(created_at: datetime, days: int) -> date:
    return add_business_days(created_at.astimezone(WAT).date(), max(0, days))


async def thresholds(db: AsyncSession) -> dict:
    """Warning and critical levels (naira) for the Monnify wallet. Blank = fall back to the old environment setting."""
    base = float(settings.MONNIFY_MIN_WALLET_NAIRA)
    warn = await cfg.get_config_float(db, WARNING_KEY, base) if (await cfg.get_config_value(db, WARNING_KEY, "")) else base
    crit_raw = await cfg.get_config_value(db, CRITICAL_KEY, "")
    crit = float(crit_raw) if crit_raw not in (None, "") else warn * 0.25
    if crit > warn:
        crit = warn
    return {"warning_naira": warn, "critical_naira": crit}


async def settlement_days(db: AsyncSession) -> int:
    return max(0, min(10, await cfg.get_config_int(db, SETTLEMENT_DAYS_KEY, 1)))


def wallet_status(available_naira: float, th: dict) -> str:
    if available_naira < th["critical_naira"]:
        return "critical"
    if available_naira < th["warning_naira"]:
        return "warning"
    return "ok"


async def _funding_rows(db: AsyncSession, since: datetime) -> list[tuple]:
    return (await db.execute(text(
        "SELECT reference, created_at, gross_kobo, customer_fee_kobo, credited_kobo, monnify_fee_kobo "
        "FROM funding_records WHERE created_at >= :since ORDER BY created_at DESC"), {"since": since})).all()


async def settlement_position(db: AsyncSession, now: datetime | None = None, include_due_today: bool = False) -> dict:
    """Pending (not yet due), due today, and late (overdue) settlements, in kobo."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(WAT).date()
    days = await settlement_days(db)
    rows = await _funding_rows(db, now - timedelta(days=days * 3 + 12))
    pending = due_today = late = 0
    n_pending = n_due = n_late = unknown_fee = 0
    late_items: list[dict] = []
    by_day: dict[str, int] = {}
    for ref, created, gross, _cfee, _cred, mfee in rows:
        net = int(gross) - int(mfee or 0)
        if mfee is None:
            unknown_fee += 1
        due = expected_settlement(created, days)
        if due > today:
            pending += net; n_pending += 1
            by_day[due.isoformat()] = by_day.get(due.isoformat(), 0) + net
        elif due == today:
            due_today += net; n_due += 1
        else:
            late += net; n_late += 1
            if len(late_items) < 25:
                late_items.append({"reference": ref, "amount_kobo": net, "paid_on": created.astimezone(WAT).date().isoformat(), "expected_on": due.isoformat()})
    if include_due_today:
        pending += due_today
    return {"settlement_days": days, "pending_kobo": pending, "pending_count": n_pending, "due_today_kobo": due_today, "due_today_count": n_due,
            "late_kobo": late, "late_count": n_late, "late_items": late_items, "unknown_fee_count": unknown_fee,
            "includes_due_today": include_due_today, "pending_by_settlement_day": [{"day": k, "amount_kobo": v} for k, v in sorted(by_day.items())],
            "note": "Estimated from funding records and the settlement days set below. Verify against Monnify until you trust it."}


async def wallet_snapshot() -> dict:
    """Live wallet balance, in kobo. 'available' None means Monnify could not be reached."""
    from app.services.monitor_checks import fetch_wallet_balance
    w = await fetch_wallet_balance()
    if not w:
        return {"reachable": False, "available_kobo": None, "ledger_kobo": None}
    led = w.get("ledger")
    return {"reachable": True, "available_kobo": int(round(w["available"] * 100)),
            "ledger_kobo": int(round(float(led) * 100)) if led not in (None, "") else None}


def _range(start: date, end: date) -> tuple[datetime, datetime]:
    return (datetime(start.year, start.month, start.day, tzinfo=WAT), datetime(end.year, end.month, end.day, tzinfo=WAT) + timedelta(days=1))


async def transactions(db: AsyncSession, start: date, end: date, section: str | None = None, status: str | None = None,
                       q: str | None = None, limit: int = 100, offset: int = 0) -> dict:
    """Every Monnify-related transaction in the period, broken down by section, with totals that match the list."""
    s, e = _range(start, end)
    days = await settlement_days(db)
    today = datetime.now(WAT).date()
    items: list[dict] = []
    summary: dict[str, dict[str, Any]] = {k: {"label": v, "count": 0, "amount_kobo": 0, "fees_kobo": 0, "commission_kobo": 0} for k, v in SECTIONS.items()}

    if section in (None, "funding"):
        for ref, created, gross, cfee, cred, mfee, name in (await db.execute(text(
                "SELECT f.reference, f.created_at, f.gross_kobo, f.customer_fee_kobo, f.credited_kobo, f.monnify_fee_kobo, u.full_name "
                "FROM funding_records f LEFT JOIN users u ON u.id = f.user_id WHERE f.created_at >= :s AND f.created_at < :e ORDER BY f.created_at DESC"),
                {"s": s, "e": e})).all():
            due = expected_settlement(created, days)
            st = "pending settlement" if due > today else ("due today" if due == today else "settled (expected)")
            summary["funding"]["count"] += 1; summary["funding"]["amount_kobo"] += int(gross); summary["funding"]["fees_kobo"] += int(mfee or 0)
            items.append({"section": "funding", "reference": ref, "at": created.isoformat(), "who": name, "amount_kobo": int(gross),
                          "fee_kobo": int(mfee) if mfee is not None else None, "status": st, "settles_on": due.isoformat(),
                          "detail": f"Customer fee {int(cfee)/100:,.2f}; wallet credited {int(cred)/100:,.2f}"})
    if section in (None, "bills"):
        for ref, created, amt, charged, vend, comm, st, cat, prov, name in (await db.execute(text(
                "SELECT COALESCE(b.monnify_transaction_reference, b.provider_reference, b.id::text), b.created_at, b.amount_kobo, b.amount_charged_kobo, "
                "b.vend_amount_kobo, b.commission_kobo, b.status::text, bl.category::text, b.provider, u.full_name "
                "FROM bill_payment_requests b LEFT JOIN billers bl ON bl.id = b.biller_id LEFT JOIN users u ON u.id = b.customer_id "
                "WHERE b.created_at >= :s AND b.created_at < :e AND b.provider = 'monnify' ORDER BY b.created_at DESC"), {"s": s, "e": e})).all():
            amount = int(vend if vend is not None else amt)
            if st == "completed":
                summary["bills"]["count"] += 1; summary["bills"]["amount_kobo"] += amount; summary["bills"]["commission_kobo"] += int(comm or 0)
            items.append({"section": "bills", "reference": ref, "at": created.isoformat(), "who": name, "amount_kobo": amount, "fee_kobo": None,
                          "status": st, "settles_on": None, "detail": f"{cat or 'bill'}; commission {int(comm or 0)/100:,.2f}"})
    if section in (None, "withdrawals"):
        for wid, created, net, charge, st, name in (await db.execute(text(
                "SELECT w.id::text, COALESCE(w.processed_at, w.requested_at), w.net_payable_kobo, w.charge_kobo, w.status::text, u.full_name "
                "FROM withdrawals w LEFT JOIN users u ON u.id = w.customer_id "
                "WHERE COALESCE(w.processed_at, w.requested_at) >= :s AND COALESCE(w.processed_at, w.requested_at) < :e ORDER BY 2 DESC"), {"s": s, "e": e})).all():
            if st == "completed":
                summary["withdrawals"]["count"] += 1; summary["withdrawals"]["amount_kobo"] += int(net)
            items.append({"section": "withdrawals", "reference": wid[:8].upper(), "at": created.isoformat(), "who": name, "amount_kobo": int(net),
                          "fee_kobo": None, "status": st, "settles_on": None, "detail": f"Charge {int(charge)/100:,.2f}"})
    if status:
        items = [i for i in items if i["status"] == status]
    if q:
        needle = q.strip().lower()
        items = [i for i in items if needle in (i["reference"] or "").lower() or needle in (i["who"] or "").lower()]
    items.sort(key=lambda i: i["at"], reverse=True)
    return {"start": start.isoformat(), "end": end.isoformat(), "total": len(items), "items": items[offset:offset + limit], "sections": summary,
            "note": "Funding counts every payment received. Bills and withdrawals count completed ones only in the totals; the list shows all statuses."}


async def center(db: AsyncSession, start: date, end: date) -> dict:
    wallet = await wallet_snapshot()
    th = await thresholds(db)
    pos = await settlement_position(db)
    status = wallet_status(wallet["available_kobo"] / 100, th) if wallet["available_kobo"] is not None else "unreachable"
    tx = await transactions(db, start, end, limit=0)
    return {"wallet": {**wallet, "status": status}, "thresholds": th, "settlement": pos, "sections": tx["sections"],
            "late_alerts_enabled": (await cfg.get_config_value(db, LATE_ALERT_KEY, "true")) != "false",
            "available_plus_pending_kobo": (wallet["available_kobo"] or 0) + pos["pending_kobo"]}
