"""Recovery case files (overdue loans), the complaints desk, and next-of-kin details."""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import audit, service
from app.coop.errors import CoopError
from app.coop.models import CoopCase, CoopCaseNote, CoopLoan, CoopMember
from app.coop.service import naira, notify
from app.coop.settings_store import Rules
from app.models.user import User

RECOVERY_STEPS = ("call", "sms", "letter", "visit", "guarantor_notice", "payment_plan", "legal", "note")
COMPLAINT_CATEGORIES = ("loan", "contribution", "withdrawal", "dividend", "guarantee", "payout", "other")


async def open_recovery(db: AsyncSession, rules: Rules, loan_id, director: Optional[User], auto: bool = False) -> CoopCase:
    loan = await db.get(CoopLoan, loan_id)
    if not loan:
        raise CoopError("Loan not found", 404)
    pos = service.position(loan, rules.today())
    if loan.status != "repaying" or not pos["overdue"]:
        raise CoopError("A recovery case is for an overdue loan that is still being repaid", 409)
    dup = (await db.execute(select(CoopCase).where(CoopCase.loan_id == loan.id, CoopCase.kind == "recovery", CoopCase.status != "closed"))).scalars().first()
    if dup:
        if auto:
            return dup
        raise CoopError("This loan already has an open recovery case", 409)
    case = CoopCase(kind="recovery", member_id=loan.member_id, loan_id=loan.id, subject=f"Recovery: {loan.loan_no}",
                    body=f"{pos['overdue_days']} day(s) overdue. {naira(pos['total_due_kobo'])} owed.", opened_by=director.id if director else None, opened_auto=auto)
    db.add(case)
    await db.flush()
    db.add(CoopCaseNote(case_id=case.id, author_id=director.id if director else None, kind="note",
                        body="Case opened automatically because the loan is overdue." if auto else "Case opened by a director."))
    await audit.record(db, "case", case.id, "recovery_opened", director.id if director else None, {"loan": loan.loan_no, "auto": auto})
    if auto:
        await service.notify_directors(db, rules, "Recovery case opened", f"{loan.loan_no} is overdue. A recovery case was opened.")
    return case


async def add_note(db: AsyncSession, case_id, author: User, kind: str, body: str, visible: bool = False) -> CoopCaseNote:
    case = await db.get(CoopCase, case_id)
    if not case:
        raise CoopError("Case not found", 404)
    if case.status == "closed":
        raise CoopError("This case is closed", 409)
    if kind not in RECOVERY_STEPS + ("response",):
        raise CoopError("Unknown step type")
    if not (body or "").strip():
        raise CoopError("Write what was done")
    n = CoopCaseNote(case_id=case.id, author_id=author.id, kind=kind, body=body.strip()[:2000], visible_to_member=visible)
    db.add(n)
    if case.kind == "recovery" and kind == "legal":
        case.status = "escalated"
    await db.flush()
    await audit.record(db, "case", case.id, f"note_{kind}", author.id)
    return n


async def close_case(db: AsyncSession, rules: Rules, case_id, director: User, resolution: str) -> CoopCase:
    case = await db.get(CoopCase, case_id)
    if not case or case.status == "closed":
        raise CoopError("This case is already closed", 409)
    if not (resolution or "").strip():
        raise CoopError("Write the resolution")
    case.status, case.closed_at, case.resolution = "closed", rules.now(), resolution.strip()[:2000]
    await audit.record(db, "case", case.id, "closed", director.id, {"resolution": case.resolution})
    if case.kind == "complaint" and case.member_id:
        m = await db.get(CoopMember, case.member_id)
        await notify(db, m.user_id, "Your complaint was resolved", case.resolution[:200], "/coop/complaints")
    return case


async def submit_complaint(db: AsyncSession, rules: Rules, m: CoopMember, user: User, subject: str, body: str, category: str, loan_id=None) -> CoopCase:
    if not (subject or "").strip() or not (body or "").strip():
        raise CoopError("Please write a subject and say what happened")
    if category not in COMPLAINT_CATEGORIES:
        category = "other"
    if loan_id:
        loan = await db.get(CoopLoan, loan_id)
        if not loan or loan.member_id != m.id:
            loan_id = None
    case = CoopCase(kind="complaint", member_id=m.id, loan_id=loan_id, subject=subject.strip()[:200], body=body.strip()[:4000], category=category,
                    opened_by=user.id, due_at=rules.now() + timedelta(days=int(rules.get("complaint_response_days"))))
    db.add(case)
    await db.flush()
    await audit.record(db, "case", case.id, "complaint_submitted", user.id, {"category": category})
    await service.notify_directors(db, rules, "New complaint", f"{user.full_name}: {case.subject}")
    return case


async def respond(db: AsyncSession, rules: Rules, case_id, director: User, body: str) -> CoopCase:
    case = await db.get(CoopCase, case_id)
    if not case or case.kind != "complaint" or case.status == "closed":
        raise CoopError("This complaint cannot be answered", 409)
    await add_note(db, case.id, director, "response", body, visible=True)
    case.status = "answered"
    m = await db.get(CoopMember, case.member_id)
    await notify(db, m.user_id, "The directors replied to your complaint", body[:200], "/coop/complaints")
    return case


async def case_view(db: AsyncSession, case: CoopCase, for_member: bool = False) -> dict:
    notes = (await db.execute(select(CoopCaseNote).where(CoopCaseNote.case_id == case.id).order_by(CoopCaseNote.created_at))).scalars().all()
    m = await db.get(CoopMember, case.member_id) if case.member_id else None
    mu = await db.get(User, m.user_id) if m else None
    loan = await db.get(CoopLoan, case.loan_id) if case.loan_id else None
    out = {"id": str(case.id), "kind": case.kind, "status": case.status, "subject": case.subject, "body": case.body, "category": case.category,
           "loan_no": loan.loan_no if loan else None, "loan_id": str(case.loan_id) if case.loan_id else None,
           "created_at": case.created_at.isoformat(), "due_at": case.due_at.isoformat() if case.due_at else None,
           "closed_at": case.closed_at.isoformat() if case.closed_at else None, "resolution": case.resolution}
    ns = []
    for n in notes:
        if for_member and not n.visible_to_member:
            continue
        au = await db.get(User, n.author_id) if n.author_id else None
        ns.append({"id": str(n.id), "kind": n.kind, "body": n.body, "author": au.full_name if au else "System", "at": n.created_at.isoformat(),
                   "visible_to_member": n.visible_to_member})
    out["notes"] = ns
    if not for_member:
        out["member"] = {"id": str(m.id), "name": mu.full_name, "card_no": m.card_no, "phone": mu.phone_number} if m else None
        out["opened_auto"] = case.opened_auto
        if loan and case.kind == "recovery":
            pos = service.position(loan, (await _rules(db)).today())
            out["loan"] = {"principal_kobo": loan.principal_kobo, "total_due_kobo": pos["total_due_kobo"], "overdue_days": pos["overdue_days"],
                           "due_date": loan.due_date.isoformat() if loan.due_date else None}
    return out


async def list_cases(db: AsyncSession, kind: Optional[str] = None, status: Optional[str] = None, member_id=None) -> list[CoopCase]:
    q = select(CoopCase).order_by(CoopCase.created_at.desc()).limit(200)
    if kind:
        q = q.where(CoopCase.kind == kind)
    if status == "open":
        q = q.where(CoopCase.status != "closed")
    elif status:
        q = q.where(CoopCase.status == status)
    if member_id:
        q = q.where(CoopCase.member_id == member_id)
    return list((await db.execute(q)).scalars().all())


async def auto_open_recovery(db: AsyncSession, rules: Rules) -> int:
    days = int(rules.get("recovery_auto_open_days"))
    if days <= 0:
        return 0
    n = 0
    for loan in (await db.execute(select(CoopLoan).where(CoopLoan.status == "repaying"))).scalars().all():
        pos = service.position(loan, rules.today())
        if pos["overdue_days"] >= days:
            before = (await db.execute(select(func.count()).select_from(CoopCase).where(CoopCase.loan_id == loan.id, CoopCase.kind == "recovery"))).scalar_one()
            if not before:
                await open_recovery(db, rules, loan.id, None, auto=True)
                n += 1
    return n


# ── next of kin ──────────────────────────────────────────────────────────
async def set_next_of_kin(db: AsyncSession, m: CoopMember, user: User, name: str, relationship: str, phone: str, address: Optional[str]) -> dict:
    if not (name or "").strip() or not (relationship or "").strip() or not (phone or "").strip():
        raise CoopError("Enter the name, relationship and phone number")
    m.next_of_kin = {"name": name.strip()[:120], "relationship": relationship.strip()[:60], "phone": phone.strip()[:30], "address": (address or "").strip()[:200]}
    await audit.record(db, "member", m.id, "next_of_kin_saved", user.id)
    return m.next_of_kin


async def _rules(db: AsyncSession):
    from app.coop import settings_store
    return await settings_store.load_rules(db)
