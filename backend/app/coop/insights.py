"""Read-side: member profiles, guarantor pool, transparency, dividend estimate, director overview."""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import ledger, logic
from app.coop.errors import CoopError
from app.coop.models import CoopGuarantee, CoopJournal, CoopLoan, CoopMember
from app.coop.service import ACTIVE_LOAN, LIVE_INVITE, naira, position
from app.coop.settings_store import Rules
from app.models.user import User, UserRole


def wa_link(phone: str, text: str = "Hello, I found you on the MonieKing guarantors' pool.") -> str:
    p = "".join(c for c in (phone or "") if c.isdigit())
    if p.startswith("0"):
        p = "234" + p[1:]
    from urllib.parse import quote
    return f"https://wa.me/{p}?text={quote(text)}"


async def stats(db: AsyncSession, rules: Rules, m: CoopMember) -> dict:
    today = rules.today()
    loans = (await db.execute(select(CoopLoan).where(CoopLoan.member_id == m.id, CoopLoan.status.in_(("repaying", "repaid"))))).scalars().all()
    reached = on_time = 0
    for l in loans:
        if l.status == "repaid":
            reached += 1
            if l.closed_at and l.due_date and (l.closed_at.date() <= l.due_date + timedelta(days=l.overdue_grace_days)):
                on_time += 1
        elif l.due_date and today > l.due_date + timedelta(days=l.overdue_grace_days):
            reached += 1
    g_active = await _guarantee_stats(db, m.id)
    contrib = await ledger.balance(db, m.id, "contribution")
    locked = await ledger.balance(db, m.id, "locked")
    rel = logic.reliability_pct(on_time, reached, int(rules.get("reliability_min_history")))
    return {"member_since": m.registered_at.date().isoformat(), "months_member": round((rules.now() - m.registered_at).days / 30.4, 1),
            "loans_taken": len(loans), "loans_repaid": sum(1 for l in loans if l.status == "repaid"),
            "reliability_pct": rel, "has_history": rel is not None,
            "guarantees_active": g_active["active"], "guarantees_total": g_active["total"],
            "guaranteed_active_kobo": g_active["active_kobo"],
            "contribution_kobo": contrib, "locked_kobo": locked, "free_kobo": contrib - locked}


async def _guarantee_stats(db: AsyncSession, member_id) -> dict:
    rows = (await db.execute(select(CoopGuarantee.status, CoopLoan.status, CoopGuarantee.amount_kobo)
                             .join(CoopLoan, CoopLoan.id == CoopGuarantee.loan_id).where(CoopGuarantee.guarantor_id == member_id))).all()
    total = sum(1 for g, l, a in rows if g in ("signed", "released"))
    act = [a for g, l, a in rows if g == "signed" and l in ("awaiting_approval", "repaying")]
    return {"total": total, "active": len(act), "active_kobo": sum(act)}


async def _related(db: AsyncSession, viewer: Optional[CoopMember], target: CoopMember) -> bool:
    """Viewer holds a live/signed guarantee request on a loan of the target (borrower)."""
    if not viewer:
        return False
    q = select(func.count()).select_from(CoopGuarantee).join(CoopLoan, CoopLoan.id == CoopGuarantee.loan_id).where(
        CoopGuarantee.guarantor_id == viewer.id, CoopLoan.member_id == target.id,
        CoopGuarantee.status.in_(("invited", "viewed", "signed")), CoopLoan.status.in_(ACTIVE_LOAN))
    return (await db.execute(q)).scalar_one() > 0


async def profile(db: AsyncSession, rules: Rules, viewer_user: User, viewer: Optional[CoopMember], target: CoopMember) -> dict:
    is_dir = viewer_user.role in (UserRole.DIRECTOR, UserRole.ADMIN)
    is_self = viewer is not None and viewer.id == target.id
    related = await _related(db, viewer, target)
    if not (is_dir or is_self or related or (target.pool_listed and viewer is not None)):
        raise CoopError("You cannot view this profile", 403)
    tu = await db.get(User, target.user_id)
    s = await stats(db, rules, target)
    out = {"member_id": str(target.id), "name": tu.full_name, "card_no": target.card_no, "status": target.status,
           "member_since": s["member_since"], "months_member": s["months_member"], "loans_taken": s["loans_taken"],
           "loans_repaid": s["loans_repaid"], "reliability_pct": s["reliability_pct"], "has_history": s["has_history"],
           "guarantees_active": s["guarantees_active"], "guarantees_total": s["guarantees_total"],
           "pool_listed": target.pool_listed, "pool_offer_kobo": target.pool_offer_kobo, "pool_note": target.pool_note,
           "nin_linked": bool(tu.nin_linked), "you_are": "self" if is_self else ("director" if is_dir else ("guarantor" if related else "member"))}
    if is_self or is_dir or related:
        out["private"] = {"phone": tu.phone_number, "state": tu.state_of_residence, "contribution_kobo": s["contribution_kobo"],
                          "locked_kobo": s["locked_kobo"], "free_kobo": s["free_kobo"], "history": await contribution_history(db, target.id, 30)}
    if target.pool_listed and target.pool_whatsapp_ok and not is_self:
        out["whatsapp_link"] = wa_link(tu.phone_number)
    return out


async def contribution_history(db: AsyncSession, member_id, limit: int = 30) -> list[dict]:
    rows = (await db.execute(select(CoopJournal).where(CoopJournal.member_id == member_id, CoopJournal.ledger == "contribution")
                             .order_by(CoopJournal.id.desc()).limit(limit))).scalars().all()
    return [{"date": r.effective_at.date().isoformat(), "type": r.entry_type, "delta_kobo": r.delta_kobo, "balance_kobo": r.balance_after} for r in rows]


async def pool_list(db: AsyncSession, rules: Rules, viewer: CoopMember) -> list[dict]:
    ms = (await db.execute(select(CoopMember).where(CoopMember.pool_listed.is_(True), CoopMember.status == "active", CoopMember.id != viewer.id))).scalars().all()
    out = []
    for m in ms:
        u = await db.get(User, m.user_id)
        if u.role != UserRole.CUSTOMER:
            continue
        s = await stats(db, rules, m)
        free = s["free_kobo"]
        avail = min(m.pool_offer_kobo, free) if m.pool_offer_kobo else free
        out.append({"member_id": str(m.id), "name": u.full_name, "card_no": m.card_no, "months_member": s["months_member"],
                    "offer_kobo": m.pool_offer_kobo, "available_kobo": max(avail, 0), "reliability_pct": s["reliability_pct"],
                    "has_history": s["has_history"], "guarantees_active": s["guarantees_active"], "guarantees_total": s["guarantees_total"],
                    "loans_taken": s["loans_taken"], "note": m.pool_note, "whatsapp_link": wa_link(u.phone_number) if m.pool_whatsapp_ok else None})
    out.sort(key=lambda r: (-r["available_kobo"], r["name"]))
    return out


# ── transparency ──────────────────────────────────────────────────────────
async def transparency(db: AsyncSession, rules: Rules, start: date, end: date) -> dict:
    if end < start:
        raise CoopError("The end date is before the start date")
    if (end - start).days > 800:
        raise CoopError("Please choose a range of under 800 days")
    lo = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    hi = datetime(end.year, end.month, end.day, tzinfo=timezone.utc) + timedelta(days=1)
    rows = (await db.execute(select(CoopJournal.effective_at, CoopJournal.entry_type, CoopJournal.delta_kobo).where(
        CoopJournal.ledger == "contribution", CoopJournal.effective_at >= lo, CoopJournal.effective_at < hi))).all()
    days = defaultdict(lambda: {"in": 0, "out": 0})
    for at, et, d in rows:
        k = at.date().isoformat()
        if d > 0:
            days[k]["in"] += d
        else:
            days[k]["out"] += -d
    series, d = [], start
    while d <= end:
        v = days[d.isoformat()]
        series.append({"date": d.isoformat(), "contributed_kobo": v["in"], "withdrawn_kobo": v["out"]})
        d += timedelta(days=1)
    total_in = sum(s["contributed_kobo"] for s in series)
    total_out = sum(s["withdrawn_kobo"] for s in series)
    year = logic.accounting_year(rules.today())
    pool = await ledger.pool_total(db, year)
    cp, gp = logic.split_pool(pool, int(rules.get("dividend_contribution_pct")))
    all_contrib = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(CoopJournal.ledger == "contribution"))).scalar_one())
    members = (await db.execute(select(func.count()).select_from(CoopMember).where(CoopMember.status == "active"))).scalar_one()
    interest = _sum(await _ledger_year(db, "pool_interest", year)) + _sum(await _ledger_year(db, "running_cost", year))
    run_cost = _sum(await _ledger_year(db, "running_cost", year))
    loans = (await db.execute(select(CoopLoan).where(CoopLoan.status == "repaying"))).scalars().all()
    out_kobo = sum(l.principal_kobo - l.principal_paid_kobo for l in loans)
    uncollected = sum(position(l, rules.today())["charges_due_kobo"] for l in loans)
    return {"range": {"start": start.isoformat(), "end": end.isoformat()}, "series": series,
            "range_totals": {"contributed_kobo": total_in, "withdrawn_kobo": total_out, "net_kobo": total_in - total_out},
            "cooperative": {"members": members, "total_contributions_kobo": all_contrib, "loans_outstanding_kobo": out_kobo,
                            "loans_active": len(loans)},
            "profit": {"year": year, "interest_realised_kobo": interest, "running_cost_kobo": run_cost,
                       "overdue_charges_received_kobo": _sum(await _ledger_year(db, "pool_overdue", year)),
                       "withdrawal_charges_kobo": _sum(await _ledger_year(db, "pool_withdrawal", year)),
                       "dividend_pool_kobo": pool, "contribution_share_kobo": cp, "guarantee_share_kobo": gp,
                       "contribution_pct": int(rules.get("dividend_contribution_pct")), "guarantee_pct": int(rules.get("dividend_guarantee_pct")),
                       "overdue_charges_accrued_uncollected_kobo": uncollected,
                       "note": "Only money actually received counts toward the dividend pool. Accrued overdue charges are shown separately."}}


def _sum(rows) -> int:
    return int(sum(rows))


async def _ledger_year(db, ledger_name: str, year: int) -> list[int]:
    r = await db.execute(select(CoopJournal.delta_kobo).where(CoopJournal.ledger == ledger_name, CoopJournal.accounting_year == year))
    return [x for (x,) in r.all()]


# ── dividend estimate ─────────────────────────────────────────────────────
async def _weights(db: AsyncSession, rules: Rules, extra: dict | None = None) -> dict:
    """
    Time-weighted weights, projected to year end on the basis that nothing else changes.
    contribution weight = sum over days of the member's contribution balance
    guarantee weight    = locked amount x days, stopping from the overdue date of that loan
    """
    today = rules.today()
    year = logic.accounting_year(today)
    ys, ye = logic.year_bounds(year, int(rules.get("year_end_month")), int(rules.get("year_end_day")))
    horizon = max(min(ye, ye), ys)
    members = (await db.execute(select(CoopMember))).scalars().all()
    ev = (await db.execute(select(CoopJournal.member_id, CoopJournal.effective_at, CoopJournal.delta_kobo).where(
        CoopJournal.ledger == "contribution").order_by(CoopJournal.id))).all()
    per = defaultdict(list)
    for mid, at, d in ev:
        per[mid].append((at.date(), d))
    cw, gw, bal = {}, {}, {}
    for m in members:
        events = per.get(m.id, [])
        b = 0
        w = 0
        cursor = ys
        for d, delta in events:
            # integrate up to min(day, today) with the balance before this event
            seg_end = min(max(d, ys), today)
            if seg_end > cursor:
                w += b * (seg_end - cursor).days
                cursor = seg_end
            b += delta
        if today > cursor:
            w += b * (today - cursor).days
        remaining = max((horizon - max(today, ys)).days, 0)
        w += b * remaining  # projection
        cw[m.id], bal[m.id] = w, b
    gs = (await db.execute(select(CoopGuarantee, CoopLoan).join(CoopLoan, CoopLoan.id == CoopGuarantee.loan_id).where(
        CoopGuarantee.signed_at.is_not(None)))).all()
    for g, l in gs:
        s = max(g.signed_at.date(), ys)
        stop_dates = [horizon]
        if g.released_at:
            stop_dates.append(g.released_at.date())
        if l.due_date:
            stop_dates.append(l.due_date + timedelta(days=1 + l.overdue_grace_days))
        e = min(stop_dates)
        if e > s:
            gw[g.guarantor_id] = gw.get(g.guarantor_id, 0) + g.amount_kobo * (e - s).days
    return {"cw": cw, "gw": gw, "bal": bal, "members": {m.id: m for m in members}, "year": year, "ys": ys, "ye": ye, "today": today}


async def dividend(db: AsyncSession, rules: Rules, me: Optional[CoopMember], extra_kobo: int = 0, all_members: bool = False) -> dict:
    W = await _weights(db, rules)
    year, today = W["year"], W["today"]
    pool = await ledger.pool_total(db, year)
    cp, gp = logic.split_pool(pool, int(rules.get("dividend_contribution_pct")))
    qualified, reasons = {}, {}
    for mid, m in W["members"].items():
        months = (rules.now() - m.registered_at).days / 30.4
        ok, why = logic.qualifies(W["bal"].get(mid, 0), months, int(rules.get("dividend_min_balance_kobo")), int(rules.get("dividend_min_months")),
                                  m.disqualified_year == year, m.status == "active")
        qualified[mid], reasons[mid] = ok, why
    remaining = max((W["ye"] - today).days, 0)

    def shares(extra_for: Optional[uuid.UUID], extra: int):
        cws = {k: v for k, v in W["cw"].items() if qualified.get(k) and v > 0}
        if extra_for and qualified.get(extra_for):
            cws[extra_for] = cws.get(extra_for, 0) + extra * remaining
        gws = {k: v for k, v in W["gw"].items() if qualified.get(k) and v > 0}
        return logic.largest_remainder(cp, cws), logic.largest_remainder(gp, gws), cws, gws

    c_sh, g_sh, cws, gws = shares(None, 0)
    out = {"year": year, "pool_kobo": pool, "contribution_pool_kobo": cp, "guarantee_pool_kobo": gp,
           "contribution_pct": int(rules.get("dividend_contribution_pct")), "guarantee_pct": int(rules.get("dividend_guarantee_pct")),
           "year_end": (W["ye"] - timedelta(days=1)).isoformat(), "days_left": remaining, "qualified_members": sum(1 for v in qualified.values() if v),
           "basis": "If every balance and guarantee stays as it is today until the year end. An estimate only, not a promise. A dividend needs accountant preparation and director approval.",
           "pool_note": "Only money actually received is in the pool. Accrued overdue charges are not counted until paid."}
    if me:
        c_me, g_me = c_sh.get(me.id, 0), g_sh.get(me.id, 0)
        out["me"] = {"qualifies": qualified.get(me.id, False), "reason": reasons.get(me.id, ""), "contribution_share_kobo": c_me,
                     "guarantee_share_kobo": g_me, "total_kobo": c_me + g_me,
                     "contribution_weight_pct": round(100 * cws.get(me.id, 0) / max(sum(cws.values()), 1), 2),
                     "guarantee_weight_pct": round(100 * gws.get(me.id, 0) / max(sum(gws.values()), 1), 2),
                     "balance_kobo": W["bal"].get(me.id, 0)}
        if extra_kobo > 0:
            c2, g2, _, _ = shares(me.id, extra_kobo)
            t2 = c2.get(me.id, 0) + g2.get(me.id, 0)
            out["me"]["with_extra"] = {"extra_kobo": extra_kobo, "total_kobo": t2, "gain_kobo": t2 - (c_me + g_me),
                                       "qualifies": qualified.get(me.id, False)}
    if all_members:
        rows = []
        for mid, m in W["members"].items():
            u = await db.get(User, m.user_id)
            rows.append({"member_id": str(mid), "name": u.full_name, "card_no": m.card_no, "balance_kobo": W["bal"].get(mid, 0),
                         "qualifies": qualified[mid], "reason": reasons[mid], "contribution_share_kobo": c_sh.get(mid, 0),
                         "guarantee_share_kobo": g_sh.get(mid, 0), "total_kobo": c_sh.get(mid, 0) + g_sh.get(mid, 0)})
        rows.sort(key=lambda r: -r["total_kobo"])
        out["members"] = rows
        out["paid_out_check_kobo"] = sum(r["total_kobo"] for r in rows)
    return out


# ── director overview + reconciliation ────────────────────────────────────
async def reconciliation(db: AsyncSession) -> list[dict]:
    checks = []
    # 1 locked == sum of signed guarantees on open loans
    locked = await ledger_total(db, "locked")
    g_open = int((await db.execute(select(func.coalesce(func.sum(CoopGuarantee.amount_kobo), 0)).where(CoopGuarantee.status == "signed"))).scalar_one())
    checks.append({"name": "Locked money equals signed guarantees", "ok": locked == g_open, "detail": f"{naira(locked)} locked, {naira(g_open)} in signed guarantees"})
    # 2 nobody has negative free funds
    neg = 0
    for (mid,) in (await db.execute(select(CoopMember.id))).all():
        if await ledger.free_funds(db, mid) < 0:
            neg += 1
    checks.append({"name": "No member has negative free funds", "ok": neg == 0, "detail": f"{neg} member(s) with a problem"})
    # 3 loan paid totals match journal
    bad = 0
    for l in (await db.execute(select(CoopLoan))).scalars().all():
        jp = int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(
            CoopJournal.loan_id == l.id, CoopJournal.ledger == "loan_repaid"))).scalar_one())
        if jp != l.principal_paid_kobo + l.interest_paid_kobo + l.charges_paid_kobo or l.principal_paid_kobo > l.principal_kobo or l.interest_paid_kobo > l.interest_kobo:
            bad += 1
    checks.append({"name": "Every loan's repayments match the money book", "ok": bad == 0, "detail": f"{bad} loan(s) out of balance"})
    # 4 pool == interest (net of running cost) + charges recorded
    pi, rc, po = await ledger_total(db, "pool_interest"), await ledger_total(db, "running_cost"), await ledger_total(db, "loan_repaid")
    paid_int = int((await db.execute(select(func.coalesce(func.sum(CoopLoan.interest_paid_kobo), 0)))).scalar_one())
    checks.append({"name": "Interest received equals pool plus running cost", "ok": pi + rc == paid_int, "detail": f"{naira(paid_int)} received, {naira(pi)} to pool, {naira(rc)} running cost"})
    # 5 no repaid loan still has locked guarantees
    stuck = int((await db.execute(select(func.count()).select_from(CoopGuarantee).join(CoopLoan, CoopLoan.id == CoopGuarantee.loan_id).where(
        CoopGuarantee.status == "signed", CoopLoan.status.in_(("repaid", "rejected", "cancelled", "expired"))))).scalar_one())
    checks.append({"name": "Closed loans have no locked guarantees", "ok": stuck == 0, "detail": f"{stuck} stuck guarantee(s)"})
    return checks


async def ledger_total(db: AsyncSession, name: str) -> int:
    return int((await db.execute(select(func.coalesce(func.sum(CoopJournal.delta_kobo), 0)).where(CoopJournal.ledger == name))).scalar_one())
