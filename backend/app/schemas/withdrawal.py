from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional
import uuid
from datetime import datetime
from app.models.withdrawal import WithdrawalStatus, WithdrawalSource


class WithdrawalRequest(BaseModel):
    card_id:     uuid.UUID
    amount_kobo: int
    auth_method: str   # "password" | "biometric"
    withdrawal_password: Optional[str] = None
    webauthn_assertion:  Optional[dict] = None

    @field_validator("amount_kobo")
    @classmethod
    def positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Amount must be positive")
        return v


class WalletWithdrawalRequest(BaseModel):
    amount_kobo: int
    auth_method: str   # "password" | "biometric"
    withdrawal_password: Optional[str] = None
    webauthn_assertion:  Optional[dict] = None

    @field_validator("amount_kobo")
    @classmethod
    def positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Amount must be positive")
        return v


class RejectWithdrawalRequest(BaseModel):
    reason: str


class WithdrawalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:                    uuid.UUID
    customer_id:           uuid.UUID
    card_id:               Optional[uuid.UUID]
    source:                WithdrawalSource
    requested_amount_kobo: int
    charge_kobo:           int
    net_payable_kobo:      int
    bank_name:             str
    account_number:        str
    account_name:          str
    status:                WithdrawalStatus
    claimed_by_director_id:Optional[uuid.UUID]
    claimed_at:            Optional[datetime]
    processed_at:          Optional[datetime]
    rejection_reason:      Optional[str]
    requested_at:          datetime
    customer_name:         Optional[str] = None
    customer_avatar_url:   Optional[str] = None
    # Only populated by the wallet-withdrawal endpoint (source=WALLET) —
    # the authoritative post-debit balance, straight from the same
    # locked row this transaction just wrote to. Lets the frontend
    # update the wallet balance on screen immediately from this
    # response, instead of a separate GET /wallets/me the UI would
    # otherwise have to wait on.
    wallet_balance_kobo:   Optional[int] = None