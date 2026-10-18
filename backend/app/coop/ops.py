"""Operations: money position, reconciliation, background jobs and the go-live checklist."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import cases, defs, insights, ledger, service, yearend
from app.coop.models import CoopJobRun, CoopJournal, CoopMember, CoopReconciliation, CoopSweep
from app.coop.service import naira
from app.coop.settings_store import Rules
from app.models.user import User, UserRole


# ── money position ────────────────────────────────────────────────────────
async def money_position(db: AsyncSession, rules: Rules) -> dict:
    """
    Every kobo attributed to the cooperative, and how much real cash the books say it should hold.
    cash = contributions + pools + running-cost fund + operating - loans still owed
    (a member's money lent out is not cash; a repayment from contribution converts one into the other and leaves cash unchanged).
    """
    t = await ledger.money_totals(db)
    pools = {l: t.get(l, 0) for l in ledger.POOL_LEDGERS}
    contributions, locked = t.get("contribution", 0), t.get("locked", 0)
    repaid_p = await yearend.principal_repaid(db)
    outstanding = t.get("loan_out", 0) - repaid_p - t.get("loan_written_off", 0)
    expected_cash = contributions + sum(pools.values()) + t.get("running_cost", 0) + t.get("operating", 0) - outstanding
    sw_in = int((await db.execute(select(func.coalesce(func.sum(CoopSweep.amount_kobo), 0)).where(CoopSweep.direction == "to_coop_account"))).scalar_one())
    sw_out = int((await db.execute(select(func.coalesce(func.sum(CoopSweep.amount_kobo), 0)).where(CoopSweep.direction == "from_coop_account"))).scalar_one())
    swept = sw_in - sw_out
    mode = rules.get("coop_account_mode")
    return {"mode": mode, "live": bool(rules.get("coop_live_funds")),
            "funds": {"member_contributions_kobo": contributions, "of_which_locked_kobo": locked, "free_kobo": contributions - locked,
                      "dividend_pool_kobo": sum(pools.values()), "pool_interest_kobo": pools["pool_interest"], "pool_overdue_kobo": pools["pool_overdue"],
                      "pool_withdrawal_kobo": pools["pool_withdrawal"], "pool_carry_kobo": pools["pool_carry"],
                      "running_cost_kobo": t.get("running_cost", 0), "operating_kobo": t.get("operating", 0), "loans_outstanding_kobo": outstanding},
            "expected_cash_kobo": expected_cash, "swept_to_coop_account_kobo": swept,
            "to_sweep_kobo": expected_cash - swept if mode == "sub_account" else 0,
            "note": ("Everything stays in the single settlement account. The figures above are the cooperative's share of it."
                     if mode == "single_settlement" else
                     "Cooperative money is kept in its own account. 'To sweep' is how much more must be moved there (negative: moved too much). Each move is confirmed by directors."),
            "sweeps": [{"id": str(s.id), "direction": s.direction, "amount_kobo": s.amount_kobo, "reference": s.reference, "at": s.created_at.isoformat()}
                       for s in (await db.execute(select(CoopSweep).order_by(CoopSweep.created_at.desc()).limit(30))).scalars().all()]}


# ── reconciliation ────────────────────────────────────────────────────────
async def all_checks(db: AsyncSession, rules: Rules) -> list[dict]:
    checks = await insights.reconciliation(db)
    pos = await money_position(db, rules)
    f = pos["funds"]
    checks.append({"name": "No fund is below zero", "ok": min(f["running_cost_kobo"], f["operating_kobo"], f["loans_outstanding_kobo"], f["dividend_pool_kobo"]) >= 0,
                   "detail": f"running costs {naira(f['running_cost_kobo'])}, pool {naira(f['dividend_pool_kobo'])}, loans owed {naira(f['loans_outstanding_kobo'])}"})
    checks.append({"name": "Expected cash is not negative", "ok": pos["expected_cash_kobo"] >= 0, "detail": naira(pos["expected_cash_kobo"])})
    return checks


async def run_reconciliation(db: AsyncSession, rules: Rules) -> dict:
    checks = await all_checks(db, rules)
    ok = all(c["ok"] for c in checks)
    pos = await money_position(db, rules)
    row = CoopReconciliation(ok=ok, checks=checks, position={k: pos[k] for k in ("expected_cash_kobo", "swept_to_coop_account_kobo", "funds")})
    db.add(row)
    await db.flush()
    if not ok:
        await service.notify_directors(db, rules, "Reconciliation problem", "; ".join(c["name"] for c in checks if not c["ok"])[:200])
    return {"ok": ok, "checks": checks, "run_at": row.run_at.isoformat() if row.run_at else None}


async def last_reconciliation(db: AsyncSession) -> Optional[CoopReconciliation]:
    return (await db.execute(select(CoopReconciliation).order_by(CoopReconciliation.id.desc()).limit(1))).scalars().first()


# ── jobs ──────────────────────────────────────────────────────────────────
async def _j_sweep(db, rules):
    await service.sweep(db, rules)
    return {}


async def _j_auto(db, rules):
    return await service.auto_deduct(db, rules)


async def _j_remind(db, rules):
    return {"sent": await service.send_reminders(db, rules)}


async def _j_cases(db, rules):
    return {"opened": await cases.auto_open_recovery(db, rules)}


async def _j_recon(db, rules):
    r = await run_reconciliation(db, rules)
    return {"ok": r["ok"]}


JOBS = [("sweep", 5, _j_sweep), ("auto_deduct", 60, _j_auto), ("reminders", 360, _j_remind), ("recovery_cases", 360, _j_cases), ("reconcile", 720, _j_recon)]


async def run_jobs(db: AsyncSession, rules: Rules, force: bool = False) -> dict:
    """Debounced by real time, one runner at a time. Called lazily from busy screens, by the director's Run now, and by a scheduler."""
    got = (await db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext('coop:jobs'))"))).scalar()
    if not got:
        return {"skipped": "another run is in progress"}
    now = datetime.now(timezone.utc)
    out = {}
    for name, every, fn in JOBS:
        row = await db.get(CoopJobRun, name)
        if not force and row and now - row.last_run_at < timedelta(minutes=every):
            continue
        try:
            async with db.begin_nested():
                res = await fn(db, rules)
        except Exception as e:  # one failing job must never block the others or the request
            res = {"error": str(e)[:200]}
        out[name] = res
        if row:
            row.last_run_at, row.last_result = now, res
        else:
            db.add(CoopJobRun(name=name, last_run_at=now, last_result=res))
        await db.flush()
    return out


async def job_status(db: AsyncSession) -> list[dict]:
    rows = {r.name: r for r in (await db.execute(select(CoopJobRun))).scalars().all()}
    return [{"name": n, "every_minutes": e, "last_run_at": rows[n].last_run_at.isoformat() if n in rows else None,
             "last_result": rows[n].last_result if n in rows else None} for n, e, _ in JOBS]


def job_secret_ok(header_value: Optional[str]) -> bool:
    secret = os.environ.get("COOP_JOB_SECRET", "")
    return bool(secret) and header_value == secret


# ── go-live ───────────────────────────────────────────────────────────────
async def go_live_checklist(db: AsyncSession, rules: Rules) -> dict:
    items = []

    def add(key, label, ok, detail=""):
        items.append({"key": key, "label": label, "ok": bool(ok), "detail": detail})

    unconfirmed = [d.label for d in defs.DEFINITIONS if d.required_for_live and not d.hidden and not rules.is_confirmed(d.key)]
    add("rules", "Every rule needed for live money is confirmed by the Board", not unconfirmed, ("Still provisional: " + ", ".join(unconfirmed[:6]) + (" …" if len(unconfirmed) > 6 else "")) if unconfirmed else "")
    add("accountant", "A director has accountant duty", bool(rules.get("accountant_user_id")))
    add("treasurer", "A director has treasurer duty", bool(rules.get("treasurer_user_id")) or rules.get("payout_executor") == "any_director",
        "Not needed while any director may send payouts" if rules.get("payout_executor") == "any_director" else "")
    dcount = (await db.execute(select(func.count()).select_from(User).where(User.role == UserRole.DIRECTOR))).scalar_one()
    need = int(rules.get("approvals_golive"))
    add("directors", f"At least {need} directors exist to switch live money on", dcount >= need, f"{dcount} director account(s)")
    add("step_up", "Extra confirmation is on for money actions", rules.get("step_up_required") != "off")
    add("rail", "Money moves through the wallet rail", rules.get("money_rail") == "wallet")
    add("pilot_cap", "The pilot cap is set", (not rules.get("coop_pilot_only")) or (bool(rules.get("pilot_cap_enabled")) and int(rules.get("pilot_cap_kobo")) > 0))
    add("clock", "The test clock is at today", int(rules.get("test_clock_offset_days")) == 0)
    n = (await db.execute(select(func.count()).select_from(CoopJournal))).scalar_one()
    add("clean", "Practice data has been cleared", n == 0, f"{n} practice entries remain. Use Reset in Test tools first." if n else "")
    rec = await last_reconciliation(db)
    age = int(rules.get("reconciliation_max_age_hours"))
    fresh = bool(rec and rec.ok and datetime.now(timezone.utc) - rec.run_at < timedelta(hours=age))
    add("reconciliation", f"A clean reconciliation ran in the last {age} hours", fresh, "Run the check from the Money tab" if not fresh else "")
    already = bool(rules.get("coop_live_funds"))
    return {"items": items, "ready": all(i["ok"] for i in items) and not already, "live": already, "needed_approvals": need}
