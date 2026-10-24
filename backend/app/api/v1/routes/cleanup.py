"""Director cleanup centre: export users, mark test accounts, preview and purge them, reset launch statistics,
reconcile money. Every destructive step needs the director's PIN and a typed confirmation."""
import io
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, text, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.models.user import User, UserRole
from app.services import purge_service
from app.services.pin_service import check_pin
from app.utils.audit import log_action

router = APIRouter(prefix="/cleanup", tags=["cleanup"])

TEST_WORDS = re.compile(r"\b(test|demo|fake|dummy|sample|asdf|qwerty|trial)\b", re.I)


def _guess(name: str, phone: str, cards: int, wallet_kobo: int, role: str) -> str:
    if TEST_WORDS.search(name or ""):
        return "Test"
    digits = re.sub(r"\D", "", phone or "")
    if len(set(digits[-8:])) <= 2:          # 08011111111, 08000000001 ...
        return "Test"
    if role == "customer" and cards == 0 and wallet_kobo == 0:
        return "Not sure"
    return "Real"


@router.get("/summary")
async def summary(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text("SELECT role::text, is_test, count(*) FROM users GROUP BY 1, 2"))).all()
    out = {"test": 0, "real": 0, "by_role": {}}
    for role, is_test, n in rows:
        out["test" if is_test else "real"] += n
        out["by_role"].setdefault(role, {"test": 0, "real": 0})["test" if is_test else "real"] += n
    return out


@router.get("/users.xlsx")
async def export_users(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.worksheet.datavalidation import DataValidation

    res = await db.execute(text("""
        SELECT u.id::text, u.full_name, u.phone_number, u.role::text, COALESCE(z.name,'') AS zone, u.status::text, u.created_at, u.is_test,
               (SELECT count(*) FROM contribution_cards c WHERE c.owner_id = u.id) AS cards,
               COALESCE((SELECT SUM(w.balance_kobo) FROM wallets w WHERE w.owner_id = u.id),0) AS wallet,
               COALESCE((SELECT SUM(c.total_contributed_kobo) FROM contribution_cards c WHERE c.owner_id = u.id),0) AS contributed
          FROM users u LEFT JOIN zones z ON z.id = u.zone_id ORDER BY u.role::text, u.created_at
    """))
    wb = Workbook()
    ws = wb.active
    ws.title = "Users"
    heads = ["Classify (Real / Test)", "Full name", "Phone", "Role", "Zone", "Status", "Created", "Cards", "Wallet (₦)", "On cards (₦)", "User ID (do not edit)"]
    widths = [22, 28, 16, 11, 16, 12, 12, 8, 13, 13, 40]
    for i, (h, w) in enumerate(zip(heads, widths), 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="14532D" if i == 1 else "475569")
        c.alignment = Alignment(horizontal="center", wrap_text=True)
        ws.column_dimensions[chr(64 + i)].width = w
    for r, row in enumerate(res.all(), 2):
        uid, name, phone, role, zone, status, created, is_test, cards, wallet, contributed = row
        if uid == str(director.id):
            mark = "Real"
        elif is_test:
            mark = "Test"
        else:
            mark = _guess(name, phone, cards, wallet, role)
        vals = [mark, name, phone, role, zone, status, created.date().isoformat() if created else "", cards, wallet / 100, contributed / 100, uid]
        for c, v in enumerate(vals, 1):
            ws.cell(row=r, column=c, value=v)
        ws.cell(row=r, column=3).number_format = "@"
    dv = DataValidation(type="list", formula1='"Real,Test,Not sure"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f"A2:A{ws.max_row + 500}")
    ws.freeze_panes = "C2"
    info = wb.create_sheet("How to use")
    for i, line in enumerate([
        "1. In column A choose Real or Test for every person. 'Not sure' leaves that person unchanged.",
        "2. Pre-filled values are only guesses (names like 'test', repeating phone numbers). Check every row.",
        "3. Don't touch the User ID column. Upload the file back on the Cleanup page.",
        "4. Uploading only MARKS accounts. Nothing is deleted until you review the preview and confirm with your PIN.",
        "5. Anyone marked Test who still has wallet money or card balance is flagged before deletion.",
    ], 1):
        info.cell(row=i, column=1, value=line)
    info.column_dimensions["A"].width = 110
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="MonieKing-Users-Review.xlsx"'})


@router.post("/mark")
async def mark_from_excel(director: DirectorOnly, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(await file.read()), read_only=True, data_only=True)
        ws = wb["Users"] if "Users" in wb.sheetnames else wb.active
    except Exception:
        raise HTTPException(status_code=400, detail="That doesn't look like the Users review Excel file.")
    rows = list(ws.iter_rows(values_only=True))
    if not rows or not rows[0] or "Classify" not in str(rows[0][0] or ""):
        raise HTTPException(status_code=400, detail="Use the file downloaded from this page — the first column must be 'Classify'.")
    marked_test, marked_real, unchanged, bad = [], [], 0, []
    for i, row in enumerate(rows[1:], 2):
        if not row or len(row) < 11 or not row[10]:
            continue
        label = str(row[0] or "").strip().lower()
        try:
            uid = uuid.UUID(str(row[10]).strip())
        except ValueError:
            bad.append(f"Row {i}: unreadable User ID")
            continue
        if label == "test":
            if uid == director.id:
                bad.append(f"Row {i}: you can't mark your own account as a test account")
                continue
            marked_test.append(uid)
        elif label == "real":
            marked_real.append(uid)
        else:
            unchanged += 1
    if marked_test:
        await db.execute(update(User).where(User.id.in_(marked_test)).values(is_test=True))
    if marked_real:
        await db.execute(update(User).where(User.id.in_(marked_real)).values(is_test=False))
    await log_action(db, actor_id=director.id, action="cleanup.marked", entity_type="user", entity_id="bulk",
                     new_value={"test": len(marked_test), "real": len(marked_real)})
    await db.commit()
    return {"marked_test": len(marked_test), "marked_real": len(marked_real), "unchanged": unchanged, "problems": bad}


class TestFlag(BaseModel):
    is_test: bool


@router.patch("/users/{user_id}/test")
async def flag_one(user_id: uuid.UUID, body: TestFlag, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    if user_id == director.id and body.is_test:
        raise HTTPException(status_code=400, detail="You can't mark your own account as a test account")
    r = await db.execute(update(User).where(User.id == user_id).values(is_test=body.is_test))
    if not r.rowcount:
        raise HTTPException(status_code=404, detail="User not found")
    await db.commit()
    return {"is_test": body.is_test}


async def _test_ids(db: AsyncSession, director_id: uuid.UUID) -> list[uuid.UUID]:
    return list((await db.execute(select(User.id).where(User.is_test.is_(True), User.id != director_id))).scalars().all())


@router.get("/preview")
async def preview(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    ids = await _test_ids(db, director.id)
    plan = await purge_service.build_plan(db, ids)
    out = purge_service.summarize(plan)
    names = (await db.execute(select(User.full_name, User.phone_number, User.role).where(User.id.in_(ids)).order_by(User.full_name).limit(300))).all()
    out["people"] = [{"full_name": n, "phone_number": p, "role": r.value if hasattr(r, "value") else str(r)} for n, p, r in names]
    out["confirm_phrase"] = purge_service.CONFIRM_PHRASE
    return out


class PurgeBody(BaseModel):
    confirm_phrase: str
    pin: str
    backup_confirmed: bool = False
    acknowledge_value: bool = False


@router.post("/purge")
async def purge(body: PurgeBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    if body.confirm_phrase.strip() != purge_service.CONFIRM_PHRASE:
        raise HTTPException(status_code=400, detail=f"Type {purge_service.CONFIRM_PHRASE} exactly to confirm.")
    if not body.backup_confirmed:
        raise HTTPException(status_code=400, detail="Confirm that you have taken a database backup first.")
    await check_pin(db, director, body.pin)
    ids = await _test_ids(db, director.id)
    if not ids:
        raise HTTPException(status_code=400, detail="No accounts are marked as test accounts.")
    plan = await purge_service.build_plan(db, ids)
    if plan.conflicts:
        raise HTTPException(status_code=409, detail="Some test data is tied to real data. Review the preview.")
    if plan.value_users and not body.acknowledge_value:
        raise HTTPException(status_code=409, detail="Some test accounts still hold money. Tick the acknowledgement to continue.")

    try:
        result = await purge_service.purge(db, test_user_ids=ids, director_id=director.id)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    # Remove the logins LAST and only if everything above worked, so the phone numbers can be registered again.
    from app.utils.supabase_admin_client import supabase_admin_request
    for uid in ids:
        await supabase_admin_request(
            "DELETE", f"/auth/v1/admin/users/{uid}", ok_statuses=(200, 204), not_found_ok=True,
            failure_detail="Could not remove a login account. Nothing was deleted — please try again.",
        )
    await log_action(db, actor_id=director.id, action="cleanup.purged", entity_type="user", entity_id="bulk",
                     new_value={"users": result["users"], "rows": result["deleted"]})
    await db.commit()
    return {"message": f"{result['users']} test accounts removed", **result}


class ResetBody(BaseModel):
    confirm_phrase: str
    pin: str
    analytics: bool = True
    notifications: bool = True
    health_history: bool = True
    broadcasts: bool = True
    disputes: bool = True


@router.post("/reset-stats")
async def reset_stats(body: ResetBody, director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    if body.confirm_phrase.strip() != "RESET STATISTICS":
        raise HTTPException(status_code=400, detail="Type RESET STATISTICS exactly to confirm.")
    await check_pin(db, director, body.pin)
    plan = []
    if body.analytics:
        plan += ["analytics_events", "promo_banner_events"]
    if body.notifications:
        plan += ["notifications"]
    if body.health_history:
        plan += ["health_check_results", "health_alert_state"]
    if body.broadcasts:
        plan += ["broadcasts"]
    if body.disputes:
        plan += ["disputes"]   # their messages go with them
    cleared = {}
    for t in plan:
        try:
            async with db.begin_nested():
                r = await db.execute(text(f'DELETE FROM "{t}"'))
                cleared[t] = r.rowcount
        except Exception:
            cleared[t] = -1   # table missing or in use: skipped, reported
    await log_action(db, actor_id=director.id, action="cleanup.stats_reset", entity_type="system", entity_id="stats", new_value=cleared)
    await db.commit()
    return {"message": "Statistics restarted", "cleared": cleared}


@router.get("/reconcile")
async def reconcile(director: DirectorOnly, db: AsyncSession = Depends(get_db)):
    """Money sanity check: wallet balances vs their transactions, card days vs records, card balance vs unwithdrawn days."""
    wallets = (await db.execute(text("""
        SELECT w.id::text, u.full_name, w.balance_kobo,
               COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount_kobo ELSE -t.amount_kobo END), 0) AS ledger
          FROM wallets w JOIN users u ON u.id = w.owner_id LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
         GROUP BY w.id, u.full_name, w.balance_kobo HAVING w.balance_kobo <> COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount_kobo ELSE -t.amount_kobo END), 0)
         LIMIT 100"""))).all()
    days = (await db.execute(text("""
        SELECT c.card_number, u.full_name, c.total_days_contributed, count(r.id) AS recs
          FROM contribution_cards c JOIN users u ON u.id = c.owner_id LEFT JOIN contribution_records r ON r.card_id = c.id
         GROUP BY c.id, c.card_number, u.full_name, c.total_days_contributed HAVING c.total_days_contributed <> count(r.id) LIMIT 100"""))).all()
    bal = (await db.execute(text("""
        SELECT c.card_number, u.full_name, c.total_contributed_kobo,
               COALESCE(SUM(CASE WHEN r.is_withdrawn THEN 0 ELSE r.amount_kobo END), 0) AS expected
          FROM contribution_cards c JOIN users u ON u.id = c.owner_id LEFT JOIN contribution_records r ON r.card_id = c.id
         GROUP BY c.id, c.card_number, u.full_name, c.total_contributed_kobo
        HAVING c.total_contributed_kobo <> COALESCE(SUM(CASE WHEN r.is_withdrawn THEN 0 ELSE r.amount_kobo END), 0) LIMIT 100"""))).all()
    issues = (
        [{"kind": "wallet", "who": r[1], "detail": f"balance ₦{r[2]/100:,.2f} but transactions add up to ₦{r[3]/100:,.2f}"} for r in wallets]
        + [{"kind": "card_days", "who": r[1], "detail": f"card #{r[0]} says {r[2]} days but has {r[3]} day records"} for r in days]
        + [{"kind": "card_balance", "who": r[1], "detail": f"card #{r[0]} balance ₦{r[2]/100:,.2f} but unwithdrawn days are worth ₦{r[3]/100:,.2f}"} for r in bal]
    )
    return {"clean": not issues, "issues": issues, "checked_at": datetime.now(timezone.utc).isoformat()}
