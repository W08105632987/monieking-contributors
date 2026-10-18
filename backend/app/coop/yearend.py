"""Year end: membership fees, the dividend run (prepare, reconcile, approve, pay), disputes, expenses, reports and PDFs."""
from __future__ import annotations

import io
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import approvals, audit, insights, ledger, logic, rail, service
from app.coop.errors import CoopError
from app.coop.models import (CoopDividendDispute, CoopDividendLine, CoopDividendRun, CoopExpense, CoopJournal, CoopLoan, CoopMember)
from app.coop.service import naira, notify
from app.coop.settings_store import Rules
from app.models.user import User


# ── membership fee ────────────────────────────────────────────────────────
async def collect_fees(db: AsyncSession, rules: Rules, actor: User) -> dict:
    fee = int(rules.get("membership_fee_kobo"))
    taken = skipped = 0
    for m in (await db.execute(select(CoopMember).where(CoopMember.status == "active", CoopMember.fee_paid_at.is_(None)))).scalars().all():
        if await service.take_membership_fee(db, rules, m, fee, actor.id):
            taken += 1
            await notify(db, m.user_id, "Membership fee taken", f"The one-time membership fee of {naira(fee)} was taken from your contribution balance.", "/coop/me")
        else:
            skipped += 1
    await audit.record(db, "fees", "collect", "collected", actor.id, {"taken": taken, "skipped": skipped, "fee": fee})
    return {"taken": taken, "not_enough_free_funds": skipped, "fee_kobo": fee, "collected_kobo": taken * fee}


# ── dividend run ──────────────────────────────────────────────────────────
def _is_accountant(rules: Rules, user: User) -> bool:
    acc = rules.get("accountant_user_id")
    return not acc or str(user.id) == acc


async def default_year(rules: Rules) -> int:
    ys, ye = logic.year_bounds(logic.accounting_year(rules.today()), int(rules.get("year_end_month")), int(rules.get("year_end_day")))
    return logic.accounting_year(rules.today())


async def compute_lines(db: AsyncSession, rules: Rules, year: int) -> dict:
    W = await insights._weights(db, rules, year=year)
    pool = await ledger.pool_total(db, year)
    cp, gp = logic.split_pool(max(pool, 0), int(rules.get("dividend_contribution_pct")))
    qualified, reasons = {}, {}
    for mid, m in W["members"].items():
        months = (datetime(W["ye"].year, W["ye"].month, W["ye"].day, tzinfo=timezone.utc) - m.registered_at).days / 30.4
        ok, why = logic.qualifies(W["bal"].get(mid, 0), months, int(rules.get("dividend_min_balance_kobo")), int(rules.get("dividend_min_months")),
                                  m.disqualified_year == year, m.status == "active")
        qualified[mid], reasons[mid] = ok, why
    redistribute = rules.get("dividend_unqualified") == "redistribute"
    cw = {k: v for k, v in W["cw"].items() if v > 0 and (qualified[k] or not redistribute)}
    gw = {k: v for k, v in W["gw"].items() if v > 0 and (qualified[k] or not redistribute)}
    c_sh, g_sh = logic.largest_remainder(cp, cw), logic.largest_remainder(gp, gw)
    lines = {}
    for mid in W["members"]:
        c, g = c_sh.get(mid, 0), g_sh.get(mid, 0)
        if not qualified[mid]:
            lines[mid] = (0, 0, 0, False, reasons[mid], c + g)
        else:
            lines[mid] = (c, g, c + g, True, "", 0)
    distributed = sum(v[2] for v in lines.values())
    return {"pool": pool, "cp": cp, "gp": gp, "lines": lines, "distributed": distributed, "carry": max(pool, 0) - distributed, "W": W}


async def prepare_dividend(db: AsyncSession, rules: Rules, user: User, year: Optional[int] = None) -> CoopDividendRun:
    if not _is_accountant(rules, user):
        raise CoopError("Only the director with accountant duty prepares the dividend", 403, "not_accountant")
    year = year or logic.accounting_year(rules.today())
    existing = (await db.execute(select(CoopDividendRun).where(CoopDividendRun.year == year, CoopDividendRun.status != "cancelled"))).scalars().first()
    if existing:
        if existing.status in ("prepared", "reconciled"):
            existing.status = "cancelled"
            await db.flush()
        else:
            raise CoopError(f"The {year} dividend is already {existing.status}", 409)
    c = await compute_lines(db, rules, year)
    run = CoopDividendRun(year=year, status="prepared", pool_kobo=c["pool"], contribution_pool_kobo=c["cp"], guarantee_pool_kobo=c["gp"],
                          distributable_kobo=c["distributed"], carry_kobo=c["carry"], payout_mode=rules.get("dividend_payout"), prepared_by=user.id)
    db.add(run)
    await db.flush()
    for mid, (cc, gg, tot, ok, why, forgone) in c["lines"].items():
        db.add(CoopDividendLine(run_id=run.id, member_id=mid, contribution_kobo=cc, guarantee_kobo=gg, total_kobo=tot, qualified=ok, reason=why or None))
    run.report = {"qualified": sum(1 for v in c["lines"].values() if v[3]), "members": len(c["lines"]),
                  "forgone_by_unqualified_kobo": sum(v[5] for v in c["lines"].values()), "unqualified_mode": rules.get("dividend_unqualified")}
    await db.flush()
    await audit.record(db, "dividend", run.id, "prepared", user.id, {"year": year, "pool": c["pool"], "distributable": c["distributed"], "carry": c["carry"]})
    return run


async def run_checks(db: AsyncSession, rules: Rules, run: CoopDividendRun) -> list[dict]:
    lines = (await db.execute(select(CoopDividendLine).where(CoopDividendLine.run_id == run.id))).scalars().all()
    total = sum(l.total_kobo for l in lines)
    live_pool = await ledger.pool_total(db, run.year)
    c = await compute_lines(db, rules, run.year)
    checks = [
        {"name": "Shares plus carry-forward equal the pool", "ok": total + run.carry_kobo == run.pool_kobo, "detail": f"{naira(total)} + {naira(run.carry_kobo)} vs {naira(run.pool_kobo)}"},
        {"name": "The pool is unchanged since it was prepared", "ok": live_pool == run.pool_kobo, "detail": f"now {naira(live_pool)}, prepared with {naira(run.pool_kobo)}"},
        {"name": "Every member's share still matches the records", "ok": all(c["lines"].get(l.member_id, (0, 0, -1))[2] == l.total_kobo for l in lines), "detail": "recalculated from the ledger"},
        {"name": "No share is negative", "ok": all(l.total_kobo >= 0 for l in lines), "detail": f"{len(lines)} members"},
        {"name": "Contribution and guarantee halves add up", "ok": run.contribution_pool_kobo + run.guarantee_pool_kobo == max(run.pool_kobo, 0), "detail": f"{naira(run.contribution_pool_kobo)} + {naira(run.guarantee_pool_kobo)}"},
        {"name": "The pool is not negative", "ok": run.pool_kobo >= 0, "detail": naira(run.pool_kobo)},
    ]
    return checks


async def reconcile_dividend(db: AsyncSession, rules: Rules, user: User, run_id) -> tuple[CoopDividendRun, list[dict]]:
    run = (await db.execute(select(CoopDividendRun).where(CoopDividendRun.id == run_id).with_for_update())).scalars().first()
    if not run or run.status != "prepared":
        raise CoopError("Only a prepared dividend can be reconciled", 409)
    if not _is_accountant(rules, user):
        raise CoopError("Only the director with accountant duty reconciles the dividend", 403, "not_accountant")
    checks = await run_checks(db, rules, run)
    run.report = {**(run.report or {}), "checks": checks}
    if not all(c["ok"] for c in checks):
        await db.flush()
        raise CoopError("Reconciliation failed: " + "; ".join(c["name"] for c in checks if not c["ok"]) + ". Prepare the dividend again.", 409, "reconcile_failed")
    run.status, run.reconciled_by, run.reconciled_at = "reconciled", user.id, rules.now()
    await db.flush()
    await audit.record(db, "dividend", run.id, "reconciled", user.id)
    req = await approvals.open_request(db, rules, kind="dividend_run", actor=None, ref_id=str(run.id), amount=run.distributable_kobo,
                                       reason=f"Approve the {run.year} dividend: {naira(run.distributable_kobo)} to members, {naira(run.carry_kobo)} carried forward.")
    run.request_id = req.id
    await service.notify_directors(db, rules, "Dividend ready for approval", f"The {run.year} dividend is reconciled and needs {req.needed} approval(s).")
    return run, checks


async def pay_dividend(db: AsyncSession, rules: Rules, user: User, run_id) -> CoopDividendRun:
    run = (await db.execute(select(CoopDividendRun).where(CoopDividendRun.id == run_id).with_for_update())).scalars().first()
    if not run or run.status != "approved":
        raise CoopError("Only an approved dividend can be paid", 409)
    lines = (await db.execute(select(CoopDividendLine).where(CoopDividendLine.run_id == run.id))).scalars().all()
    now = rules.now()
    paid = 0
    for l in lines:
        if l.total_kobo <= 0:
            continue
        m = await db.get(CoopMember, l.member_id)
        ref = f"div:{run.id}:{m.id}"
        if run.payout_mode == "contribution":
            await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="dividend", delta=l.total_kobo, reference=ref, actor=user.id,
                              note=f"{run.year} dividend", year=run.year)
        else:
            await ledger.post(db, rules, member_id=m.id, ledger="dividend_paid", entry_type="dividend", delta=l.total_kobo, reference=ref, actor=user.id,
                              note=f"{run.year} dividend paid to {run.payout_mode}", year=run.year)
            await rail.credit_member(db, rules, m.user_id, l.total_kobo, ref, f"{run.year} dividend", user.id)
        l.paid_at = now
        paid += l.total_kobo
        await notify(db, m.user_id, "Your dividend", f"Your {run.year} dividend of {naira(l.total_kobo)} has been " +
                     ("added to your contribution balance." if run.payout_mode == "contribution" else "paid out."), "/coop/dividend")
    if paid:
        await ledger.post(db, rules, member_id=None, ledger="pool_distributed", entry_type="dividend_distributed", delta=-paid,
                          reference=f"divpool:{run.id}", actor=user.id, note=f"{run.year} dividend paid", year=run.year)
    if run.carry_kobo > 0:
        await ledger.post(db, rules, member_id=None, ledger="pool_carry", entry_type="carry_out", delta=-run.carry_kobo,
                          reference=f"carryout:{run.id}", actor=user.id, note=f"Carried to {run.year + 1}", year=run.year)
        await ledger.post(db, rules, member_id=None, ledger="pool_carry", entry_type="carry_in", delta=run.carry_kobo,
                          reference=f"carryin:{run.id}", actor=user.id, note=f"Carried from {run.year}", year=run.year + 1)
    run.status, run.paid_at = "paid", now
    await audit.record(db, "dividend", run.id, "paid", user.id, {"paid": paid, "carry": run.carry_kobo})
    return run


async def run_view(db: AsyncSession, run: CoopDividendRun, with_lines: bool = True) -> dict:
    out = {"id": str(run.id), "year": run.year, "status": run.status, "pool_kobo": run.pool_kobo, "contribution_pool_kobo": run.contribution_pool_kobo,
           "guarantee_pool_kobo": run.guarantee_pool_kobo, "distributable_kobo": run.distributable_kobo, "carry_kobo": run.carry_kobo,
           "payout_mode": run.payout_mode, "report": run.report, "request_id": str(run.request_id) if run.request_id else None,
           "approved_at": run.approved_at.isoformat() if run.approved_at else None, "paid_at": run.paid_at.isoformat() if run.paid_at else None,
           "created_at": run.created_at.isoformat()}
    if with_lines:
        ls = (await db.execute(select(CoopDividendLine, CoopMember, User).join(CoopMember, CoopMember.id == CoopDividendLine.member_id)
                               .join(User, User.id == CoopMember.user_id).where(CoopDividendLine.run_id == run.id).order_by(CoopDividendLine.total_kobo.desc()))).all()
        out["lines"] = [{"member_id": str(m.id), "name": u.full_name, "card_no": m.card_no, "contribution_kobo": l.contribution_kobo,
                         "guarantee_kobo": l.guarantee_kobo, "total_kobo": l.total_kobo, "qualified": l.qualified, "reason": l.reason,
                         "paid": bool(l.paid_at)} for l, m, u in ls]
    return out


# ── disputes (14 days by default) ─────────────────────────────────────────
async def member_dividends(db: AsyncSession, rules: Rules, m: CoopMember) -> list[dict]:
    rows = (await db.execute(select(CoopDividendRun, CoopDividendLine).join(CoopDividendLine, CoopDividendLine.run_id == CoopDividendRun.id)
                             .where(CoopDividendLine.member_id == m.id, CoopDividendRun.status.in_(("approved", "paid"))).order_by(CoopDividendRun.year.desc()))).all()
    out = []
    days = int(rules.get("dividend_dispute_days"))
    for run, l in rows:
        deadline = (run.approved_at + timedelta(days=days)) if run.approved_at else None
        d = (await db.execute(select(CoopDividendDispute).where(CoopDividendDispute.run_id == run.id, CoopDividendDispute.member_id == m.id)
                              .order_by(CoopDividendDispute.created_at.desc()))).scalars().first()
        out.append({"run_id": str(run.id), "year": run.year, "status": run.status, "contribution_kobo": l.contribution_kobo, "guarantee_kobo": l.guarantee_kobo,
                    "total_kobo": l.total_kobo, "qualified": l.qualified, "reason": l.reason, "paid_at": l.paid_at.isoformat() if l.paid_at else None,
                    "dispute_deadline": deadline.isoformat() if deadline else None, "can_dispute": bool(deadline and rules.now() <= deadline and not (d and d.status == "open")),
                    "dispute": {"id": str(d.id), "status": d.status, "body": d.body, "resolution": d.resolution, "adjust_kobo": d.adjust_kobo} if d else None})
    return out


async def open_dispute(db: AsyncSession, rules: Rules, m: CoopMember, user: User, run_id, body: str) -> CoopDividendDispute:
    run = await db.get(CoopDividendRun, run_id)
    if not run or run.status not in ("approved", "paid") or not run.approved_at:
        raise CoopError("There is no approved dividend to dispute", 404)
    if (await db.execute(select(CoopDividendLine).where(CoopDividendLine.run_id == run.id, CoopDividendLine.member_id == m.id))).scalars().first() is None:
        raise CoopError("You are not part of this dividend run", 404)
    if rules.now() > run.approved_at + timedelta(days=int(rules.get("dividend_dispute_days"))):
        raise CoopError(f"The {rules.get('dividend_dispute_days')}-day window to dispute this dividend has closed", 409, "window_closed")
    if not (body or "").strip():
        raise CoopError("Please say what you think is wrong")
    if (await db.execute(select(CoopDividendDispute).where(CoopDividendDispute.run_id == run.id, CoopDividendDispute.member_id == m.id, CoopDividendDispute.status == "open"))).scalars().first():
        raise CoopError("You already have an open dispute on this dividend", 409)
    d = CoopDividendDispute(run_id=run.id, member_id=m.id, body=body.strip()[:2000])
    db.add(d)
    await db.flush()
    await audit.record(db, "dividend", run.id, "dispute_opened", user.id, {"member": str(m.id)})
    await service.notify_directors(db, rules, "Dividend dispute", f"{user.full_name} disputes the {run.year} dividend.")
    return d


async def resolve_dispute(db: AsyncSession, rules: Rules, director: User, dispute_id, uphold: bool, adjust_kobo: int, resolution: str, fund_from: str = "pool") -> CoopDividendDispute:
    d = (await db.execute(select(CoopDividendDispute).where(CoopDividendDispute.id == dispute_id).with_for_update())).scalars().first()
    if not d or d.status != "open":
        raise CoopError("This dispute is already resolved", 409)
    if not (resolution or "").strip():
        raise CoopError("Write the decision and the reason")
    run = await db.get(CoopDividendRun, d.run_id)
    m = await db.get(CoopMember, d.member_id)
    if uphold and adjust_kobo != 0:
        if run.status != "paid":
            raise CoopError("The dividend has not been paid yet. Correct it by preparing the run again before approval.", 409)
        ref = f"divadj:{d.id}"
        if fund_from not in ("pool", "running_cost"):
            raise CoopError("Choose where the correction is paid from: the pool or the running-cost fund")
        if adjust_kobo > 0:
            avail = await ledger.pool_total(db) if fund_from == "pool" else await ledger.balance(db, None, "running_cost")
            if adjust_kobo > avail:
                raise CoopError(f"The {'dividend pool' if fund_from == 'pool' else 'running-cost fund'} holds {naira(avail)}, which cannot cover this correction. "
                                f"{'Pay it from the running-cost fund instead.' if fund_from == 'pool' else ''}".strip(), 409, "cannot_fund")
        if run.payout_mode == "contribution":
            await ledger.post(db, rules, member_id=m.id, ledger="contribution", entry_type="dividend_adjustment", delta=adjust_kobo, reference=ref,
                              actor=director.id, note=f"{run.year} dividend dispute", year=run.year)
        else:
            await ledger.post(db, rules, member_id=m.id, ledger="dividend_paid", entry_type="dividend_adjustment", delta=adjust_kobo, reference=ref,
                              actor=director.id, note=f"{run.year} dividend dispute", year=run.year)
            if adjust_kobo > 0:
                await rail.credit_member(db, rules, m.user_id, adjust_kobo, ref, f"{run.year} dividend correction", director.id)
        if fund_from == "pool":
            await ledger.post(db, rules, member_id=None, ledger="pool_distributed", entry_type="dividend_adjustment", delta=-adjust_kobo, reference=f"{ref}:pool",
                              actor=director.id, note=f"{run.year} dividend dispute with {m.card_no}", year=run.year)
        else:
            await ledger.post(db, rules, member_id=None, ledger="running_cost", entry_type="dividend_adjustment", delta=-adjust_kobo, reference=f"{ref}:rc",
                              actor=director.id, note=f"{run.year} dividend dispute with {m.card_no}", year=run.year)
    d.status, d.resolution, d.adjust_kobo = ("upheld" if uphold else "rejected"), resolution.strip()[:2000], adjust_kobo if uphold else 0
    d.resolved_by, d.resolved_at = director.id, rules.now()
    await audit.record(db, "dividend", run.id, "dispute_resolved", director.id, {"uphold": uphold, "adjust": d.adjust_kobo})
    await notify(db, m.user_id, "Your dividend dispute was decided", ("Upheld. " if uphold else "Not upheld. ") + d.resolution[:160], "/coop/dividend")
    return d


# ── expenses (the running-cost register) ──────────────────────────────────
EXPENSE_CATEGORIES = ("software", "bank_charges", "legal", "audit", "communication", "meeting", "office", "other")


async def record_expense(db: AsyncSession, rules: Rules, director: User, category: str, amount: int, description: str, spent_on: date, evidence: Optional[str]) -> CoopExpense:
    if category not in EXPENSE_CATEGORIES:
        raise CoopError("Choose a category")
    if not (description or "").strip():
        raise CoopError("Describe the expense")
    ex = CoopExpense(category=category, amount_kobo=amount, description=description.strip()[:300], spent_on=spent_on, evidence=(evidence or "").strip() or None,
                     recorded_by=director.id)
    db.add(ex)
    await db.flush()
    req = await approvals.open_request(db, rules, kind="expense", actor=director, amount=amount, ref_id=str(ex.id), evidence=evidence,
                                       reason=f"{category}: {description}"[:300])
    ex.request_id = req.id
    return ex


async def expense_register(db: AsyncSession, rules: Rules, year: Optional[int] = None) -> dict:
    year = year or logic.accounting_year(rules.today())
    rows = (await db.execute(select(CoopExpense).order_by(CoopExpense.spent_on.desc(), CoopExpense.created_at.desc()).limit(300))).scalars().all()
    income = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
        CoopJournal.ledger == "running_cost", CoopJournal.delta_kobo > 0))).scalar_one())
    spent = int((await db.execute(select(func.coalesce(func.sum(CoopExpense.amount_kobo), 0)).where(CoopExpense.status == "approved"))).scalar_one())
    by_cat: dict = {}
    for e in rows:
        if e.status == "approved":
            by_cat[e.category] = by_cat.get(e.category, 0) + e.amount_kobo
    return {"fund_balance_kobo": await ledger.balance(db, None, "running_cost"), "received_kobo": income, "spent_kobo": spent, "by_category": by_cat,
            "categories": list(EXPENSE_CATEGORIES),
            "items": [{"id": str(e.id), "category": e.category, "amount_kobo": e.amount_kobo, "description": e.description, "spent_on": e.spent_on.isoformat(),
                       "evidence": e.evidence, "status": e.status} for e in rows]}


# ── monthly report ────────────────────────────────────────────────────────
async def monthly_report(db: AsyncSession, rules: Rules, year: int, month: int) -> dict:
    lo = datetime(year, month, 1, tzinfo=timezone.utc)
    hi = datetime(year + (month == 12), (month % 12) + 1, 1, tzinfo=timezone.utc)
    rows = (await db.execute(select(CoopJournal.ledger, CoopJournal.entry_type, func.coalesce(func.sum(CoopJournal.delta_kobo), 0), func.count()).where(
        CoopJournal.effective_at >= lo, CoopJournal.effective_at < hi).group_by(CoopJournal.ledger, CoopJournal.entry_type))).all()
    by = {(l, t): (int(v), int(c)) for l, t, v, c in rows}
    g = lambda l, t: by.get((l, t), (0, 0))[0]
    new_members = (await db.execute(select(func.count()).select_from(CoopMember).where(CoopMember.registered_at >= lo, CoopMember.registered_at < hi))).scalar_one()
    totals = await ledger.money_totals(db)
    loans = (await db.execute(select(CoopLoan).where(CoopLoan.status == "repaying"))).scalars().all()
    overdue = [l for l in loans if service.position(l, rules.today())["overdue"]]
    return {"year": year, "month": month, "contributions_in_kobo": g("contribution", "registration") + g("contribution", "contribution"),
            "withdrawals_kobo": -g("contribution", "withdrawal"), "closures_kobo": -g("contribution", "closure_payout"),
            "new_members": new_members, "loans_paid_out_kobo": g("loan_out", "disbursed"), "transfer_fees_kobo": g("operating", "transfer_fee"),
            "principal_repaid_kobo": g("loan_repaid", "repay_principal"), "interest_received_kobo": g("loan_repaid", "repay_interest"),
            "overdue_charges_received_kobo": g("loan_repaid", "repay_charge"), "running_cost_in_kobo": g("running_cost", "running_cost") + g("running_cost", "membership_fee") + g("running_cost", "closure_charge"),
            "expenses_kobo": -g("running_cost", "expense"), "withdrawal_charges_kobo": g("pool_withdrawal", "withdrawal_charge") + g("pool_withdrawal", "closure_charge"),
            "dividends_paid_kobo": -g("pool_distributed", "dividend_distributed"), "loans_written_off_kobo": g("loan_written_off", "written_off"),
            "end_of_month": {"members": (await db.execute(select(func.count()).select_from(CoopMember).where(CoopMember.status == "active"))).scalar_one(),
                             "contributions_kobo": totals.get("contribution", 0), "locked_kobo": totals.get("locked", 0),
                             "dividend_pool_kobo": sum(totals.get(l, 0) for l in ledger.POOL_LEDGERS), "running_cost_kobo": totals.get("running_cost", 0),
                             "loans_active": len(loans), "loans_overdue": len(overdue),
                             "loans_outstanding_kobo": totals.get("loan_out", 0) - await principal_repaid(db) - totals.get("loan_written_off", 0)}}


async def principal_repaid(db: AsyncSession) -> int:
    return int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
        CoopJournal.ledger == "loan_repaid", CoopJournal.entry_type == "repay_principal"))).scalar_one())


def report_pdf(rep: dict, title: str = "MonieKing Cooperative: monthly report") -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=title, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    st = getSampleStyleSheet()
    k = lambda v: naira(int(v)).replace("₦", "NGN ")
    rows = [("Money in", None)] + [(l, k(rep[x])) for l, x in (("Contributions received", "contributions_in_kobo"), ("Interest received", "interest_received_kobo"),
            ("Overdue charges received", "overdue_charges_received_kobo"), ("Principal repaid", "principal_repaid_kobo"), ("Transfer fees", "transfer_fees_kobo"))]
    rows += [("Money out", None)] + [(l, k(rep[x])) for l, x in (("Withdrawals", "withdrawals_kobo"), ("Loans paid out", "loans_paid_out_kobo"),
             ("Expenses", "expenses_kobo"), ("Dividends paid", "dividends_paid_kobo"), ("Loans written off", "loans_written_off_kobo"))]
    e = rep["end_of_month"]
    rows += [("Position at month end", None), ("Active members", str(e["members"])), ("Held in contributions", k(e["contributions_kobo"])),
             ("Locked behind guarantees", k(e["locked_kobo"])), ("Dividend pool", k(e["dividend_pool_kobo"])), ("Running-cost fund", k(e["running_cost_kobo"])),
             ("Loans outstanding", k(e["loans_outstanding_kobo"])), ("Active loans / overdue", f"{e['loans_active']} / {e['loans_overdue']}")]
    t = Table([[a, b or ""] for a, b in rows], colWidths=[320, 200])
    style = [("FONTSIZE", (0, 0), (-1, -1), 9), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey), ("ALIGN", (1, 0), (1, -1), "RIGHT")]
    for i, (a, b) in enumerate(rows):
        if b is None:
            style += [("BACKGROUND", (0, i), (-1, i), colors.HexColor("#0f5132")), ("TEXTCOLOR", (0, i), (-1, i), colors.white), ("FONTNAME", (0, i), (-1, i), "Helvetica-Bold")]
    t.setStyle(TableStyle(style))
    doc.build([Paragraph(title, st["Title"]), Paragraph(f"{rep['year']}-{rep['month']:02d}", st["Heading3"]), Spacer(1, 10), t])
    return buf.getvalue()


async def member_statement(db: AsyncSession, rules: Rules, m: CoopMember, user: User, year: int) -> dict:
    lo = datetime(year, 1, 1, tzinfo=timezone.utc)
    hi = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    prior = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
        CoopJournal.member_id == m.id, CoopJournal.ledger == "contribution", CoopJournal.effective_at < lo))).scalar_one())
    es = (await db.execute(select(CoopJournal).where(CoopJournal.member_id == m.id, CoopJournal.ledger == "contribution",
                                                     CoopJournal.effective_at >= lo, CoopJournal.effective_at < hi).order_by(CoopJournal.id))).scalars().all()
    loans = (await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id).order_by(CoopLoan.created_at))).scalars().all()
    divs = await member_dividends(db, rules, m)
    return {"name": user.full_name, "card_no": m.card_no, "year": year, "opening_kobo": prior,
            "entries": [{"date": e.effective_at.date().isoformat(), "type": e.entry_type, "delta_kobo": e.delta_kobo, "balance_kobo": e.balance_after, "note": e.note} for e in es],
            "closing_kobo": prior + sum(e.delta_kobo for e in es),
            "loans": [{"loan_no": l.loan_no, "status": l.status, "principal_kobo": l.principal_kobo, "interest_kobo": l.interest_kobo,
                       "paid_kobo": l.principal_paid_kobo + l.interest_paid_kobo + l.charges_paid_kobo} for l in loans],
            "dividends": [{"year": d["year"], "total_kobo": d["total_kobo"]} for d in divs]}


def statement_pdf(st: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="Cooperative statement", leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    s = getSampleStyleSheet()
    k = lambda v: naira(int(v)).replace("₦", "NGN ")
    el = [Paragraph("MonieKing Cooperative statement", s["Title"]), Paragraph(f"{st['name']} · {st['card_no']} · {st['year']}", s["Heading3"]), Spacer(1, 8),
          Paragraph(f"Opening balance: <b>{k(st['opening_kobo'])}</b> &nbsp;&nbsp; Closing balance: <b>{k(st['closing_kobo'])}</b>", s["Normal"]), Spacer(1, 8)]
    data = [["Date", "Entry", "Amount", "Balance"]] + [[e["date"], e["type"].replace("_", " "), k(e["delta_kobo"]), k(e["balance_kobo"])] for e in st["entries"]]
    t = Table(data, colWidths=[80, 200, 120, 120], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f5132")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                           ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
    el += [t]
    if st["loans"]:
        el += [Spacer(1, 12), Paragraph("Loans", s["Heading3"])]
        lt = Table([["Loan", "Status", "Principal", "Interest", "Paid so far"]] + [[l["loan_no"], l["status"].replace("_", " "), k(l["principal_kobo"]), k(l["interest_kobo"]), k(l["paid_kobo"])] for l in st["loans"]],
                   colWidths=[70, 130, 100, 100, 100])
        lt.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.lightgrey), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]))
        el += [lt]
    if st["dividends"]:
        el += [Spacer(1, 12), Paragraph("Dividends: " + ", ".join(f"{d['year']}: {k(d['total_kobo'])}" for d in st["dividends"]), s["Normal"])]
    doc.build(el)
    return buf.getvalue()
