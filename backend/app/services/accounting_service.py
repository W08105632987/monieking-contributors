"""Accounting Center numbers. Every figure is labelled with where it came from:
  measured : read straight from a record (e.g. what Monnify's webhook told us it charged)
  rate     : events counted from our records x the price a director typed in (effective-dated)
  missing  : events happened but no price has been typed in, so the cost is shown as 0 and flagged
Nothing about a provider's price is hard-coded."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import AccountingSettings, CostRate
from app.verification import constants as VC

WAT = timezone(timedelta(hours=1))   # Nigeria time: a "day" runs midnight to midnight here


def day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    """Inclusive dates -> [start, end) instants in Nigeria time."""
    s = datetime(start.year, start.month, start.day, tzinfo=WAT)
    e = datetime(end.year, end.month, end.day, tzinfo=WAT) + timedelta(days=1)
    return s, e


# ── rate catalogue ─────────────────────────────────────────────────────────
def _techhub_keys() -> list[dict]:
    out = []
    names = {"nin": "NIN lookup", "phone": "NIN by phone", "demographic": "NIN by name and date of birth", "bvn": "BVN lookup"}
    for (method, tier) in VC.ENDPOINTS:
        out.append({"key": f"techhub.{method}.{tier}", "label": f"{names.get(method, method)} - {tier}", "provider": "Techhub", "group": "Techhub", "mode": "flat",
                    "hint": "What Techhub charges us for one successful check."})
    for tier in ("regular", "standard", "premium"):
        out.append({"key": f"techhub.slip.{tier}", "label": f"Slip - {tier}", "provider": "Techhub", "group": "Techhub", "mode": "flat",
                    "hint": "What Techhub charges us for one slip."})
    return out


STATIC_RATES: list[dict] = [
    {"key": "monnify.funding", "label": "Wallet funding (only used when Monnify's webhook gives no fee)", "provider": "Monnify", "group": "Monnify", "mode": "percent",
     "hint": "Percent of the amount received, with an optional cap. Used only for fundings where Monnify did not report its fee."},
    {"key": "payout.transfer", "label": "Withdrawal payout to a bank", "provider": "Bank / Monnify", "group": "Monnify", "mode": "flat",
     "hint": "What it costs us to send one withdrawal to the customer's bank. Leave at 0 if it is free."},
    {"key": "termii.sms", "label": "SMS (per message segment)", "provider": "Termii", "group": "Termii", "mode": "flat",
     "hint": "What Termii charges us for one SMS segment (160 characters, or 70 with emoji)."},
]


async def catalog(db: AsyncSession) -> list[dict]:
    items = _techhub_keys() + STATIC_RATES
    rows = (await db.execute(text("SELECT code, name FROM identity_services ORDER BY name"))).all()
    for code, name in rows:
        items.append({"key": f"identity.{code}", "label": name, "provider": "Provider for this service", "group": "Identity services", "mode": "flat",
                      "hint": "What the provider charges us each time a customer uses this service."})
    return items


async def _all_rates(db: AsyncSession) -> dict[str, list[CostRate]]:
    rows = (await db.execute(select(CostRate).order_by(CostRate.rate_key, CostRate.effective_from, CostRate.created_at))).scalars().all()
    out: dict[str, list[CostRate]] = {}
    for r in rows:
        out.setdefault(r.rate_key, []).append(r)
    return out


def _segments(rates: list[CostRate], start: datetime, end: datetime):
    """Split [start,end) at each price change. Parts before the first price have rate None."""
    if not rates:
        return [(start, end, None)]
    out = []
    # The FIRST price a director ever types applies to all earlier history too (there is no older price to use);
    # every later change applies only from its own date.
    for i, r in enumerate(rates):
        nxt = rates[i + 1].effective_from if i + 1 < len(rates) else end
        s, e = (start if i == 0 else max(start, r.effective_from)), min(end, nxt)
        if s < e:
            out.append((s, e, r))
    return [x for x in out if x[0] < x[1]]


def cost_sql(rate: CostRate, amount_col: str, mult_col: str | None) -> str:
    """SQL expression for the cost of ONE row at this rate (kobo). Numbers come from our own table, never from a request."""
    v = Decimal(rate.value)
    if rate.mode == "percent":
        e = f"ROUND({amount_col} * {v} / 100.0)"
        if rate.cap_kobo:
            e = f"LEAST({e}, {int(rate.cap_kobo)})"
        return e
    kobo = v * 100
    return f"({kobo} * {mult_col})" if mult_col else f"({kobo})"


async def _priced(db, rates, key, start, end, frm, ts, where="TRUE", amount="0", mult=None):
    """(cost_kobo, events, unpriced_events) for rows of `frm` in the period."""
    cost = events = unpriced = 0
    count_expr = f"COALESCE(SUM({mult}), 0)" if mult else "COUNT(*)"
    for s, e, r in _segments(rates.get(key, []), start, end):
        sel = cost_sql(r, amount, mult) if r else "0"
        q = text(f"SELECT {count_expr}, COALESCE(SUM({sel}), 0) FROM {frm} WHERE {ts} >= :s AND {ts} < :e AND {where}")
        n, c = (await db.execute(q, {"s": s, "e": e})).one()
        events += int(n)
        if r is None:
            unpriced += int(n)
        else:
            cost += int(c)
    return cost, events, unpriced


async def _one(db, sql, **p):
    return (await db.execute(text(sql), p)).one()


def _row(key, label, group, revenue, cost, count, volume=0, source="rate", unpriced=0, rate_keys=None, note=None):
    if unpriced:
        source = "missing" if source == "rate" else source
    return {"key": key, "label": label, "group": group, "count": int(count), "volume_kobo": int(volume), "revenue_kobo": int(revenue), "cost_kobo": int(cost),
            "margin_kobo": int(revenue) - int(cost), "cost_source": source, "unpriced_events": int(unpriced), "rate_keys": rate_keys or [], "note": note}


async def service_rows(db: AsyncSession, start: datetime, end: datetime, rates: dict | None = None) -> list[dict]:
    rates = rates if rates is not None else await _all_rates(db)
    P = {"s": start, "e": end}
    rows: list[dict] = []

    # Wallet funding: revenue = what we charged the customer; cost = what Monnify reported, else the director's rate.
    n, vol, rev, measured = await _one(db, "SELECT COUNT(*), COALESCE(SUM(gross_kobo),0), COALESCE(SUM(customer_fee_kobo),0), COALESCE(SUM(monnify_fee_kobo),0) FROM funding_records WHERE created_at >= :s AND created_at < :e", **P)
    c2, _, un = await _priced(db, rates, "monnify.funding", start, end, "funding_records", "created_at", "monnify_fee_kobo IS NULL", "gross_kobo")
    src = "measured" if not un and c2 == 0 else ("missing" if un else "measured + rate")
    rows.append(_row("funding", "Wallet funding", "Funding", rev, int(measured) + c2, n, vol, src, un, ["monnify.funding"],
                     "Monnify's own reported fee is used whenever the webhook gives it."))

    # Withdrawals paid out (SMS portion is shown under SMS).
    n, vol, rev = await _one(db, "SELECT COUNT(*), COALESCE(SUM(requested_amount_kobo),0), COALESCE(SUM(charge_kobo - sms_charge_kobo),0) FROM withdrawals WHERE status = 'paid' AND processed_at >= :s AND processed_at < :e", **P)
    c, _, un = await _priced(db, rates, "payout.transfer", start, end, "withdrawals", "processed_at", "status = 'paid'", "net_payable_kobo")
    rows.append(_row("withdrawals", "Withdrawal charges", "Withdrawals", rev, c, n, vol, "rate" if (rates.get("payout.transfer") or n == 0) else "missing", un, ["payout.transfer"]))

    # SMS
    n_sms_rev, rev_w = await _one(db, "SELECT COALESCE(SUM(amount_kobo),0), 0 FROM wallet_transactions WHERE category = 'sms_fee' AND type = 'debit' AND created_at >= :s AND created_at < :e", **P)
    (rev_wd,) = await _one(db, "SELECT COALESCE(SUM(sms_charge_kobo),0) FROM withdrawals WHERE status = 'paid' AND processed_at >= :s AND processed_at < :e", **P)
    c, units, un = await _priced(db, rates, "termii.sms", start, end, "provider_usage", "created_at", "rate_key = 'termii.sms' AND ok", None, "quantity")
    rows.append(_row("sms", "SMS alerts", "SMS", int(n_sms_rev) + int(rev_wd), c, units, 0, "rate", un, ["termii.sms"],
                     "Revenue = SMS fees taken from wallets and withdrawals. Cost counts only messages sent after this feature went live."))

    # Bills, one row per category. Monnify does NOT charge us for airtime, data or bills: we EARN from them.
    # Profit on a completed payment = our markup (what the customer paid above the face value, set on the Prices & profit
    # page) + the commission Monnify pays us. Same numbers the Prices & profit page shows, so the two always agree.
    for cat, label in (("airtime", "Airtime"), ("data", "Data"), ("electricity", "Electricity"), ("cable_tv", "Cable TV"), ("education", "Education")):
        frm = "bill_payment_requests r JOIN billers b ON b.id = r.biller_id"
        where = f"r.status = 'completed' AND b.category = '{cat}' AND r.completed_at >= :s AND r.completed_at < :e"
        n, vol, markup, commission = await _one(
            db, f"SELECT COUNT(*), COALESCE(SUM(r.amount_kobo),0), COALESCE(SUM(r.markup_kobo),0), COALESCE(SUM(r.commission_kobo),0) FROM {frm} WHERE {where}", **P)
        row = _row(f"bill_{cat}", f"{label} bills", "Bills", int(markup) + int(commission), 0, n, vol, "commission", 0, [],
                   "We earn this: our markup plus the commission Monnify pays us. Monnify does not charge us for it.")
        row["markup_kobo"], row["commission_kobo"] = int(markup), int(commission)
        rows.append(row)

    # Identity services (revenue = what the customer paid).
    for code, name in (await db.execute(text("SELECT code, name FROM identity_services ORDER BY name"))).all():
        frm = "identity_service_requests r JOIN identity_services s ON s.id = r.service_id"
        where = f"r.status = 'completed' AND s.code = '{code.replace(chr(39), '')}'"
        n, rev = await _one(db, f"SELECT COUNT(*), COALESCE(SUM(r.amount_charged_kobo),0) FROM {frm} WHERE {where} AND r.completed_at >= :s AND r.completed_at < :e", **P)
        key = f"identity.{code}"
        c, _, un = await _priced(db, rates, key, start, end, frm, "r.completed_at", where)
        if n or rates.get(key):
            rows.append(_row(f"identity_{code}", name, "Identity services", rev, c, n, 0, "rate", un, [key]))

    # Techhub verification checks, per method and tier used.
    combos = (await db.execute(text("SELECT DISTINCT method, tier_used FROM verification_lookups WHERE status = 'found' AND created_at >= :s AND created_at < :e AND tier_used IS NOT NULL"), P)).all()
    for method, tier in combos:
        m, t = method.replace("'", ""), tier.replace("'", "")
        where = f"status = 'found' AND method = '{m}' AND tier_used = '{t}'"
        (rev,) = await _one(db, f"SELECT COALESCE(SUM(fee_kobo),0) FROM verification_lookups WHERE {where} AND created_at >= :s AND created_at < :e", **P)
        key = f"techhub.{m}.{t}"
        c, n, un = await _priced(db, rates, key, start, end, "verification_lookups", "created_at", where)
        rows.append(_row(f"techhub_{m}_{t}", f"Techhub {m.upper() if m in ('nin', 'bvn') else m} check - {t}", "Techhub", rev, c, n, 0, "rate", un, [key]))
    for tier in ("regular", "standard", "premium"):
        (n, rev) = await _one(db, "SELECT COUNT(*), COALESCE(SUM(price_kobo),0) FROM verification_slips WHERE tier = :t AND created_at >= :s AND created_at < :e", t=tier, **P)
        if n:
            key = f"techhub.slip.{tier}"
            c, _, un = await _priced(db, rates, key, start, end, "verification_slips", "created_at", f"tier = '{tier}'")
            rows.append(_row(f"techhub_slip_{tier}", f"Techhub slip - {tier}", "Techhub", rev, c, n, 0, "rate", un, [key]))

    # Manual (worker-handled) services: our cost is the worker's commission.
    n, rev, comm = await _one(db, "SELECT COUNT(*), COALESCE(SUM(price_kobo),0), COALESCE(SUM(CASE WHEN commission_status = 'reversed' THEN 0 ELSE worker_commission_kobo END),0) FROM manual_service_requests WHERE status = 'successful' AND completed_at >= :s AND completed_at < :e", **P)
    rows.append(_row("manual_services", "Worker-handled services", "Services", rev, comm, n, 0, "measured", 0, [], "Cost is the commission paid to workers (reversed commissions excluded)."))
    return rows


# ── multi-window versions ──────────────────────────────────────────────────
# The chart needs the same numbers as service_rows() for every bucket. Calling service_rows() once per bucket costs
# (queries per call) x (buckets) round trips. These helpers answer ALL windows at once with GROUP BY, so the query
# count does not depend on how many buckets there are. Windows must not overlap. The logic mirrors service_rows().
Window = tuple[datetime, datetime]


def _bucket_case(ts: str, windows: list[Window]) -> tuple[str, dict]:
    parts, p = [], {}
    for i, (ws, we) in enumerate(windows):
        p[f"ws{i}"], p[f"we{i}"] = ws, we
        parts.append(f"WHEN {ts} >= :ws{i} AND {ts} < :we{i} THEN {i}")
    return "CASE " + " ".join(parts) + " END", p


async def _grouped(db, windows: list[Window], ts: str, select: str, frm: str, where: str = "TRUE", keys: str = "", lo=None, hi=None, extra=None) -> list[tuple[int, tuple]]:
    """Run `SELECT <select> FROM frm WHERE ts in [lo,hi) AND where GROUP BY bucket[, keys]`.
    Returns [(window_index, (key cols..., select cols...)), ...]; rows that fall in no window are dropped."""
    case, p = _bucket_case(ts, windows)
    p["lo"] = lo if lo is not None else min(w[0] for w in windows)
    p["hi"] = hi if hi is not None else max(w[1] for w in windows)
    kc = f", {keys}" if keys else ""
    q = text(f"SELECT {case} AS b{kc}, {select} FROM {frm} WHERE {ts} >= :lo AND {ts} < :hi AND {where} GROUP BY 1{kc}")
    out = []
    for row in (await db.execute(q, {**p, **(extra or {})})).all():
        if row[0] is not None:
            out.append((int(row[0]), tuple(row[1:])))
    return out


async def _one_multi(db, windows, ts, select, frm, where="TRUE", width=1, extra=None) -> list[tuple]:
    """Per window, the aggregate columns of `select` (zeros for a window with no rows, like COUNT/COALESCE(SUM) over nothing)."""
    res = [(0,) * width for _ in windows]
    for i, vals in await _grouped(db, windows, ts, select, frm, where, extra=extra):
        res[i] = vals
    return res


async def _priced_multi(db, rates, key, windows, frm, ts, where="TRUE", amount="0", mult=None) -> list[tuple[int, int, int]]:
    """_priced() for every window: [(cost_kobo, events, unpriced_events), ...]. The price in force depends on each row's own
    timestamp, so splitting the whole span at price changes gives the same result as splitting each window."""
    res = [[0, 0, 0] for _ in windows]
    lo, hi = min(w[0] for w in windows), max(w[1] for w in windows)
    count_expr = f"COALESCE(SUM({mult}), 0)" if mult else "COUNT(*)"
    for s, e, r in _segments(rates.get(key, []), lo, hi):
        sel = cost_sql(r, amount, mult) if r else "0"
        for i, (n, c) in await _grouped(db, windows, ts, f"{count_expr}, COALESCE(SUM({sel}), 0)", frm, where, lo=s, hi=e):
            res[i][1] += int(n)
            if r is None:
                res[i][2] += int(n)
            else:
                res[i][0] += int(c)
    return [tuple(x) for x in res]


async def service_rows_multi(db: AsyncSession, windows: list[Window], rates: dict | None = None) -> list[list[dict]]:
    """service_rows() for each (start, end) window, in a fixed number of queries per service. Windows must be disjoint."""
    rates = rates if rates is not None else await _all_rates(db)
    W = len(windows)
    out: list[list[dict]] = [[] for _ in range(W)]

    fund = await _one_multi(db, windows, "created_at", "COUNT(*), COALESCE(SUM(gross_kobo),0), COALESCE(SUM(customer_fee_kobo),0), COALESCE(SUM(monnify_fee_kobo),0)", "funding_records", width=4)
    fund_p = await _priced_multi(db, rates, "monnify.funding", windows, "funding_records", "created_at", "monnify_fee_kobo IS NULL", "gross_kobo")
    for i in range(W):
        n, vol, rev, measured = fund[i]
        c2, _, un = fund_p[i]
        src = "measured" if not un and c2 == 0 else ("missing" if un else "measured + rate")
        out[i].append(_row("funding", "Wallet funding", "Funding", rev, int(measured) + c2, n, vol, src, un, ["monnify.funding"],
                           "Monnify's own reported fee is used whenever the webhook gives it."))

    wd = await _one_multi(db, windows, "processed_at", "COUNT(*), COALESCE(SUM(requested_amount_kobo),0), COALESCE(SUM(charge_kobo - sms_charge_kobo),0), COALESCE(SUM(sms_charge_kobo),0)", "withdrawals", "status = 'paid'", width=4)
    wd_p = await _priced_multi(db, rates, "payout.transfer", windows, "withdrawals", "processed_at", "status = 'paid'", "net_payable_kobo")
    for i in range(W):
        n, vol, rev, _sms = wd[i]
        c, _, un = wd_p[i]
        out[i].append(_row("withdrawals", "Withdrawal charges", "Withdrawals", rev, c, n, vol, "rate" if (rates.get("payout.transfer") or n == 0) else "missing", un, ["payout.transfer"]))

    sms_rev = await _one_multi(db, windows, "created_at", "COALESCE(SUM(amount_kobo),0)", "wallet_transactions", "category = 'sms_fee' AND type = 'debit'")
    sms_p = await _priced_multi(db, rates, "termii.sms", windows, "provider_usage", "created_at", "rate_key = 'termii.sms' AND ok", None, "quantity")
    for i in range(W):
        c, units, un = sms_p[i]
        out[i].append(_row("sms", "SMS alerts", "SMS", int(sms_rev[i][0]) + int(wd[i][3]), c, units, 0, "rate", un, ["termii.sms"],
                           "Revenue = SMS fees taken from wallets and withdrawals. Cost counts only messages sent after this feature went live."))

    # Bills: we EARN from them (our markup + the commission Monnify pays us); cost is zero. Mirrors service_rows().
    for cat, label in (("airtime", "Airtime"), ("data", "Data"), ("electricity", "Electricity"), ("cable_tv", "Cable TV"), ("education", "Education")):
        frm = "bill_payment_requests r JOIN billers b ON b.id = r.biller_id"
        where = f"r.status = 'completed' AND b.category = '{cat}'"
        agg = await _one_multi(db, windows, "r.completed_at", "COUNT(*), COALESCE(SUM(r.amount_kobo),0), COALESCE(SUM(r.markup_kobo),0), COALESCE(SUM(r.commission_kobo),0)", frm, where, width=4)
        for i in range(W):
            n, vol, markup, commission = agg[i]
            row = _row(f"bill_{cat}", f"{label} bills", "Bills", int(markup) + int(commission), 0, n, vol, "commission", 0, [],
                       "We earn this: our markup plus the commission Monnify pays us. Monnify does not charge us for it.")
            row["markup_kobo"], row["commission_kobo"] = int(markup), int(commission)
            out[i].append(row)

    for code, name in (await db.execute(text("SELECT code, name FROM identity_services ORDER BY name"))).all():
        frm = "identity_service_requests r JOIN identity_services s ON s.id = r.service_id"
        where = f"r.status = 'completed' AND s.code = '{code.replace(chr(39), '')}'"
        agg = await _one_multi(db, windows, "r.completed_at", "COUNT(*), COALESCE(SUM(r.amount_charged_kobo),0)", frm, where, width=2)
        key = f"identity.{code}"
        pr = await _priced_multi(db, rates, key, windows, frm, "r.completed_at", where)
        for i in range(W):
            n, rev = agg[i]
            if n or rates.get(key):
                out[i].append(_row(f"identity_{code}", name, "Identity services", rev, pr[i][0], n, 0, "rate", pr[i][2], [key]))

    # Techhub checks: one combo per (method, tier) that has a found lookup in that window.
    combos: dict[tuple[str, str], set[int]] = {}
    base = "status = 'found' AND tier_used IS NOT NULL"
    for i, vals in await _grouped(db, windows, "created_at", "COUNT(*)", "verification_lookups", base, keys="method, tier_used"):
        combos.setdefault((vals[0], vals[1]), set()).add(i)
    for method, tier in sorted(combos):
        m, t = method.replace("'", ""), tier.replace("'", "")
        where = f"status = 'found' AND method = '{m}' AND tier_used = '{t}'"
        rev = await _one_multi(db, windows, "created_at", "COALESCE(SUM(fee_kobo),0)", "verification_lookups", where)
        key = f"techhub.{m}.{t}"
        pr = await _priced_multi(db, rates, key, windows, "verification_lookups", "created_at", where)
        for i in sorted(combos[(method, tier)]):
            out[i].append(_row(f"techhub_{m}_{t}", f"Techhub {m.upper() if m in ('nin', 'bvn') else m} check - {t}", "Techhub", rev[i][0], pr[i][0], pr[i][1], 0, "rate", pr[i][2], [key]))
    for tier in ("regular", "standard", "premium"):
        agg = await _one_multi(db, windows, "created_at", "COUNT(*), COALESCE(SUM(price_kobo),0)", "verification_slips", f"tier = '{tier}'", width=2)
        if any(a[0] for a in agg):
            key = f"techhub.slip.{tier}"
            pr = await _priced_multi(db, rates, key, windows, "verification_slips", "created_at", f"tier = '{tier}'")
            for i in range(W):
                if agg[i][0]:
                    out[i].append(_row(f"techhub_slip_{tier}", f"Techhub slip - {tier}", "Techhub", agg[i][1], pr[i][0], agg[i][0], 0, "rate", pr[i][2], [key]))

    man = await _one_multi(db, windows, "completed_at", "COUNT(*), COALESCE(SUM(price_kobo),0), COALESCE(SUM(CASE WHEN commission_status = 'reversed' THEN 0 ELSE worker_commission_kobo END),0)", "manual_service_requests", "status = 'successful'", width=3)
    for i in range(W):
        n, rev, comm = man[i]
        out[i].append(_row("manual_services", "Worker-handled services", "Services", rev, comm, n, 0, "measured", 0, [], "Cost is the commission paid to workers (reversed commissions excluded)."))
    return out


async def expense_totals_multi(db: AsyncSession, ranges: list[tuple[date, date]]) -> list[int]:
    """expense_summary(...)['total_kobo'] for each inclusive date range (disjoint), in one query."""
    parts, p = [], {"lo": min(a for a, _ in ranges), "hi": max(b for _, b in ranges)}
    for i, (a, b) in enumerate(ranges):
        p[f"a{i}"], p[f"b{i}"] = a, b
        parts.append(f"WHEN spent_on >= :a{i} AND spent_on <= :b{i} THEN {i}")
    q = text(f"SELECT CASE {' '.join(parts)} END AS b, COALESCE(SUM(amount_kobo),0) FROM expenses WHERE spent_on >= :lo AND spent_on <= :hi GROUP BY 1")
    res = [0] * len(ranges)
    for b, tot in (await db.execute(q, p)).all():
        if b is not None:
            res[int(b)] += int(tot)
    return res


async def income_totals_multi(db: AsyncSession, ranges: list[tuple[date, date]]) -> list[int]:
    """income_summary(...)['total_kobo'] for each inclusive date range (disjoint), in one query."""
    parts, p = [], {"lo": min(a for a, _ in ranges), "hi": max(b for _, b in ranges)}
    for i, (a, b) in enumerate(ranges):
        p[f"a{i}"], p[f"b{i}"] = a, b
        parts.append(f"WHEN earned_on >= :a{i} AND earned_on <= :b{i} THEN {i}")
    q = text(f"SELECT CASE {' '.join(parts)} END AS b, COALESCE(SUM(amount_kobo),0) FROM external_income WHERE earned_on >= :lo AND earned_on <= :hi GROUP BY 1")
    res = [0] * len(ranges)
    for b, tot in (await db.execute(q, p)).all():
        if b is not None:
            res[int(b)] += int(tot)
    return res


async def expense_summary(db: AsyncSession, start: date, end: date) -> dict:
    rows = (await db.execute(text("SELECT category, COALESCE(SUM(amount_kobo),0), COUNT(*) FROM expenses WHERE spent_on >= :a AND spent_on <= :b GROUP BY category ORDER BY 2 DESC"), {"a": start, "b": end})).all()
    return {"total_kobo": sum(int(r[1]) for r in rows), "by_category": [{"category": r[0], "total_kobo": int(r[1]), "count": int(r[2])} for r in rows]}


async def income_summary(db: AsyncSession, start: date, end: date) -> dict:
    """Money earned OUTSIDE the app (other businesses, one-off deals). Added by the director, shown beside expenses."""
    rows = (await db.execute(text("SELECT source, COALESCE(SUM(amount_kobo),0), COUNT(*) FROM external_income WHERE earned_on >= :a AND earned_on <= :b GROUP BY source ORDER BY 2 DESC"), {"a": start, "b": end})).all()
    return {"total_kobo": sum(int(r[1]) for r in rows), "by_source": [{"source": r[0], "total_kobo": int(r[1]), "count": int(r[2])} for r in rows]}


def _totals(rows: list[dict], expenses_kobo: int, other_income_kobo: int = 0) -> dict:
    rev = sum(r["revenue_kobo"] for r in rows)
    cost = sum(r["cost_kobo"] for r in rows)
    return {"revenue_kobo": rev, "provider_cost_kobo": cost, "gross_profit_kobo": rev - cost, "expenses_kobo": expenses_kobo,
            "other_income_kobo": other_income_kobo, "net_profit_kobo": rev - cost - expenses_kobo + other_income_kobo}


def _buckets(start: date, end: date) -> list[tuple[str, date, date]]:
    span = (end - start).days + 1
    out = []
    if span <= 14:
        d = start
        while d <= end:
            out.append((d.strftime("%d %b"), d, d)); d += timedelta(days=1)
    elif span <= 90:
        d = start
        while d <= end:
            e = min(d + timedelta(days=6), end)
            out.append((f"{d.strftime('%d %b')}", d, e)); d = e + timedelta(days=1)
    else:
        d = date(start.year, start.month, 1)
        while d <= end:
            nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
            out.append((d.strftime("%b %Y"), max(d, start), min(nxt - timedelta(days=1), end))); d = nxt
        out = out[-12:]
    return out


async def report(db: AsyncSession, start: date, end: date, series: bool = True, series_only: bool = False) -> dict:
    """series=False: totals and per-service rows only. series_only=True: just the chart points (cheap to fetch after the totals)."""
    rates = await _all_rates(db)
    out = {"start": start.isoformat(), "end": end.isoformat()}
    if not series_only:
        s, e = day_bounds(start, end)
        rows = (await service_rows_multi(db, [(s, e)], rates))[0]
        exp = await expense_summary(db, start, end)
        inc = await income_summary(db, start, end)
        warnings = []
        for r in rows:
            if r["unpriced_events"]:
                warnings.append({"key": r["key"], "label": r["label"], "events": r["unpriced_events"], "rate_keys": r["rate_keys"]})
        out.update({"totals": _totals(rows, exp["total_kobo"], inc["total_kobo"]), "services": rows, "expenses": exp, "other_income": inc, "warnings": warnings})
    if series or series_only:
        buckets = _buckets(start, end)
        ranges = [(a, b) for _, a, b in buckets]
        brows = await service_rows_multi(db, [day_bounds(a, b) for _, a, b in buckets], rates)
        bexp = await expense_totals_multi(db, ranges)
        binc = await income_totals_multi(db, ranges)
        out["series"] = [{"label": label, "start": a.isoformat(), "end": b.isoformat(), **_totals(brows[i], bexp[i], binc[i])} for i, (label, a, b) in enumerate(buckets)]
    return out


async def holdings(db: AsyncSession) -> dict:
    """How much the company should be holding right now, and why."""
    (wallets,) = await _one(db, "SELECT COALESCE(SUM(balance_kobo),0) FROM wallets")
    (pending,) = await _one(db, "SELECT COALESCE(SUM(net_payable_kobo),0) FROM withdrawals WHERE status IN ('pending','claimed')")
    st = await db.get(AccountingSettings, 1)
    days = st.buffer_days if st else 14
    today = datetime.now(WAT).date()
    a = today - timedelta(days=29)
    s, e = day_bounds(a, today)
    rows = await service_rows(db, s, e)
    exp = await expense_summary(db, a, today)
    daily = (sum(r["cost_kobo"] for r in rows) + exp["total_kobo"]) // 30
    buffer = daily * days
    return {"wallet_balances_kobo": int(wallets), "pending_payouts_kobo": int(pending), "avg_daily_outgoings_kobo": int(daily), "buffer_days": days,
            "buffer_kobo": int(buffer), "should_hold_kobo": int(wallets) + int(pending) + int(buffer)}
