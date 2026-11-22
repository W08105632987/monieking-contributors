"""Accounting Center numbers. Every figure is labelled with where it came from:
  measured : read straight from a record (e.g. what Monnify's webhook told us it charged)
  rate     : events counted from our records x the price a director typed in (effective-dated)
  missing  : events happened but no price has been typed in, so the cost is shown as 0 and flagged
Nothing about a provider's price is hard-coded."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.accounting import AccountingSettings, CostRate
from app.models.service_template import ServiceTemplate, ServiceTemplateVersion
from app.services import manual_pricing as mp
from app.services import service_template_engine as eng
from app.verification import constants as VC

WAT = timezone(timedelta(hours=1))   # Nigeria time: a "day" runs midnight to midnight here

# ── one price-book row per real thing ──────────────────────────────────────
# The same service used to appear several times under different codes ("BVN retrieval - by CRM", "BVN retrieval - by phone
# number" and "BVN Retrieval"). manual_pricing.CATEGORY_ALIASES already says which codes are one service; the price book and the
# report now follow it. When an old code was really a TIER of the main service, it maps to that tier.
TIER_ALIASES = {"bvn_retrieval_phone": "phone_number", "bvn_retrieval_crm": "crm_investigation", "bvn_self_service_delinking": "self_service_delinking"}
RATE_KEY_ALIASES: dict[str, str] = {
    f"identity.{old}": f"identity.{new}" + (f".{TIER_ALIASES[old]}" if old in TIER_ALIASES else "")
    for old, new in mp.CATEGORY_ALIASES.items()
}
# Retired identity services: no longer offered, and nothing in them is a provider cost in this book (airtime and bills earn
# a markup and commission, they are not priced here). Never listed.
RETIRED_IDENTITY_CODES = frozenset({"airtime_data", "bill_payments"})
RETIRED_IDENTITY_CATEGORIES = frozenset({"airtime", "bills"})


def _listed_identity(code: str) -> bool:
    """False for a retired identity service or a duplicate name of another service: it has no row of its own unless it has activity."""
    return code not in RETIRED_IDENTITY_CODES and mp.resolve_category(code) == code


def _humanize(code: str) -> str:
    t = (code or "").replace("_", " ").strip()
    return t[:1].upper() + t[1:]


def _as_json(v):
    if isinstance(v, (str, bytes)):
        try:
            return json.loads(v)
        except ValueError:
            return None
    return v


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


def _tiers_from_template(schema, rules) -> tuple[list[dict], int | None, int | None]:
    """The child tiers of a service (the options of its 'service_type' selector) with the customer price of each, read from the
    same price rules the customer is charged by. Returns (tiers, cheapest, dearest) over the whole service."""
    schema, rules = _as_json(schema) or {}, _as_json(rules) or []
    matrix = eng.price_matrix(schema, rules) if schema else []
    every = [int(m["price_kobo"]) for m in matrix] or [int(r["price_kobo"]) for r in rules if isinstance(r, dict) and r.get("price_kobo")]
    sel = next((s for s in schema.get("selectors", []) if s.get("key") == "service_type" and s.get("options")), None)
    if not sel or len(sel["options"]) < 2:
        return [], (min(every) if every else None), (max(every) if every else None)
    by_type: dict[str, list[int]] = {}
    for m in matrix:
        by_type.setdefault(str(m["selections"].get("service_type")), []).append(int(m["price_kobo"]))
    tiers = []
    for o in sel["options"]:
        v = _safe(str(o["value"]))
        ps = by_type.get(str(o["value"]), [])
        tiers.append({"tier": v, "label": o.get("label") or _humanize(v), "price_min_kobo": min(ps) if ps else None, "price_max_kobo": max(ps) if ps else None})
    return tiers, (min(every) if every else None), (max(every) if every else None)


def _fallback_tiers(canon: str) -> tuple[list[dict], int | None, int | None]:
    """A service with no director-built template: tiers from the built-in price table."""
    table = {k: v for k, v in (mp.PRICE_MAP.get(canon) or {}).items() if k != "default"}
    if len(table) < 2:
        d = (mp.PRICE_MAP.get(canon) or {}).get("default")
        return [], d, d
    tiers = [{"tier": _safe(k), "label": _humanize(k), "price_min_kobo": v, "price_max_kobo": v} for k, v in table.items()]
    return tiers, min(table.values()), max(table.values())


async def _service_catalog(db: AsyncSession) -> dict[str, dict]:
    """Every worker/provider-handled service ONCE, keyed by its canonical code: {title, kind, tiers, price_min_kobo, price_max_kobo}.
    Duplicate names (see RATE_KEY_ALIASES) collapse into the main service, so a cost is typed in one place only."""
    out: dict[str, dict] = {}
    rows = (await db.execute(
        select(ServiceTemplate.service_code, ServiceTemplate.title, ServiceTemplate.kind, ServiceTemplateVersion.schema, ServiceTemplateVersion.price_rules)
        .join(ServiceTemplateVersion, ServiceTemplateVersion.id == ServiceTemplate.current_version_id, isouter=True)
        .where(ServiceTemplate.archived_at.is_(None)).order_by(ServiceTemplate.title))).all()
    for code, title, kind, schema, rules in rows:
        canon = mp.resolve_category(code)
        if canon in out and code != canon:
            continue                                   # the main service's own template wins over a duplicate-named one
        tiers, lo, hi = _tiers_from_template(schema, rules)
        if not tiers and not lo:
            tiers, lo, hi = _fallback_tiers(canon)
        out[canon] = {"title": title, "kind": kind, "tiers": tiers, "price_min_kobo": lo, "price_max_kobo": hi}
    return out


def _service_item(canon: str, info: dict, group: str) -> dict:
    key = f"identity.{canon}"
    item = {"key": key, "label": info["title"], "provider": "Provider for this service", "group": group, "mode": "flat",
            "hint": ("What the provider charges us each time a customer's request is completed. Type 0 if it costs nothing."
                     + (" This is the default: it is used for every tier that has no cost of its own below." if info["tiers"] else "")),
            "price_min_kobo": info.get("price_min_kobo"), "price_max_kobo": info.get("price_max_kobo"), "tiers": []}
    for t in info["tiers"]:
        item["tiers"].append({"key": f"{key}.{t['tier']}", "tier": t["tier"], "label": t["label"], "mode": "flat", "group": group,
                              "provider": "Provider for this service", "price_min_kobo": t["price_min_kobo"], "price_max_kobo": t["price_max_kobo"],
                              "hint": f"What the provider charges us each time a '{t['label']}' request is completed. Leave it empty to use the service's default cost."})
    return item


def flat_keys(items: list[dict]) -> set[str]:
    """Every rate key in the catalogue, tiers included."""
    keys: set[str] = set()
    for i in items:
        keys.add(i["key"])
        keys |= {t["key"] for t in i.get("tiers", [])}
    return keys


async def catalog(db: AsyncSession) -> list[dict]:
    """The price book: ONE row per real cost. Worker/provider-handled services list their child tiers, each with its own cost."""
    items = _techhub_keys() + STATIC_RATES
    services = await _service_catalog(db)
    idrows = (await db.execute(text(
        "SELECT s.code, s.name, s.provider, s.is_active, s.category::text, "
        "EXISTS (SELECT 1 FROM identity_service_requests r WHERE r.service_id = s.id) FROM identity_services s ORDER BY s.name"))).all()
    youverify: list[tuple[str, str, str]] = []
    pending: dict[str, tuple[str, str]] = {}           # canonical code -> (name, provider), for services with no template
    for code, name, provider, active, category, used in idrows:
        canon = mp.resolve_category(code)
        if code in RETIRED_IDENTITY_CODES or category in RETIRED_IDENTITY_CATEGORIES:
            continue                                   # retired: never a provider cost here
        if canon in services:
            continue                                   # has a template: listed below with its tiers (a duplicate name folds into it)
        if not (active or used):
            continue                                   # switched off and never used: nothing to price
        if provider == "youverify" and canon == code:
            youverify.append((code, name, "Youverify"))
        elif canon not in pending or code == canon:    # the main service's own row names it; a duplicate name only stands in for it
            pending[canon] = (name, provider)
    for canon, (name, provider) in pending.items():
        tiers, lo, hi = _fallback_tiers(canon)
        services[canon] = {"title": name, "kind": "manual" if provider == "manual" else "api", "tiers": tiers, "price_min_kobo": lo, "price_max_kobo": hi}
    for canon, info in sorted(services.items(), key=lambda kv: kv[1]["title"].lower()):
        items.append(_service_item(canon, info, "Provider services" if info["kind"] == "api" else "Worker-handled services"))
    for code, name, prov in youverify:
        items.append({"key": f"identity.{code}", "label": name, "provider": prov, "group": "Youverify checks", "mode": "flat", "tiers": [],
                      "hint": "What Youverify charges us each time a customer uses this check."})
    seen: set[str] = set()
    unique = []
    for i in items:                                    # a key can only ever appear once
        if i["key"] not in seen:
            seen.add(i["key"])
            unique.append(i)
    return unique


async def _all_rates(db: AsyncSession) -> dict[str, list[CostRate]]:
    rows = (await db.execute(select(CostRate).order_by(CostRate.rate_key, CostRate.effective_from, CostRate.created_at))).scalars().all()
    out: dict[str, list[CostRate]] = {}
    for r in rows:
        out.setdefault(r.rate_key, []).append(r)
    # A price typed under an old duplicate name is the same price as the one under its canonical key, until a price is typed
    # under the canonical key itself (from then on that one wins).
    for old, new in RATE_KEY_ALIASES.items():
        if old in out and new not in out:
            out[new] = out[old]
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



_SAFE = __import__("re").compile(r"[^a-z0-9_\-]")


def _safe(code: str) -> str:
    return _SAFE.sub("", (code or "").lower())


async def _titles(db: AsyncSession) -> dict[str, str]:
    out = {c: n for c, n in (await db.execute(text("SELECT code, name FROM identity_services"))).all()}
    out.update({c: t for c, t in (await db.execute(text("SELECT service_code, title FROM service_templates"))).all()})
    return out


def _manual_row(cat: str, title: str, rev, comm, c, n, un, company_n=0) -> dict:
    key = f"identity.{cat}"
    note = ("Cost = the worker's commission + what the provider charges us per request (price book). Counted when the job is completed successfully; failed jobs are refunded and earn nothing.")
    if company_n:
        note += (f" {int(company_n)} of these {int(n)} jobs were done by company workers: no commission, so only the provider charge is the cost.")
    row = _row(f"manual_{cat}", title, "Services", rev, int(comm) + int(c), n, 0, "rate", un, [key], note)
    row["company_jobs"] = int(company_n or 0)
    row["affiliated_jobs"] = max(0, int(n or 0) - int(company_n or 0))
    return row


def _bill_row(cat: str, label: str, prov: str, markup: int, commission: int, n: int, vol: int) -> dict:
    """One bills row for one supplier. Monnify keeps the historic id (bill_<category>); VTU (GYKDATASUB) gets bill_<category>_vtu."""
    if prov == "vtu":
        title = f"{label} bills (VTU)"
        note = "We earn the price the customer paid minus what GYKDATASUB charged us. There is no separate commission."
        rid = f"bill_{cat}_vtu"
    else:
        title = f"{label} bills (Standard)" if cat == "data" else f"{label} bills"
        note = "We earn this: our markup plus the commission Monnify pays us. Monnify does not charge us for it."
        rid = f"bill_{cat}"
    row = _row(rid, title, "Bills", markup + commission, 0, n, vol, "commission", 0, [], note)
    row["markup_kobo"], row["commission_kobo"] = markup, commission
    return row


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
    # Each category is split by the supplier that ACTUALLY served the purchase (Monnify, or GYKDATASUB = "VTU"), so the Accounting
    # Center shows exactly what the cheaper VTU plans earn. The Monnify row keeps its old id; the VTU row only appears once it has sales.
    for cat, label in (("airtime", "Airtime"), ("data", "Data"), ("electricity", "Electricity"), ("cable_tv", "Cable TV"), ("education", "Education")):
        for prov in ("monnify", "vtu"):
            frm = "bill_payment_requests r JOIN billers b ON b.id = r.biller_id"
            where = f"r.status = 'completed' AND b.category = '{cat}' AND r.provider = '{prov}' AND r.completed_at >= :s AND r.completed_at < :e"
            n, vol, markup, commission = await _one(
                db, f"SELECT COUNT(*), COALESCE(SUM(r.amount_kobo),0), COALESCE(SUM(r.markup_kobo),0), COALESCE(SUM(r.commission_kobo),0) FROM {frm} WHERE {where}", **P)
            if prov == "vtu" and not n:
                continue
            row = _bill_row(cat, label, prov, int(markup), int(commission), n, vol)
            rows.append(row)

    # Airtime to Cash: we earn our margin on the airtime customers sell us (revenue = fee; the rest is paid to the customer).
    n_a2c, vol_a2c, fee_a2c = await _one(
        db, "SELECT COUNT(*), COALESCE(SUM(amount_kobo),0), COALESCE(SUM(fee_kobo),0) FROM airtime_cash_requests WHERE status = 'completed' AND completed_at >= :s AND completed_at < :e", **P)
    if n_a2c:
        rows.append(_row("airtime_cash", "Airtime to Cash", "Bills", int(fee_a2c), 0, n_a2c, vol_a2c, "commission", 0, [],
                         "We earn the margin between what the supplier credits us for the airtime and what the customer is paid."))

    # Identity services (revenue = what the customer paid).
    for code, name in (await db.execute(text("SELECT code, name FROM identity_services ORDER BY name"))).all():
        frm = "identity_service_requests r JOIN identity_services s ON s.id = r.service_id"
        where = f"r.status = 'completed' AND s.code = '{code.replace(chr(39), '')}'"
        n, rev = await _one(db, f"SELECT COUNT(*), COALESCE(SUM(r.amount_charged_kobo),0) FROM {frm} WHERE {where} AND r.completed_at >= :s AND r.completed_at < :e", **P)
        key = f"identity.{code}"
        c, _, un = await _priced(db, rates, key, start, end, frm, "r.completed_at", where)
        if n or (rates.get(key) and _listed_identity(code)):
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
    # KYC onboarding checks: a customer proves their NIN to get an account. Techhub charges us for each one at the same
    # price as an ordinary NIN check of that tier (the price-book key techhub.nin.<tier>). The customer is not charged,
    # so revenue is 0 and the cost shows as a loss. Savepoint: an old database without the table never breaks the report.
    try:
        async with db.begin_nested():
            for (tier,) in (await db.execute(text("SELECT DISTINCT tier FROM kyc_lookups WHERE outcome = 'found' AND created_at >= :s AND created_at < :e"), P)).all():
                t = tier.replace("'", "")
                key = f"techhub.nin.{t}"
                c, n, un = await _priced(db, rates, key, start, end, "kyc_lookups", "created_at", f"outcome = 'found' AND tier = '{t}'")
                rows.append(_row(f"techhub_kyc_nin_{t}", f"Techhub NIN check, KYC onboarding - {t}", "Techhub", 0, c, n, 0, "rate", un, [key],
                                 "Customers verifying their NIN to open their account. Priced like a normal NIN check; the customer is not charged."))
    except Exception:   # noqa: BLE001
        pass
    for tier in ("regular", "standard", "premium"):
        (n, rev) = await _one(db, "SELECT COUNT(*), COALESCE(SUM(price_kobo),0) FROM verification_slips WHERE tier = :t AND created_at >= :s AND created_at < :e", t=tier, **P)
        if n:
            key = f"techhub.slip.{tier}"
            c, _, un = await _priced(db, rates, key, start, end, "verification_slips", "created_at", f"tier = '{tier}'")
            rows.append(_row(f"techhub_slip_{tier}", f"Techhub slip - {tier}", "Techhub", rev, c, n, 0, "rate", un, [key]))

    # Worker/provider-handled services (NIN modification, BVN modification ...): one row per service so each can be priced.
    rows.extend((await _manual_rows(db, [(start, end)], rates))[0])

    # Affiliated officers earn a share of the withdrawal charge: that is money the company pays out.
    (oc, on_) = await _one(db, "SELECT COALESCE(SUM(amount_kobo),0), COUNT(*) FROM officer_commissions WHERE created_at >= :s AND created_at < :e", **P)
    if on_:
        rows.append(_row("officer_commissions", "Affiliated officer commissions", "Withdrawals", 0, oc, on_, 0, "measured", 0, [], "Their share of the withdrawal charge, paid when a withdrawal is marked paid."))
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


_MANUAL_AGG = ("COUNT(*), COALESCE(SUM(price_kobo),0), "
               "COALESCE(SUM(CASE WHEN commission_status = 'reversed' THEN 0 ELSE worker_commission_kobo END),0), "
               "COALESCE(SUM(CASE WHEN worker_type = 'company' THEN 1 ELSE 0 END),0)")


async def _manual_rows(db: AsyncSession, windows: list[Window], rates: dict) -> list[list[dict]]:
    """Worker/provider-handled services (NIN modification, BVN modification, CAC ...): one row per service, with a line for each
    child tier (the job's service_type). The provider's charge for a job is the cost typed for ITS tier; a tier with no cost of
    its own uses the service's default cost, and with neither the job is flagged unpriced (never guessed). Names that are the same
    service (see RATE_KEY_ALIASES) are counted together. Used by both service_rows() and service_rows_multi(), so the page and
    the chart can never disagree."""
    W = len(windows)
    out: list[list[dict]] = [[] for _ in range(W)]
    titles = await _titles(db)
    known = await _service_catalog(db)
    grouped = await _grouped(db, windows, "completed_at", _MANUAL_AGG, "manual_service_requests", "status = 'successful'",
                             keys="service_category, COALESCE(service_type, '')")
    data: dict[str, dict[str, list[list[int]]]] = {}          # service -> tier -> per window [jobs, revenue, commission, company jobs]
    sources: dict[tuple[str, str], set[tuple[str, str]]] = {}  # (service, tier) -> stored (category, service_type) pairs, for the WHERE
    for i, (cat, stype, n, rev, comm, company) in grouped:
        raw, st = _safe(cat), _safe(stype)
        canon = mp.resolve_category(raw)
        tier = st or TIER_ALIASES.get(raw, "")
        cell = data.setdefault(canon, {}).setdefault(tier, [[0, 0, 0, 0] for _ in range(W)])[i]
        for j, v in enumerate((n, rev, comm, company)):
            cell[j] += int(v)
        sources.setdefault((canon, tier), set()).add((raw, st))

    def title_of(canon: str) -> str:
        return (known.get(canon) or {}).get("title") or titles.get(canon) or _humanize(canon)

    for canon in sorted(data, key=lambda c: title_of(c).lower()):
        service_key = f"identity.{canon}"
        labels = {t["tier"]: t["label"] for t in (known.get(canon) or {}).get("tiers", [])}
        lines = []                                              # (tier, rate key, cells, per-window (cost, jobs, unpriced))
        for tier in sorted(data[canon]):
            cells = data[canon][tier]
            own = f"{service_key}.{tier}" if tier else None
            key = own if (own and rates.get(own)) else service_key
            if rates.get(key):
                conds = " OR ".join(f"(service_category = '{r}' AND COALESCE(service_type, '') = '{s}')" for r, s in sorted(sources[(canon, tier)]))
                pr = await _priced_multi(db, rates, key, windows, "manual_service_requests", "completed_at", f"status = 'successful' AND ({conds})", "price_kobo")
            else:
                pr = [(0, cells[i][0], cells[i][0]) for i in range(W)]    # no cost typed anywhere: cost shown as 0, every job flagged
            lines.append((tier, key, cells, pr))
        for i in range(W):
            live = [ln for ln in lines if ln[2][i][0]]
            if not live:
                continue
            n = sum(ln[2][i][0] for ln in live)
            row = _manual_row(canon, title_of(canon), sum(ln[2][i][1] for ln in live), sum(ln[2][i][2] for ln in live),
                              sum(ln[3][i][0] for ln in live), n, sum(ln[3][i][2] for ln in live), sum(ln[2][i][3] for ln in live))
            row["rate_keys"] = [service_key] + [ln[1] for ln in live if ln[1] != service_key]
            row["tiers"] = [{"tier": t or "default", "label": labels.get(t) or (_humanize(t) if t else "No tier recorded"), "count": c[i][0], "revenue_kobo": c[i][1],
                             "commission_kobo": c[i][2], "provider_cost_kobo": p[i][0], "margin_kobo": c[i][1] - c[i][2] - p[i][0],
                             "unpriced_events": p[i][2], "rate_key": k, "has_own_cost": k != service_key}
                            for t, k, c, p in live]
            out[i].append(row)
    return out


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
        for prov in ("monnify", "vtu"):
            frm = "bill_payment_requests r JOIN billers b ON b.id = r.biller_id"
            where = f"r.status = 'completed' AND b.category = '{cat}' AND r.provider = '{prov}'"
            agg = await _one_multi(db, windows, "r.completed_at", "COUNT(*), COALESCE(SUM(r.amount_kobo),0), COALESCE(SUM(r.markup_kobo),0), COALESCE(SUM(r.commission_kobo),0)", frm, where, width=4)
            if prov == "vtu" and not any(agg[i][0] for i in range(W)):
                continue
            for i in range(W):
                n, vol, markup, commission = agg[i]
                out[i].append(_bill_row(cat, label, prov, int(markup), int(commission), n, vol))

    a2c = await _one_multi(db, windows, "completed_at", "COUNT(*), COALESCE(SUM(amount_kobo),0), COALESCE(SUM(fee_kobo),0)", "airtime_cash_requests", "status = 'completed'", width=3)
    if any(a2c[i][0] for i in range(W)):
        for i in range(W):
            n, vol, fee = a2c[i]
            out[i].append(_row("airtime_cash", "Airtime to Cash", "Bills", int(fee), 0, n, vol, "commission", 0, [],
                               "We earn the margin between what the supplier credits us for the airtime and what the customer is paid."))

    for code, name in (await db.execute(text("SELECT code, name FROM identity_services ORDER BY name"))).all():
        frm = "identity_service_requests r JOIN identity_services s ON s.id = r.service_id"
        where = f"r.status = 'completed' AND s.code = '{code.replace(chr(39), '')}'"
        agg = await _one_multi(db, windows, "r.completed_at", "COUNT(*), COALESCE(SUM(r.amount_charged_kobo),0)", frm, where, width=2)
        key = f"identity.{code}"
        pr = await _priced_multi(db, rates, key, windows, frm, "r.completed_at", where)
        for i in range(W):
            n, rev = agg[i]
            if n or (rates.get(key) and _listed_identity(code)):
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
    try:   # KYC onboarding checks, see service_rows()
        async with db.begin_nested():
            kc: dict[str, set[int]] = {}
            for i, vals in await _grouped(db, windows, "created_at", "COUNT(*)", "kyc_lookups", "outcome = 'found'", keys="tier"):
                kc.setdefault(vals[0], set()).add(i)
            for tier in sorted(kc):
                t = tier.replace("'", "")
                key = f"techhub.nin.{t}"
                pr = await _priced_multi(db, rates, key, windows, "kyc_lookups", "created_at", f"outcome = 'found' AND tier = '{t}'")
                for i in sorted(kc[tier]):
                    out[i].append(_row(f"techhub_kyc_nin_{t}", f"Techhub NIN check, KYC onboarding - {t}", "Techhub", 0, pr[i][0], pr[i][1], 0, "rate", pr[i][2], [key],
                                       "Customers verifying their NIN to open their account. Priced like a normal NIN check; the customer is not charged."))
    except Exception:   # noqa: BLE001
        pass
    for tier in ("regular", "standard", "premium"):
        agg = await _one_multi(db, windows, "created_at", "COUNT(*), COALESCE(SUM(price_kobo),0)", "verification_slips", f"tier = '{tier}'", width=2)
        if any(a[0] for a in agg):
            key = f"techhub.slip.{tier}"
            pr = await _priced_multi(db, rates, key, windows, "verification_slips", "created_at", f"tier = '{tier}'")
            for i in range(W):
                if agg[i][0]:
                    out[i].append(_row(f"techhub_slip_{tier}", f"Techhub slip - {tier}", "Techhub", agg[i][1], pr[i][0], agg[i][0], 0, "rate", pr[i][2], [key]))

    for i, mrows in enumerate(await _manual_rows(db, windows, rates)):
        out[i].extend(mrows)

    oc = await _one_multi(db, windows, "created_at", "COALESCE(SUM(amount_kobo),0), COUNT(*)", "officer_commissions", width=2)
    for i in range(W):
        if oc[i][1]:
            out[i].append(_row("officer_commissions", "Affiliated officer commissions", "Withdrawals", 0, oc[i][0], oc[i][1], 0, "measured", 0, [], "Their share of the withdrawal charge, paid when a withdrawal is marked paid."))
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


async def obligations(db: AsyncSession) -> dict:
    """Money the company holds that is not its own: customer wallets, payouts waiting, commissions owed, money held for open jobs."""
    (wallets,) = await _one(db, "SELECT COALESCE(SUM(balance_kobo),0) FROM wallets")
    (pending,) = await _one(db, "SELECT COALESCE(SUM(net_payable_kobo),0) FROM withdrawals WHERE status IN ('pending','claimed')")
    (jobs_kobo, jobs_n) = await _one(db, "SELECT COALESCE(SUM(price_kobo),0), COUNT(*) FROM manual_service_requests WHERE status IN ('pending','processing','awaiting_provider')")
    (worker_bal,) = await _one(db, "SELECT COALESCE(SUM(commission_balance_kobo),0) FROM users WHERE role::text = 'service_worker'")
    (worker_pending,) = await _one(db, "SELECT COALESCE(SUM(amount_kobo),0) FROM service_worker_withdrawals WHERE status::text = 'pending'")
    (off_earned,) = await _one(db, "SELECT COALESCE(SUM(amount_kobo),0) FROM officer_commissions")
    (off_paid,) = await _one(db, "SELECT COALESCE(SUM(amount_kobo),0) FROM officer_payouts WHERE status = 'paid'")
    owed = int(worker_bal) + int(worker_pending) + max(0, int(off_earned) - int(off_paid))
    return {"wallets": int(wallets), "pending_payouts": int(pending), "jobs": int(jobs_kobo), "jobs_count": int(jobs_n), "owed": owed,
            "total": int(wallets) + int(pending) + int(jobs_kobo) + owed}


async def holdings(db: AsyncSession) -> dict:
    """How much the company should be holding right now, and why."""
    ob = await obligations(db)
    wallets, pending, jobs_kobo, jobs_n, owed = ob["wallets"], ob["pending_payouts"], ob["jobs"], ob["jobs_count"], ob["owed"]
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
            "buffer_kobo": int(buffer),
            "in_progress_jobs_kobo": int(jobs_kobo), "in_progress_jobs": int(jobs_n), "owed_commissions_kobo": owed,
            "should_hold_kobo": int(wallets) + int(pending) + int(jobs_kobo) + owed + int(buffer)}


# ── money trail: every wallet movement, and where the report counts it ────────
# (type, entity) -> (what it is, how the report treats it, accounting row it feeds)
_TRAIL: dict[tuple[str, str], tuple[str, str, str | None]] = {
    ("credit", "wallet_funding"):        ("Customers funded wallets", "customer_money", "funding"),
    ("debit", "wallet_funding_fee"):     ("Funding fee charged", "revenue", "funding"),
    ("debit", "sms_fee"):                ("SMS alert fees", "revenue", "sms"),
    ("debit", "bill_payment"):           ("Bills, airtime and data paid", "pass_through", "bills"),
    ("debit", "techhub_lookup"):         ("Verification checks", "revenue", "techhub"),
    ("debit", "techhub_slip"):           ("Verification slips", "revenue", "techhub"),
    ("debit", "identity_service"):       ("Identity services", "revenue", "identity"),
    ("debit", "manual_service_request"): ("Worker/provider-handled services (NIN, BVN, CAC ...)", "revenue_on_completion", "manual"),
    ("credit", "manual_service_request"):("Refunds of failed services", "refund", "manual"),
    ("debit", "withdrawal"):             ("Withdrawals taken from wallets", "customer_money", "withdrawals"),
    ("credit", "withdrawal"):            ("Withdrawal reversals", "customer_money", "withdrawals"),
    ("debit", "contribution_card"):      ("Card contributions from wallets", "customer_money", None),
    ("credit", "contribution_card"):     ("Card refunds to wallets", "customer_money", None),
    ("debit", "coop"):                   ("Cooperative module", "separate_ledger", None),
    ("credit", "coop"):                  ("Cooperative module", "separate_ledger", None),
}
_TREATMENT_TEXT = {
    "revenue": "Counted as revenue.",
    "revenue_on_completion": "Counted as revenue when the job completes successfully; money for jobs still open is held, not yet income.",
    "pass_through": "Only our markup and Monnify's commission are income; the rest is passed on to the biller.",
    "refund": "Money returned to customers; those jobs earn nothing.",
    "customer_money": "Belongs to customers (savings, wallet balance, payouts). Not income.",
    "separate_ledger": "Tracked in the cooperative's own ledger, not in this report.",
    "unmapped": "Not counted anywhere. Check it.",
}


async def money_trail(db: AsyncSession, start: date, end: date) -> dict:
    s, e = day_bounds(start, end)
    rows = (await db.execute(text(
        "SELECT type::text, category::text, COALESCE(related_entity_type, ''), COUNT(*), COALESCE(SUM(amount_kobo), 0) "
        "FROM wallet_transactions WHERE created_at >= :s AND created_at < :e GROUP BY 1, 2, 3 ORDER BY 5 DESC"), {"s": s, "e": e})).all()
    lines, attention = [], []
    for typ, cat, ent, n, total in rows:
        known = _TRAIL.get((typ, ent))
        if known:
            label, treat, feeds = known
        elif cat in ("contribution", "officer_contribution", "withdrawal"):
            label, treat, feeds = (f"{cat.replace('_', ' ').title()} ({typ})", "customer_money", None)
        elif cat == "reversal":
            label, treat, feeds = (f"Reversal ({typ}){' - ' + ent.replace('_', ' ') if ent else ''}", "customer_money", None)
        elif cat == "manual_debit":
            label, treat, feeds = ("Director manual debit from a wallet", "unmapped", None)
        else:
            label, treat, feeds = (f"{cat.replace('_', ' ').title()} / {ent or 'no source'} ({typ})", "unmapped", None)
        line = {"type": typ, "category": cat, "source": ent or None, "label": label, "count": int(n), "total_kobo": int(total),
                "treatment": treat, "treatment_text": _TREATMENT_TEXT[treat], "feeds": feeds}
        lines.append(line)
        if treat == "unmapped":
            attention.append(line)
    # Jobs paid for but not finished: money held, income not yet earned.
    (jn, jk) = await _one(db, "SELECT COUNT(*), COALESCE(SUM(price_kobo),0) FROM manual_service_requests WHERE status IN ('pending','processing','awaiting_provider') AND created_at >= :s AND created_at < :e", s=s, e=e)
    return {"start": start.isoformat(), "end": end.isoformat(), "lines": lines, "attention": attention,
            "open_jobs": {"count": int(jn), "held_kobo": int(jk)}}
