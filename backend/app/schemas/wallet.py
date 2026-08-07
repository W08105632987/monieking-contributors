from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional
import uuid
from datetime import datetime
from app.models.wallet import TxType, TxCategory


class WalletResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:                    uuid.UUID
    owner_id:              uuid.UUID
    balance_kobo:          int
    virtual_account_number:Optional[str]
    virtual_account_bank:  Optional[str]
    is_frozen:             bool
    created_at:            datetime


class WalletTransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:                uuid.UUID
    wallet_id:         uuid.UUID
    type:              TxType
    category:          TxCategory
    amount_kobo:       int
    balance_after_kobo:int
    reference:         str
    description:       Optional[str]
    related_card_id:   Optional[uuid.UUID]
    initiated_by:      uuid.UUID
    created_at:        datetime


class PaginatedTransactions(BaseModel):
    data:      list[WalletTransactionResponse]
    total:     int
    page:      int
    page_size: int
    has_next:  bool


class WalletSummaryResponse(BaseModel):
    total_in_kobo:  int
    total_out_kobo: int
    range_label:    str
