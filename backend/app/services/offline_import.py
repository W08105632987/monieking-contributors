"""Offline customers: validate an Excel sheet, stage the records, and attach them to the person's account
when they sign up with the same phone number."""
import io
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import ContributionCard, ContributionRecord, CardType, CardStatus, ContributionMethod
from app.models.offline_import import OfflineImportBatch, PendingOfflineCustomer
from app.models.user import User, UserRole, UserStatus
from app.models.withdrawal import Withdrawal, WithdrawalStatus
from app.models.zone import Zone
from app.services.bill_config import normalize_phone
from app.services.default_password import new_temporary_password
from app.services.offline_rules import card_key, group_by_phone, withdrawal_amounts

CARD_DAYS = 372

COLUMNS = [
    ("Full name", True), ("Phone number", True), ("Zone", True), ("Card type", True), ("Daily rate (₦)", True),
    ("Days contributed so far", True), ("Days already withdrawn", False), ("Amount withdrawn (₦)", False),
    ("Card start date", False), ("Handled by", False), ("Notes", False),
]


def build_template(zone_names: list[str]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = Workbook()
    ws = wb.active
    ws.title = "Customers"
    widths = [26, 16, 18, 12, 14, 16, 16, 16, 15, 14, 28]
    for i, ((name, req), w) in enumerate(zip(COLUMNS, widths), 1):
        c = ws.cell(row=1, column=i, value=name + (" *" if req else ""))
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="14532D" if req else "475569")
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[chr(64 + i)].width = w
    ws.row_dimensions[1].height = 34
    z0 = zone_names[0] if zone_names else "Zone A"
    ex = [("Ada Obi", "08031234567", z0, "Regular", 500, 120, 30, None, "2026-03-02", "Self", "Example — delete me"),
          ("Musa Bello", "07068881234", z0, "Food", 1000, 45, 0, None, "2026-08-15", "Officer", "Example — delete me")]
    for r, row in enumerate(ex, 2):
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = Font(italic=True, color="6B7280")
    for r in range(2, 502):
        ws.cell(row=r, column=2).number_format = "@"
        ws.cell(row=r, column=9).number_format = "yyyy-mm-dd"
    dvs = [
        (f'"{",".join(zone_names)}"' if zone_names and len(",".join(zone_names)) < 250 else None, "C"),
        ('"Regular,Food"', "D"), ('"Self,Officer"', "J"),
    ]
    for f, col in dvs:
        if f:
            dv = DataValidation(type="list", formula1=f, allow_blank=True)
            ws.add_data_validation(dv)
            dv.add(f"{col}2:{col}501")
    ws.freeze_panes = "C2"
    info = wb.create_sheet("How to fill", 0)
    lines = ["MonieKing — offline customer import", "",
             "1. One row per customer card. Columns marked * are required. Delete the two grey example rows first.",
             "2. Zone must match a zone that exists in the app (pick from the dropdown).",
             "3. Phone: 11 digits (08031234567). This links the record when the customer signs up.",
             "4. Card type: Regular or Food. A customer with several cards (any mix, even the same type) gets one row per card, all with the same phone. If two of their cards are completely identical, write Card 2, Card 3 in Notes so they are not mistaken for a duplicate.",
             "5. Days contributed so far: the days marked on their paper card (0–372).",
             "6. Withdrawals: if they already took money out, fill 'Days already withdrawn' (or 'Amount withdrawn'). Those days show as withdrawn and the balance is correct.",
             "7. Handled by: Self (they have a phone and use the app) or Officer (an officer in the zone handles their card). Blank = Self. Officer customers get their account straight away and appear under the zone's officer.",
             "8. Bank details and next of kin are NOT needed — the customer enters them when signing up.",
             "", "The app shows a preview with every problem listed before anything is saved."]
    for i, t in enumerate(lines, 1):
        c = info.cell(row=i, column=1, value=t)
        if i == 1:
            c.font = Font(bold=True, size=14, color="14532D")
    info.column_dimensions["A"].width = 120
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _num(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        f = float(str(v).replace(",", "").replace("₦", "").strip())
    except ValueError:
        raise ValueError("not a number")
    return f


def _date(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v).strip()[:10])
    except ValueError:
        raise ValueError("date must look like 2026-03-02")


def validate_row(raw: dict, zones: dict[str, uuid.UUID]) -> dict:
    """raw: header -> value. Returns a clean dict with `errors` (list)."""
    errs: list[str] = []
    name = str(raw.get("Full name") or "").strip()
    if len(name) < 2:
        errs.append("Full name is missing")
    phone = normalize_phone(str(raw.get("Phone number") or ""))
    if not phone:
        errs.append("Phone must be a valid 11-digit Nigerian number")
    zone_txt = str(raw.get("Zone") or "").strip()
    zone_id = zones.get(zone_txt.lower())
    if not zone_id:
        errs.append(f"Zone '{zone_txt}' doesn't exist" if zone_txt else "Zone is missing")
    ct = str(raw.get("Card type") or "").strip().lower()
    if ct not in ("regular", "food"):
        errs.append("Card type must be Regular or Food")
    rate = days = dw = None
    try:
        r = _num(raw.get("Daily rate (₦)"))
        if r is None or r <= 0 or r != int(r):
            errs.append("Daily rate must be a whole number of naira")
        else:
            rate = int(r) * 100
    except ValueError:
        errs.append("Daily rate must be a number")
    try:
        d = _num(raw.get("Days contributed so far"))
        if d is None or d < 0 or d > CARD_DAYS or d != int(d):
            errs.append(f"Days contributed must be a whole number from 0 to {CARD_DAYS}")
        else:
            days = int(d)
    except ValueError:
        errs.append("Days contributed must be a number")
    withdrawn_days = 0
    withdrawn_kobo = 0
    try:
        dw = _num(raw.get("Days already withdrawn"))
        amt = _num(raw.get("Amount withdrawn (₦)"))
        if dw is not None and (dw < 0 or dw != int(dw)):
            errs.append("Days already withdrawn must be a whole number")
        elif dw is not None:
            withdrawn_days = int(dw)
        if amt is not None and amt < 0:
            errs.append("Amount withdrawn can't be negative")
        elif amt is not None and rate:
            amt_kobo = int(round(amt * 100))
            if dw is None:
                if amt_kobo % rate:
                    errs.append("Amount withdrawn isn't a whole number of days at this daily rate")
                else:
                    withdrawn_days = amt_kobo // rate
            elif amt_kobo != withdrawn_days * rate:
                errs.append("Amount withdrawn doesn't match days withdrawn × daily rate")
        if rate:
            withdrawn_kobo = withdrawn_days * rate
        if days is not None and withdrawn_days > days:
            errs.append("Days withdrawn can't be more than days contributed")
    except ValueError:
        errs.append("Withdrawal columns must be numbers")
    start = None
    try:
        start = _date(raw.get("Card start date"))
    except ValueError as e:
        errs.append(str(e))
    hb = str(raw.get("Handled by") or "Self").strip().lower() or "self"
    if hb not in ("self", "officer"):
        errs.append("Handled by must be Self or Officer")
    return {
        "full_name": name, "phone_number": phone, "zone_id": zone_id, "zone_name": zone_txt, "card_type": ct,
        "rate_kobo": rate, "days_contributed": days, "days_withdrawn": withdrawn_days, "withdrawn_kobo": withdrawn_kobo,
        "start_date": start, "handled_by": hb, "notes": (str(raw.get("Notes") or "").strip() or None), "errors": errs,
    }


async def zone_map(db: AsyncSession) -> dict[str, uuid.UUID]:
    return {z.name.lower(): z.id for z in (await db.execute(select(Zone))).scalars().all()}


def read_sheet(data: bytes) -> list[tuple[int, dict]]:
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise ValueError("That isn't an Excel (.xlsx) file")
    ws = wb["Customers"] if "Customers" in wb.sheetnames else wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise ValueError("The sheet is empty")
    heads = [str(h or "").replace(" *", "").strip() for h in rows[0]]
    if "Full name" not in heads or "Phone number" not in heads:
        raise ValueError("Use the template from this page — the header row is missing 'Full name' and 'Phone number'")
    out = []
    for i, row in enumerate(rows[1:], 2):
        d = {h: v for h, v in zip(heads, row)}
        if not any(v not in (None, "") for v in d.values()):
            continue
        if str(d.get("Notes") or "").lower().startswith("example"):
            continue
        out.append((i, d))
    return out


async def waiting_duplicate(db: AsyncSession, v: dict) -> bool:
    """Is exactly this card already waiting? (Same person, type, rate, days, start date and notes.)
    A person may have many cards, so only a complete match counts as a duplicate."""
    P = PendingOfflineCustomer
    q = select(P.id).where(P.phone_number == v["phone_number"], P.card_type == v["card_type"], P.rate_kobo == v["rate_kobo"],
                           P.days_contributed == v["days_contributed"], P.days_withdrawn == v["days_withdrawn"], P.claimed_at.is_(None))
    q = q.where(P.start_date == v["start_date"]) if v.get("start_date") else q.where(P.start_date.is_(None))
    notes = (v.get("notes") or "").strip().lower()
    q = q.where(func.lower(func.coalesce(P.notes, "")) == notes)
    return (await db.execute(q.limit(1))).first() is not None


async def preview(db: AsyncSession, data: bytes) -> dict:
    zones = await zone_map(db)
    rows = read_sheet(data)
    if len(rows) > 1000:
        raise ValueError("Please upload at most 1,000 rows at a time")
    seen: set[tuple] = set()
    out, ok = [], 0
    for line, raw in rows:
        v = validate_row(raw, zones)
        if v["phone_number"] and v["card_type"] and not v["errors"]:
            key = card_key(v)
            if key in seen:
                v["errors"].append("This exact card appears twice in the file. If it is a real second identical card, write 'Card 2' in Notes")
            seen.add(key)
            if await waiting_duplicate(db, v):
                v["errors"].append("An identical card is already waiting from an earlier import. If it is a real second identical card, write 'Card 2' in Notes")
        user = (await db.execute(select(User).where(User.phone_number == v["phone_number"]))).scalar_one_or_none() if v["phone_number"] else None
        v["existing_user"] = user.full_name if user else None
        v["line"] = line
        v["ok"] = not v["errors"]
        ok += 1 if v["ok"] else 0
        out.append(v)
    return {"rows": out, "ok": ok, "bad": len(out) - ok, "total": len(out)}


def _public(v: dict) -> dict:
    return {k: (str(x) if isinstance(x, (uuid.UUID, date)) else x) for k, x in v.items() if k != "zone_id"} | {"zone_id": str(v["zone_id"]) if v.get("zone_id") else None}


async def commit(db: AsyncSession, *, data: bytes, filename: str | None, director_id: uuid.UUID) -> dict:
    pv = await preview(db, data)
    if pv["bad"] or not pv["rows"]:
        raise ValueError("Fix the problems in the preview first — nothing was saved.")
    return await stage_rows(db, rows=pv["rows"], source="excel", filename=filename, director_id=director_id)


async def stage_rows(db: AsyncSession, *, rows: list[dict], source: str, filename: str | None, director_id: uuid.UUID) -> dict:
    batch = OfflineImportBatch(id=uuid.uuid4(), created_by=director_id, source=source, filename=filename, row_count=len(rows))
    db.add(batch)
    await db.flush()
    linked = 0
    staged = []
    for v in rows:
        p = PendingOfflineCustomer(
            batch_id=batch.id, phone_number=v["phone_number"], full_name=v["full_name"], zone_id=v["zone_id"], card_type=v["card_type"],
            rate_kobo=v["rate_kobo"], days_contributed=v["days_contributed"], days_withdrawn=v["days_withdrawn"], withdrawn_kobo=v["withdrawn_kobo"],
            start_date=v["start_date"], handled_by=v["handled_by"], notes=v["notes"], created_by=director_id,
        )
        db.add(p)
        staged.append(p)
    await db.flush()
    # Anyone who has ALREADY signed up gets their record attached right now.
    for p in staged:
        user = (await db.execute(select(User).where(User.phone_number == p.phone_number))).scalar_one_or_none()
        if user:
            await _attach(db, p, user)
            linked += 1
    return {"batch_id": str(batch.id), "staged": len(staged), "linked_now": linked}


async def officer_for_zone(db: AsyncSession, zone_id: uuid.UUID) -> User | None:
    """The officer who covers this zone now (the one assigned longest if there are several)."""
    return (await db.execute(select(User).where(User.role == UserRole.OFFICER, User.zone_id == zone_id, User.status == UserStatus.ACTIVE)
                             .order_by(User.created_at).limit(1))).scalars().first()


async def _attach(db: AsyncSession, p: PendingOfflineCustomer, user: User) -> ContributionCard:
    from app.services.card_service import recompute_card_completion_status
    if p.zone_id:
        user.zone_id = p.zone_id
    if p.handled_by == "officer" and not user.managing_officer_id and p.zone_id:
        officer = await officer_for_zone(db, p.zone_id)
        if officer:
            user.managing_officer_id = officer.id
    days, wd, rate = p.days_contributed, p.days_withdrawn, p.rate_kobo
    created = datetime.combine(p.start_date, datetime.min.time(), tzinfo=timezone.utc) if p.start_date else datetime.now(timezone.utc)
    card = ContributionCard(
        owner_id=user.id, card_type=CardType(p.card_type), rate_kobo=rate,
        total_days_contributed=days, total_contributed_kobo=(days - wd) * rate, created_at=created,
    )
    db.add(card)
    await db.flush()
    await db.refresh(card)

    withdrawal = None
    if wd:
        requested, charge, net = withdrawal_amounts(rate, wd)   # the normal charge, so it counts as profit
        withdrawal = Withdrawal(
            customer_id=user.id, card_id=card.id, requested_amount_kobo=requested, charge_kobo=charge, net_payable_kobo=net,
            bank_name="Offline record", account_number="-", account_name=user.full_name, status=WithdrawalStatus.PAID,
            claimed_by_director_id=p.created_by, claimed_at=created, processed_at=created,
        )
        db.add(withdrawal)
        await db.flush()
    for n in range(1, days + 1):
        db.add(ContributionRecord(
            card_id=card.id, logical_month=((n - 1) // 31) + 1, logical_day=((n - 1) % 31) + 1, amount_kobo=rate,
            contributed_by=p.created_by, method=ContributionMethod.CASH_VIA_OFFICER, reference=f"OFFLINE-{card.card_number}-D{n:03d}",
            is_withdrawn=n <= wd, withdrawal_id=withdrawal.id if (withdrawal and n <= wd) else None, created_at=created,
        ))
    if days >= CARD_DAYS:
        card.status = CardStatus.ARCHIVED if wd >= CARD_DAYS else CardStatus.COMPLETED
        card.completed_at = created
        await db.flush()
        await recompute_card_completion_status(db, card)
    p.claimed_user_id = user.id
    p.claimed_at = datetime.now(timezone.utc)
    await db.flush()
    return card


async def claim_for_user(db: AsyncSession, user: User) -> int:
    """Called after a customer signs up (or an officer registers them). Returns how many cards were attached."""
    rows = (await db.execute(
        select(PendingOfflineCustomer).where(PendingOfflineCustomer.phone_number == user.phone_number,
                                             PendingOfflineCustomer.claimed_at.is_(None)).with_for_update()
    )).scalars().all()
    n = 0
    for p in rows:
        await _attach(db, p, user)
        n += 1
    if n:
        try:
            from app.services.notification_service import send_notification
            from app.models.notification import NotificationType
            await send_notification(
                db, user_id=user.id, title="Your savings record is here",
                body=f"We found {n} existing card{'s' if n > 1 else ''} from before you joined. Everything you saved offline is on your account.",
                type=NotificationType.SUCCESS, deep_link_url="/customer/cards",
            )
        except Exception as e:  # noqa: BLE001
            print(f"[offline-claim] notification failed (non-fatal): {e}")
    return n


async def undo_batch(db: AsyncSession, batch_id: uuid.UUID) -> dict:
    batch = await db.get(OfflineImportBatch, batch_id)
    if not batch:
        raise ValueError("Import not found")
    if batch.undone_at:
        raise ValueError("This import was already undone")
    claimed = (await db.execute(select(func.count()).select_from(PendingOfflineCustomer).where(
        PendingOfflineCustomer.batch_id == batch_id, PendingOfflineCustomer.claimed_at.is_not(None)))).scalar_one()
    res = await db.execute(PendingOfflineCustomer.__table__.delete().where(
        PendingOfflineCustomer.batch_id == batch_id, PendingOfflineCustomer.claimed_at.is_(None)))
    batch.undone_at = datetime.now(timezone.utc)
    return {"removed": res.rowcount, "already_claimed_kept": claimed}


async def create_officer_customers(db: AsyncSession, *, director_id: uuid.UUID, phones: set[str] | None = None) -> dict:
    """Officer-handled customers who have no account yet get one straight away, in their zone, under that zone's
    officer, so they show up in the officer's customer list instead of sitting in a waiting list nobody can see.
    A temporary password is generated for each (the director can hand it over; cash customers may never log in).
    Returns {created: [...], failed: [...]}. Safe to run again: only people still waiting are touched."""
    from app.core.security import hash_password
    from app.services.wallet_service import get_or_create_wallet
    from app.utils.supabase_admin_client import supabase_admin_request

    P = PendingOfflineCustomer
    q = select(P).where(P.handled_by == "officer", P.claimed_at.is_(None)).order_by(P.created_at)
    if phones is not None:
        if not phones:
            return {"created": [], "failed": []}
        q = q.where(P.phone_number.in_(phones))
    rows = (await db.execute(q)).scalars().all()
    created, failed = [], []
    for phone, group in group_by_phone(list(rows)).items():
        first = group[0]
        if (await db.execute(select(User.id).where(User.phone_number == phone))).first():
            continue   # they already have an account; their cards were attached when it was found
        pw = new_temporary_password()   # random one-time password; the person must change it at first login
        try:
            resp = await supabase_admin_request(
                "POST", "/auth/v1/admin/users",
                json={"email": f"{phone}@monieking.app", "password": pw, "email_confirm": True,
                      "user_metadata": {"full_name": first.full_name, "phone": phone}},
                failure_detail="Could not create this customer's account right now.")
            uid = uuid.UUID(resp.json()["id"])
            officer = await officer_for_zone(db, first.zone_id)
            async with db.begin_nested():
                user = User(id=uid, role=UserRole.CUSTOMER, full_name=first.full_name, phone_number=phone, is_manual_customer=True,
                            managing_officer_id=officer.id if officer else None, zone_id=first.zone_id, created_by=director_id,
                            login_password_hash=hash_password(pw), must_change_password=True)
                db.add(user)
                await db.flush()
                await get_or_create_wallet(db, user.id)
                cards = await claim_for_user(db, user)
            zone = await db.get(Zone, first.zone_id)
            created.append({"full_name": first.full_name, "phone_number": phone, "zone": zone.name if zone else "",
                            "officer": officer.full_name if officer else None, "cards": cards, "temporary_password": pw})
        except Exception as e:  # noqa: BLE001 - one bad person must not stop the rest
            failed.append({"full_name": first.full_name, "phone_number": phone, "reason": str(getattr(e, "detail", None) or e)[:160]})
    return {"created": created, "failed": failed}
