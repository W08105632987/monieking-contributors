"""Company-funds balancing. One equation, checked every day:

    capital (what the company owns) + obligations (money it holds for others)  =  expected total funds
    expected total funds  vs  what the accounts actually hold  ->  the difference is the money to question

Capital rolls forward:  closing = opening + profit + money injected - money drawn - goodwill credits - transfer fees.
Obligations (customer wallets, payouts waiting, commissions owed, money held for open jobs) are read live from the app.
Actual funds are: Monnify wallet (live), Monnify pending settlement (computed), GYK wallet (live), and two accounts the app
cannot see, which a director counts: the central account and "other funds". Manual funding is money that sits in the
central account, so the central account's EXPECTED balance is rolled from the last count using manual credits and the
transfer log.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_funds import DayClosing, FundAccountBalance, FundTransfer
from app.services import accounting_service as acct
from app.services import monnify_center_service as mc
from app.services import settings_service as cfg

WAT = acct.WAT
ACCOUNTS = {
    "central":         {"label": "Directors' central account", "auto": False},
    "monnify_wallet":  {"label": "Monnify wallet", "auto": True},
    "monnify_pending": {"label": "Monnify pending settlement", "auto": True},
    "gyk_wallet":      {"label": "GYKDATASUB wallet", "auto": True},
    "other":           {"label": "Other funds (cash in hand, other banks)", "auto": False},
}
MANUAL_ACCOUNTS = [k for k, v in ACCOUNTS.items() if not v["auto"]]
TRANSFER_KINDS = {"transfer": "Move between our accounts", "injection": "Money put into the company", "drawing": "Money taken out of the company",
                  "goodwill": "Credit given to a customer without receiving money"}
AUTO_CLOSE_ENABLED, AUTO_CLOSE_TIME = "cash.auto_close_enabled", "cash.auto_close_time"
BASE_CAPITAL, BASE_DATE = "cash.opening_capital_kobo", "cash.opening_capital_date"


class FundsError(ValueError):
    pass


def _bounds(d0: date, d1: date) -> tuple[datetime, datetime]:
    return acct.day_bounds(d0, d1)


# ── transfer log ──────────────────────────────────────────────────────────

def validate_transfer(kind: str, frm: str | None, to: str | None, amount_kobo: int, fee_kobo: int) -> tuple[str | None, str | None]:
    if kind not in TRANSFER_KINDS:
        raise FundsError("Unknown kind of entry.")
    if amount_kobo <= 0:
        raise FundsError("The amount must be more than zero.")
    if fee_kobo < 0:
        raise FundsError("The fee cannot be negative.")
    for a in (frm, to):
        if a and a not in ACCOUNTS:
            raise FundsError("Unknown account.")
    if kind == "transfer":
        if not frm or not to:
            raise FundsError("Choose both the account the money left and the account it went into.")
        if frm == to:
            raise FundsError("The two accounts are the same.")
        if "monnify_pending" in (frm, to):
            raise FundsError("Pending settlement moves by itself when Monnify settles. Do not log it.")
        return frm, to
    if kind == "injection":
        if not to or to == "monnify_pending":
            raise FundsError("Choose the account the money went into.")
        return None, to
    if kind == "drawing":
        if not frm or frm == "monnify_pending":
            raise FundsError("Choose the account the money came out of.")
        return frm, None
    return (frm or "central"), None        # goodwill: reduces the central account's expected balance


async def add_transfer(db: AsyncSession, *, user_id, occurred_on: date, kind: str, frm: str | None, to: str | None,
                       amount_kobo: int, fee_kobo: int = 0, reference: str | None = None, note: str | None = None) -> FundTransfer:
    frm, to = validate_transfer(kind, frm, to, amount_kobo, fee_kobo)
    if occurred_on > datetime.now(WAT).date():
        raise FundsError("The date cannot be in the future.")
    last = (await db.execute(select(DayClosing.day).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none()
    if last and occurred_on <= last:
        raise FundsError(f"{last.isoformat()} is already closed. Re-open the last closed day first, or date this entry after it.")
    t = FundTransfer(occurred_on=occurred_on, kind=kind, from_account=frm, to_account=to, amount_kobo=amount_kobo, fee_kobo=fee_kobo,
                     reference=(reference or None), note=(note or None), created_by=user_id)
    db.add(t)
    await db.flush()
    return t


async def void_transfer(db: AsyncSession, transfer_id, user_id, reason: str) -> FundTransfer:
    t = await db.get(FundTransfer, transfer_id)
    if not t:
        raise FundsError("Entry not found.")
    if t.voided_at:
        raise FundsError("This entry is already voided.")
    last = (await db.execute(select(DayClosing.day).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none()
    if last and t.occurred_on <= last:
        raise FundsError(f"{t.occurred_on.isoformat()} is already closed. Re-open that day to void this entry.")
    t.voided_at, t.voided_by, t.void_reason = datetime.now(timezone.utc), user_id, reason.strip()[:300]
    await db.flush()
    return t


def transfer_out(t: FundTransfer) -> dict:
    return {"id": str(t.id), "occurred_on": t.occurred_on.isoformat(), "kind": t.kind, "kind_label": TRANSFER_KINDS.get(t.kind, t.kind),
            "from": t.from_account, "to": t.to_account, "amount_kobo": t.amount_kobo, "fee_kobo": t.fee_kobo, "reference": t.reference,
            "note": t.note, "created_at": t.created_at.isoformat(), "voided": t.voided_at is not None, "void_reason": t.void_reason}


async def list_transfers(db: AsyncSession, start: date, end: date, include_voided: bool = True) -> list[dict]:
    q = select(FundTransfer).where(FundTransfer.occurred_on >= start, FundTransfer.occurred_on <= end).order_by(FundTransfer.occurred_on.desc(), FundTransfer.created_at.desc())
    if not include_voided:
        q = q.where(FundTransfer.voided_at.is_(None))
    return [transfer_out(t) for t in (await db.execute(q)).scalars().all()]


async def _transfer_flows(db: AsyncSession, start: date, end: date) -> dict:
    rows = (await db.execute(text(
        "SELECT kind, COALESCE(SUM(amount_kobo),0), COALESCE(SUM(fee_kobo),0), COUNT(*) FROM fund_transfers "
        "WHERE voided_at IS NULL AND occurred_on >= :a AND occurred_on <= :b GROUP BY kind"), {"a": start, "b": end})).all()
    m = {k: (int(a), int(f), int(n)) for k, a, f, n in rows}
    return {"injections": m.get("injection", (0, 0, 0))[0], "drawings": m.get("drawing", (0, 0, 0))[0], "goodwill": m.get("goodwill", (0, 0, 0))[0],
            "fees": sum(v[1] for v in m.values()), "transfers_moved": m.get("transfer", (0, 0, 0))[0], "entries": sum(v[2] for v in m.values())}


# ── accounts ──────────────────────────────────────────────────────────────

async def count_account(db: AsyncSession, account: str, naira_kobo: int, user_id) -> None:
    if account not in MANUAL_ACCOUNTS:
        raise FundsError("That account is read automatically.")
    if naira_kobo < 0:
        raise FundsError("A balance cannot be negative.")
    row = await db.get(FundAccountBalance, account)
    now = datetime.now(timezone.utc)
    if row:
        row.counted_kobo, row.counted_at, row.counted_by = naira_kobo, now, user_id
    else:
        db.add(FundAccountBalance(account=account, counted_kobo=naira_kobo, counted_at=now, counted_by=user_id))
    await db.flush()


async def _movement_since(db: AsyncSession, account: str, since: datetime) -> dict:
    """What the log and manual funding say moved into/out of an account after it was last counted."""
    rows = (await db.execute(text(
        "SELECT kind, from_account, to_account, amount_kobo, fee_kobo FROM fund_transfers WHERE voided_at IS NULL AND created_at > :t"), {"t": since})).all()
    inn = out = 0
    for kind, frm, to, amt, fee in rows:
        if to == account:
            inn += int(amt)
        if frm == account:
            out += int(amt) + (int(fee) if kind == "transfer" else 0)
    manual_in = 0
    if account == "central":
        (manual_in,) = (await db.execute(text(
            "SELECT COALESCE(SUM(amount_kobo),0) FROM wallet_transactions WHERE type::text = 'credit' AND reference LIKE 'MANUAL-%' "
            "AND reference NOT LIKE 'MANUAL-DEBIT-%' AND created_at > :t"), {"t": since})).one()
    return {"in": inn, "out": out, "manual_funding": int(manual_in)}


async def _gyk_balance_kobo() -> int | None:
    try:
        from app.core.config import get_settings
        if not get_settings().GYK_API_KEY:
            return None
        from app.integrations.gyk import get_vtu_provider
        b = await get_vtu_provider().wallet_balance()
        return int(round(b * 100)) if b is not None else None
    except Exception:  # noqa: BLE001
        return None


async def live_accounts(db: AsyncSession, include_due_today: bool = False) -> dict:
    wallet = await mc.wallet_snapshot()
    pos = await mc.settlement_position(db, include_due_today=include_due_today)
    gyk = await _gyk_balance_kobo()
    out: dict[str, dict] = {
        "monnify_wallet": {"kobo": wallet["available_kobo"], "source": "live from Monnify", "ok": wallet["reachable"]},
        "monnify_pending": {"kobo": pos["pending_kobo"], "source": "estimated from funding records", "ok": True},
        "gyk_wallet": {"kobo": gyk, "source": "live from GYKDATASUB", "ok": gyk is not None},
    }
    for acc in MANUAL_ACCOUNTS:
        row = await db.get(FundAccountBalance, acc)
        if row:
            mv = await _movement_since(db, acc, row.counted_at)
            expected = row.counted_kobo + mv["in"] + mv["manual_funding"] - mv["out"]
            out[acc] = {"kobo": row.counted_kobo, "expected_kobo": expected, "counted_at": row.counted_at.isoformat(), "movement": mv,
                        "source": "counted by a director", "ok": True}
        else:
            out[acc] = {"kobo": None, "expected_kobo": None, "counted_at": None, "movement": None, "source": "not counted yet", "ok": False}
    for k, v in out.items():
        v["label"] = ACCOUNTS[k]["label"]; v["auto"] = ACCOUNTS[k]["auto"]
    return {"accounts": out, "settlement": pos}


def actual_total(accounts: dict) -> int:
    return sum(int(a["kobo"] or 0) for a in accounts.values())


# ── capital ───────────────────────────────────────────────────────────────

async def _baseline(db: AsyncSession) -> tuple[int | None, date | None]:
    raw = await cfg.get_config_value(db, BASE_CAPITAL, "")
    d = await cfg.get_config_value(db, BASE_DATE, "")
    try:
        return (int(raw) if raw not in (None, "") else None), (date.fromisoformat(d) if d else None)
    except ValueError:
        return None, None


async def set_baseline(db: AsyncSession, capital_kobo: int, as_of: date, user_id) -> None:
    if (await db.execute(select(DayClosing.day).limit(1))).first():
        raise FundsError("Days have already been closed. The opening capital can no longer be changed.")
    await cfg.set_config_value(db, key=BASE_CAPITAL, value=str(int(capital_kobo)), updated_by=user_id)
    await cfg.set_config_value(db, key=BASE_DATE, value=as_of.isoformat(), updated_by=user_id)


async def _period_flows(db: AsyncSession, start: date, end: date) -> dict:
    rep = await acct.report(db, start, end, series=False)
    tf = await _transfer_flows(db, start, end)
    t = rep["totals"]
    return {"profit": int(t["net_profit_kobo"]), "revenue": int(t["revenue_kobo"]), "provider_cost": int(t["provider_cost_kobo"]),
            "expenses": int(t["expenses_kobo"]), "other_income": int(t["other_income_kobo"]), **tf,
            "net": int(t["net_profit_kobo"]) + tf["injections"] - tf["drawings"] - tf["goodwill"] - tf["fees"]}


async def opening_capital(db: AsyncSession, start: date) -> dict:
    """Capital at the start of `start`: the latest closed day before it, plus what happened since; else the opening-capital baseline."""
    anchor = (await db.execute(select(DayClosing).where(DayClosing.day < start).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none()
    if anchor:
        cap, since = anchor.closing_capital_kobo, anchor.day + timedelta(days=1)
        origin = f"closed day {anchor.day.isoformat()}"
    else:
        cap, bdate = await _baseline(db)
        if cap is None or bdate is None:
            return {"kobo": None, "origin": None, "needs_baseline": True}
        since, origin = bdate, f"opening capital set for {bdate.isoformat()}"
    if since < start:
        gap = await _period_flows(db, since, start - timedelta(days=1))
        cap += gap["net"]
        origin += f", plus {(start - since).days} unclosed day(s) since"
    return {"kobo": cap, "origin": origin, "needs_baseline": False}


# ── the balance sheet ─────────────────────────────────────────────────────

def build_questions(o: dict) -> list[dict]:
    q: list[dict] = []
    diff = o["difference_kobo"]
    if o.get("complete") and abs(diff) >= 100:
        if diff < 0:
            q.append({"level": "critical", "text": f"The accounts hold ₦{abs(diff)/100:,.2f} LESS than they should. Where did it go? Check the transfer log for a missing entry, unlogged withdrawals, and manual funding that never reached the central account."})
        else:
            q.append({"level": "warning", "text": f"The accounts hold ₦{diff/100:,.2f} MORE than expected. Is there money received that is not recorded (a customer paid the central account, an unlogged injection)?"})
    for k, a in o["accounts"].items():
        if not a["ok"] and k in MANUAL_ACCOUNTS and k == "central":
            q.append({"level": "warning", "text": "The central account has never been counted. Enter its balance so the manual funding can be checked against it."})
        if a.get("expected_kobo") is not None and a["kobo"] is not None and a.get("movement") is not None and abs(a["expected_kobo"] - a["kobo"]) >= 100 and (a["movement"]["in"] or a["movement"]["out"] or a["movement"]["manual_funding"]):
            q.append({"level": "info", "text": f"{a['label']}: since it was counted, the log and manual funding say it should now hold ₦{a['expected_kobo']/100:,.2f}. Count it again to confirm."})
        if k in ("monnify_wallet", "gyk_wallet") and not a["ok"]:
            q.append({"level": "warning", "text": f"{a['label']} could not be read. The total below leaves it out, so the difference is not reliable."})
    st = o["settlement"]
    if st["late_count"]:
        q.append({"level": "warning", "text": f"{st['late_count']} Monnify payment(s) worth ₦{st['late_kobo']/100:,.2f} are past their settlement day. If they are not in the Monnify wallet, ask Monnify."})
    if st["due_today_count"] and not st["includes_due_today"]:
        q.append({"level": "info", "text": f"₦{st['due_today_kobo']/100:,.2f} is due from Monnify today and is counted as already in the wallet. If it has not arrived, tick \"Treat today's settlements as pending\"."})
    if o["flows"].get("fees"):
        q.append({"level": "info", "text": f"₦{o['flows']['fees']/100:,.2f} was lost to transfer fees in this period."})
    if o["flows"].get("goodwill"):
        q.append({"level": "info", "text": f"₦{o['flows']['goodwill']/100:,.2f} was credited to customers without money received (goodwill). That reduced capital."})
    return q


async def overview(db: AsyncSession, start: date, end: date, include_due_today: bool = False) -> dict:
    opening = await opening_capital(db, start)
    flows = await _period_flows(db, start, end)
    live = await live_accounts(db, include_due_today)
    ob = await acct.obligations(db)
    today = datetime.now(WAT).date()
    historic = None
    if end < today:
        historic = (await db.execute(select(DayClosing).where(DayClosing.day == end))).scalar_one_or_none()
    accounts, as_of = live["accounts"], "now"
    if historic and historic.snapshot.get("accounts"):
        accounts, ob_snap, as_of = historic.snapshot["accounts"], historic.snapshot.get("obligations"), f"close of {end.isoformat()}"
        ob = {"wallets": ob_snap["wallets"], "pending_payouts": ob_snap["pending_payouts"], "jobs": ob_snap["jobs"], "jobs_count": ob_snap.get("jobs_count", 0),
              "owed": ob_snap["owed"], "total": ob_snap["total"]}
    cap_open = opening["kobo"]
    cap_close = None if cap_open is None else cap_open + flows["net"]
    expected = None if cap_close is None else cap_close + ob["total"]
    unreadable = [k for k, a in accounts.items() if not a.get("ok")]
    actual = actual_total(accounts)
    diff = None if expected is None else actual - expected
    manual = (await db.execute(text(
        "SELECT COALESCE(SUM(amount_kobo),0), COUNT(*) FROM wallet_transactions WHERE type::text = 'credit' AND reference LIKE 'MANUAL-%' "
        "AND reference NOT LIKE 'MANUAL-DEBIT-%' AND created_at >= :s AND created_at < :e"), dict(zip(("s", "e"), _bounds(start, end))))).one()
    monnify = (await db.execute(text(
        "SELECT COALESCE(SUM(gross_kobo),0), COALESCE(SUM(monnify_fee_kobo),0), COUNT(*) FROM funding_records WHERE created_at >= :s AND created_at < :e"),
        dict(zip(("s", "e"), _bounds(start, end))))).one()
    closings = (await db.execute(select(DayClosing).where(DayClosing.day >= start, DayClosing.day <= end).order_by(DayClosing.day.desc()))).scalars().all()
    out = {
        "start": start.isoformat(), "end": end.isoformat(), "as_of": as_of, "needs_baseline": opening["needs_baseline"], "opening_origin": opening["origin"],
        "opening_capital_kobo": cap_open, "flows": flows, "closing_capital_kobo": cap_close,
        "obligations": ob, "expected_total_kobo": expected, "actual_total_kobo": actual, "difference_kobo": diff if diff is not None else 0,
        "complete": expected is not None and not unreadable, "unreadable_accounts": unreadable,
        "accounts": accounts, "settlement": live["settlement"],
        "money_in": {"monnify_funding_kobo": int(monnify[0]), "monnify_fees_kobo": int(monnify[1]), "monnify_count": int(monnify[2]),
                     "manual_funding_kobo": int(manual[0]), "manual_funding_count": int(manual[1])},
        "closings": [closing_out(c) for c in closings],
        "last_closed": (await db.execute(select(DayClosing.day).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none(),
    }
    out["last_closed"] = out["last_closed"].isoformat() if out["last_closed"] else None
    out["questions"] = build_questions(out)
    return out


def closing_out(c: DayClosing) -> dict:
    return {"day": c.day.isoformat(), "closed_at": c.closed_at.isoformat(), "auto_closed": c.auto_closed, "opening_capital_kobo": c.opening_capital_kobo,
            "profit_kobo": c.profit_kobo, "injections_kobo": c.injections_kobo, "drawings_kobo": c.drawings_kobo, "goodwill_kobo": c.goodwill_kobo,
            "transfer_fees_kobo": c.transfer_fees_kobo, "closing_capital_kobo": c.closing_capital_kobo, "obligations_kobo": c.obligations_kobo,
            "expected_total_kobo": c.expected_total_kobo, "actual_total_kobo": c.actual_total_kobo, "difference_kobo": c.difference_kobo, "note": c.note}


# ── closing a day ─────────────────────────────────────────────────────────

async def close_day(db: AsyncSession, day: date, user_id=None, *, auto: bool = False, note: str | None = None,
                    counted: dict[str, int] | None = None, include_due_today: bool = False) -> DayClosing:
    today = datetime.now(WAT).date()
    if day > today:
        raise FundsError("A day that has not started cannot be closed.")
    if (await db.get(DayClosing, day)):
        raise FundsError(f"{day.isoformat()} is already closed.")
    last = (await db.execute(select(DayClosing.day).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none()
    if last and day < last:
        raise FundsError(f"{last.isoformat()} is already closed. Days close in order.")
    for acc, kobo in (counted or {}).items():
        await count_account(db, acc, kobo, user_id)
    o = await overview(db, day, day, include_due_today)
    if o["needs_baseline"]:
        raise FundsError("Set the company's opening capital first (the first time only).")
    c = DayClosing(day=day, closed_by=user_id, auto_closed=auto, opening_capital_kobo=o["opening_capital_kobo"], profit_kobo=o["flows"]["profit"],
                   injections_kobo=o["flows"]["injections"], drawings_kobo=o["flows"]["drawings"], goodwill_kobo=o["flows"]["goodwill"],
                   transfer_fees_kobo=o["flows"]["fees"], closing_capital_kobo=o["closing_capital_kobo"], obligations_kobo=o["obligations"]["total"],
                   expected_total_kobo=o["expected_total_kobo"], actual_total_kobo=o["actual_total_kobo"], difference_kobo=o["difference_kobo"],
                   snapshot={"accounts": o["accounts"], "obligations": o["obligations"], "money_in": o["money_in"], "questions": o["questions"],
                             "complete": o["complete"], "position_as_of": datetime.now(timezone.utc).isoformat(), "late_position": day < today},
                   note=(note or None))
    db.add(c)
    await db.flush()
    return c


async def reopen_last(db: AsyncSession, day: date) -> None:
    last = (await db.execute(select(DayClosing).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none()
    if not last or last.day != day:
        raise FundsError("Only the most recently closed day can be re-opened.")
    await db.delete(last)
    await db.flush()


# ── automatic closing ─────────────────────────────────────────────────────

def parse_close_time(raw: str | None) -> time:
    try:
        h, m = (raw or "23:55").split(":")
        return time(int(h), int(m))
    except (ValueError, TypeError):
        return time(23, 55)


async def auto_close_due(db: AsyncSession, now: datetime | None = None) -> dict:
    """Called every few minutes by the scheduler. Closes today once the set time has passed. Days missed while it was off are not guessed at."""
    if (await cfg.get_config_value(db, AUTO_CLOSE_ENABLED, "false")) != "true":
        return {"closed": None, "why": "off"}
    now_wat = (now or datetime.now(timezone.utc)).astimezone(WAT)
    at = parse_close_time(await cfg.get_config_value(db, AUTO_CLOSE_TIME, "23:55"))
    if now_wat.time() < at:
        return {"closed": None, "why": "not yet"}
    today = now_wat.date()
    if await db.get(DayClosing, today):
        return {"closed": None, "why": "already closed"}
    last = (await db.execute(select(DayClosing.day).order_by(DayClosing.day.desc()).limit(1))).scalar_one_or_none()
    if last and last >= today:
        return {"closed": None, "why": "already closed"}
    try:
        c = await close_day(db, today, None, auto=True, note="Closed automatically")
    except FundsError as e:
        return {"closed": None, "why": str(e)}
    return {"closed": c.day.isoformat(), "difference_kobo": c.difference_kobo}
