import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, BigInteger, Integer, SmallInteger, ForeignKey, DateTime, Enum, Boolean, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class CardType(str, enum.Enum):
    REGULAR = "regular"
    FOOD    = "food"


class CardStatus(str, enum.Enum):
    ACTIVE    = "active"
    COMPLETED = "completed"
    CONVERTED = "converted"
    ARCHIVED  = "archived"


class CardCompletionStatus(str, enum.Enum):
    PAID               = "paid"
    UNPAID             = "unpaid"
    PARTIALLY_PAID     = "partially_paid"
    WITHDRAWAL_PENDING = "withdrawal_pending"   # legacy — never actually set; kept only so old rows/migrations referencing it don't break


class ContributionMethod(str, enum.Enum):
    DIGITAL          = "digital"
    CASH_VIA_OFFICER = "cash_via_officer"


class ContributionCard(Base):
    __tablename__ = "contribution_cards"

    id:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Short, human-friendly public identifier (e.g. 1000, 1001, ...) —
    # shown in the URL bar and UI instead of the UUID `id` above. Assigned
    # by the DB sequence `card_number_seq` (server_default here means
    # SQLAlchemy leaves it out of the INSERT and lets Postgres fill it in,
    # then reads it back via RETURNING).
    card_number: Mapped[int] = mapped_column(
        Integer, unique=True, index=True, nullable=False,
        server_default=text("nextval('card_number_seq')"),
    )

    card_type:  Mapped[CardType]   = mapped_column(Enum(CardType,   name="card_type",   values_callable=lambda x: [e.value for e in x]),   nullable=False)
    rate_kobo:  Mapped[int]        = mapped_column(BigInteger, nullable=False)   # immutable after creation

    total_days_contributed: Mapped[int] = mapped_column(Integer, default=0)
    total_contributed_kobo: Mapped[int] = mapped_column(BigInteger, default=0)

    status:            Mapped[CardStatus]           = mapped_column(Enum(CardStatus, name="card_status", values_callable=lambda x: [e.value for e in x]), default=CardStatus.ACTIVE)
    completion_status: Mapped[CardCompletionStatus | None] = mapped_column(Enum(CardCompletionStatus, name="card_completion_status", values_callable=lambda x: [e.value for e in x]), nullable=True)

    food_eligibility_lost_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at:  Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at:Mapped[datetime | None]= mapped_column(DateTime(timezone=True), nullable=True)

    owner:   Mapped["User"]                   = relationship("User", back_populates="cards")
    records: Mapped[list["ContributionRecord"]]= relationship("ContributionRecord", back_populates="card", order_by="ContributionRecord.logical_month, ContributionRecord.logical_day")


class ContributionRecord(Base):
    __tablename__ = "contribution_records"

    id:      Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    card_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contribution_cards.id", ondelete="CASCADE"), nullable=False)

    logical_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)   # 1–12
    logical_day:   Mapped[int] = mapped_column(SmallInteger, nullable=False)   # 1–31
    amount_kobo:   Mapped[int] = mapped_column(BigInteger, nullable=False)

    contributed_by: Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    method:         Mapped[ContributionMethod] = mapped_column(Enum(ContributionMethod, name="contribution_method", values_callable=lambda x: [e.value for e in x]), nullable=False)
    reference:      Mapped[str]               = mapped_column(String(100), unique=True, nullable=False)

    is_withdrawn: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Which withdrawal marked this record withdrawn — the precise link a
    # rejection needs to know exactly what to reverse. Null until a
    # withdrawal touches this record; cleared again if that withdrawal is
    # later rejected (the record becomes available again).
    withdrawal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("withdrawals.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    card: Mapped["ContributionCard"] = relationship("ContributionCard", back_populates="records")
