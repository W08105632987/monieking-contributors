"""ORM models for the cooperative. Source of truth for the DDL: supabase/migrations/045_coop_foundation.sql"""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now():
    return datetime.now(timezone.utc)


def _uuid():
    return uuid.uuid4()


class CoopSetting(Base):
    __tablename__ = "coop_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class CoopSettingChange(Base):
    __tablename__ = "coop_setting_changes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str] = mapped_column(Text, nullable=False)
    effect: Mapped[str] = mapped_column(String(20), nullable=False)
    effective_on: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    proposed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CoopSettingChangeApproval(Base):
    __tablename__ = "coop_setting_change_approvals"
    __table_args__ = (UniqueConstraint("change_id", "director_id", name="coop_setting_change_approvals_uq"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    change_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_setting_changes.id", ondelete="CASCADE"), nullable=False)
    director_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopPilotMember(Base):
    __tablename__ = "coop_pilot_members"
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    added_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopMember(Base):
    __tablename__ = "coop_members"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    card_no: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    nin_bypassed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    disqualified_year: Mapped[int | None] = mapped_column(Integer)
    pool_listed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pool_offer_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    pool_whatsapp_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pool_note: Mapped[str | None] = mapped_column(String(300))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fee_paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_of_kin: Mapped[dict | None] = mapped_column(JSONB)
    death_flagged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CoopLoan(Base):
    __tablename__ = "coop_loans"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    loan_no: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"), nullable=False)
    purpose: Mapped[str | None] = mapped_column(String(200))
    principal_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    term_months: Mapped[int] = mapped_column(Integer, nullable=False)
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    interest_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    overdue_daily_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    overdue_cap_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overdue_grace_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cover_pct: Mapped[int] = mapped_column(Integer, nullable=False)
    approvals_required: Mapped[int] = mapped_column(Integer, nullable=False)
    schedule: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    flags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="seeking_guarantors")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    principal_paid_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    interest_paid_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    charges_paid_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    offer_fee_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    net_payout_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    offer_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payout_status: Mapped[str | None] = mapped_column(String(20))
    payout_ref: Mapped[str | None] = mapped_column(String(120))
    payout_evidence: Mapped[str | None] = mapped_column(Text)
    payout_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    paid_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payout_account: Mapped[dict | None] = mapped_column(JSONB)
    payout_hold_reason: Mapped[str | None] = mapped_column(String(300))
    repay_source: Mapped[str] = mapped_column(String(20), nullable=False, default="contribution_auto")
    final_due_rule: Mapped[str] = mapped_column(String(30), nullable=False, default="after_final_due_date")
    clock_rule: Mapped[str] = mapped_column(String(20), nullable=False, default="payout")
    written_off_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    waived_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    restructured_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CoopLoanApproval(Base):
    __tablename__ = "coop_loan_approvals"
    __table_args__ = (UniqueConstraint("loan_id", "director_id", name="coop_loan_approvals_uq"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    loan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_loans.id", ondelete="CASCADE"), nullable=False)
    director_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopContractVersion(Base):
    __tablename__ = "coop_contract_versions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    version: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopGuarantee(Base):
    __tablename__ = "coop_guarantees"
    __table_args__ = (UniqueConstraint("loan_id", "guarantor_id", name="coop_guarantees_loan_guarantor_uq"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    loan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_loans.id", ondelete="CASCADE"), nullable=False)
    guarantor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"), nullable=False)
    amount_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="invited")
    invited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    contract_version: Mapped[str | None] = mapped_column(String(30))
    contract_text: Mapped[str | None] = mapped_column(Text)
    contract_hash: Mapped[str | None] = mapped_column(String(64))
    ticks: Mapped[dict | None] = mapped_column(JSONB)
    sign_ip: Mapped[str | None] = mapped_column(String(64))
    sign_agent: Mapped[str | None] = mapped_column(String(300))


class CoopJournal(Base):
    __tablename__ = "coop_journal"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"))
    ledger: Mapped[str] = mapped_column(String(30), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    delta_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance_after: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    loan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_loans.id"))
    guarantee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_guarantees.id"))
    reference: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    accounting_year: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reverses_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("coop_journal.id"))
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopEvent(Base):
    __tablename__ = "coop_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(60))
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    data: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ── Modules 10b-10e (migration 047) ──────────────────────────────────────────
class CoopMemberBank(Base):
    __tablename__ = "coop_member_bank"
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id", ondelete="CASCADE"), primary_key=True)
    bank_code: Mapped[str] = mapped_column(String(20), nullable=False)
    bank_name: Mapped[str | None] = mapped_column(String(100))
    account_number: Mapped[str] = mapped_column(String(20), nullable=False)
    account_name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_match: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    name_note: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopRequest(Base):
    __tablename__ = "coop_requests"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"))
    loan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_loans.id"))
    ref_id: Mapped[str | None] = mapped_column(String(60))
    amount_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    reason: Mapped[str | None] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    needed: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    consents: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[dict | None] = mapped_column(JSONB)


class CoopRequestVote(Base):
    __tablename__ = "coop_request_votes"
    __table_args__ = (UniqueConstraint("request_id", "director_id", name="coop_request_votes_uq"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_requests.id", ondelete="CASCADE"), nullable=False)
    director_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopCase(Base):
    __tablename__ = "coop_cases"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    member_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"))
    loan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_loans.id"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(40))
    opened_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    opened_auto: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution: Mapped[str | None] = mapped_column(Text)


class CoopCaseNote(Base):
    __tablename__ = "coop_case_notes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_cases.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="note")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visible_to_member: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopDividendRun(Base):
    __tablename__ = "coop_dividend_runs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="prepared")
    pool_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    contribution_pool_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    guarantee_pool_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    distributable_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    carry_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    payout_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="wallet")
    prepared_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    reconciled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_requests.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    report: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopDividendLine(Base):
    __tablename__ = "coop_dividend_lines"
    __table_args__ = (UniqueConstraint("run_id", "member_id", name="coop_dividend_lines_uq"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_dividend_runs.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"), nullable=False)
    contribution_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    guarantee_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    qualified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(String(200))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CoopDividendDispute(Base):
    __tablename__ = "coop_dividend_disputes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_dividend_runs.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_members.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    resolution: Mapped[str | None] = mapped_column(Text)
    adjust_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CoopExpense(Base):
    __tablename__ = "coop_expenses"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    amount_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    spent_on: Mapped[date] = mapped_column(Date, nullable=False)
    evidence: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_requests.id"))
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopIdempotency(Base):
    __tablename__ = "coop_idempotency"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    endpoint: Mapped[str] = mapped_column(String(120), nullable=False)
    response: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopJobRun(Base):
    __tablename__ = "coop_job_runs"
    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    last_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_result: Mapped[dict | None] = mapped_column(JSONB)


class CoopSent(Base):
    __tablename__ = "coop_sent"
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CoopReconciliation(Base):
    __tablename__ = "coop_reconciliations"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    checks: Mapped[list] = mapped_column(JSONB, nullable=False)
    position: Mapped[dict | None] = mapped_column(JSONB)


class CoopSweep(Base):
    __tablename__ = "coop_sweeps"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_kobo: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(String(300))
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coop_requests.id"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
