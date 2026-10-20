"""Cooperative: member endpoints added in Modules 10b-10e (bank details, closing, consents, complaints, dividends, statements)."""
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.coop import approvals, bank, cases, ops, safety, service, settings_store, yearend
from app.coop.errors import CoopError
from app.coop.models import CoopCase, CoopLoan, CoopRequest
from app.coop.safety import AuthBody
from app.coop.settings_store import Rules
from app.core.database import get_db
from app.core.dependencies import CurrentUser
from app.api.v1.routes.coop import Ctx, AuthOnly

router = APIRouter(prefix="/coop", tags=["coop"])


class BankBody(BaseModel):
    bank_code: str
    account_number: str
    bank_name: Optional[str] = None


class KinBody(BaseModel):
    name: str
    relationship: str
    phone: str
    address: Optional[str] = None


class AgreeBody(BaseModel):
    agree: bool


class ComplaintBody(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=3, max_length=4000)
    category: str = "other"
    loan_id: Optional[uuid.UUID] = None


class DisputeBody(BaseModel):
    body: str = Field(min_length=3, max_length=2000)


# ── bank details ──
@router.get("/bank")
async def get_bank(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return {"bank": bank.as_dict(await bank.get(db, m.id)),
            "profile_bank": {"bank_name": user.bank_name, "account_number": user.account_number, "account_name": user.account_name} if user.account_number else None}


@router.put("/bank")
async def put_bank(body: BankBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    b = await bank.save(db, m, user, body.bank_code, body.account_number, body.bank_name)
    return {"bank": bank.as_dict(b)}


@router.post("/bank/from-profile")
async def bank_from_profile(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return {"bank": bank.as_dict(await bank.from_profile(db, m, user))}


# ── closing the membership ──
@router.get("/close")
async def close_preview(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return {**await service.close_preview(db, rules, m), "step_up": safety.step_up_needed(rules, "member")}


@router.post("/close")
async def close(body: AuthOnly, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db),
                idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")):
    m = await service.require_member(db, user)

    async def run():
        await safety.require_step_up(db, rules, user, body.auth, "member")
        return await service.close_membership(db, rules, m, user.id)
    return await safety.idempotent(db, user, idempotency_key, "close", run)


# ── next of kin ──
@router.get("/next-of-kin")
async def get_kin(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return {"next_of_kin": m.next_of_kin}


@router.put("/next-of-kin")
async def put_kin(body: KinBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return {"next_of_kin": await cases.set_next_of_kin(db, m, user, body.name, body.relationship, body.phone, body.address)}


# ── re-consent to a restructure ──
@router.get("/consents")
async def my_consents(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    out = []
    for r in (await db.execute(select(CoopRequest).where(CoopRequest.status == "pending", CoopRequest.kind == "restructure"))).scalars().all():
        mine = [c for c in r.consents if c["member_id"] == str(m.id) and c["status"] == "pending"]
        if not mine:
            continue
        v = await approvals.view(db, r)
        loan = await db.get(CoopLoan, r.loan_id)
        out.append({"request_id": v["id"], "your_role": mine[0]["role"], "loan_no": v["loan_no"], "new_term_months": r.payload.get("new_term_months"),
                    "reason": r.reason, "principal_kobo": loan.principal_kobo, "total_kobo": loan.total_kobo, "old_term_months": loan.term_months})
    return out


@router.post("/consents/{request_id}")
async def answer_consent(request_id: uuid.UUID, body: AgreeBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    r = await approvals.consent(db, rules, request_id, user, body.agree)
    return {"status": r.status}


# ── complaints desk ──
@router.get("/complaints")
async def my_complaints(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return [await cases.case_view(db, c, for_member=True) for c in await cases.list_cases(db, kind="complaint", member_id=m.id)]


@router.get("/complaints/{case_id}")
async def complaint_thread(case_id: uuid.UUID, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    c = await db.get(CoopCase, case_id)
    if not c or c.kind != "complaint" or c.member_id != m.id:
        raise CoopError("Complaint not found", 404)
    return await cases.case_view(db, c, for_member=True)


class ChatBody(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


@router.post("/complaints/{case_id}/messages")
async def complaint_message(case_id: uuid.UUID, body: ChatBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    c = await cases.member_message(db, rules, m, user, case_id, body.body)
    return await cases.case_view(db, c, for_member=True)


@router.post("/complaints")
async def new_complaint(body: ComplaintBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    c = await cases.submit_complaint(db, rules, m, user, body.subject, body.body, body.category, body.loan_id)
    return await cases.case_view(db, c, for_member=True)


# ── dividends and disputes ──
@router.get("/dividends")
async def my_dividends(user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return await yearend.member_dividends(db, rules, m)


@router.post("/dividends/{run_id}/dispute")
async def dispute(run_id: uuid.UUID, body: DisputeBody, user: CurrentUser, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    d = await yearend.open_dispute(db, rules, m, user, run_id, body.body)
    return {"id": str(d.id), "status": d.status}


# ── statements ──
@router.get("/statement")
async def statement(user: CurrentUser, year: Optional[int] = None, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    return await yearend.member_statement(db, rules, m, user, year or rules.today().year)


@router.get("/statement.pdf")
async def statement_pdf(user: CurrentUser, year: Optional[int] = None, rules: Rules = Ctx, db: AsyncSession = Depends(get_db)):
    m = await service.require_member(db, user)
    st = await yearend.member_statement(db, rules, m, user, year or rules.today().year)
    return Response(yearend.statement_pdf(st), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="monieking-coop-statement-{st["year"]}.pdf"'})


# ── scheduler hook: call from a Railway cron with the shared secret ──
@router.post("/jobs/run")
async def run_jobs_secret(x_coop_job_secret: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    if not ops.job_secret_ok(x_coop_job_secret):
        raise CoopError("Not allowed", 403)
    rules = await settings_store.load_rules(db)
    return await ops.run_jobs(db, rules, force=True)
