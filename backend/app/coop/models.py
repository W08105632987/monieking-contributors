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
