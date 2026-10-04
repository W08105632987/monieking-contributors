"""
Universal receipt — builds structured, transaction-type-specific detail
for the full-page receipt (web) rather than relying on the free-text
`description` string alone, plus a short, reproducible verification
code printed on the receipt.

Deliberately NOT a dispatch over every possible SQLAlchemy model
scattered inline in the route handler — one function per known
related_entity_type, registered in a lookup table, so adding a new
transaction source later means adding one function here, not editing
a long if/elif chain.
"""
import hashlib
import uuid
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.wallet import WalletTransaction
from app.models.withdrawal import Withdrawal
from app.models.card import ContributionCard
from app.models.manual_service_request import ManualServiceRequest
from app.models.user import User


def build_verification_code(tx: WalletTransaction) -> str:
    """
    Deterministic, reproducible — not stored separately. Derived from
    immutable fields (reference, amount, created_at), so it can always
    be recomputed from the transaction row itself and never drifts out
    of sync with it. Not cryptographic proof of anything by itself;
    it's a basis for a future "verify this receipt" lookup, and signals
    deliberate anti-tamper intent the way a real bank receipt does.
    """
    raw = f"{tx.reference}:{tx.amount_kobo}:{tx.created_at.isoformat()}"
    digest = hashlib.sha256(raw.encode()).hexdigest().upper()
    return f"MK-{digest[:4]}-{digest[4:8]}-{digest[8:12]}"


async def _details_withdrawal(db: AsyncSession, entity_id: uuid.UUID) -> dict[str, Any]:
    row = await db.get(Withdrawal, entity_id)
    if not row:
        return {}
    return {
        "Bank":            row.bank_name,
        "Account number":  row.account_number,
        "Account name":    row.account_name,
        "Charge":          row.charge_kobo,
        "Net paid out":    row.net_payable_kobo,
        "Status":          row.status.value if hasattr(row.status, "value") else str(row.status),
    }


async def _details_contribution_card(db: AsyncSession, entity_id: uuid.UUID) -> dict[str, Any]:
    row = await db.get(ContributionCard, entity_id)
    if not row:
        return {}
    return {
        "Card number": row.card_number,
        "Card type":   row.card_type.value if hasattr(row.card_type, "value") else str(row.card_type),
    }


async def _details_manual_service_request(db: AsyncSession, entity_id: uuid.UUID) -> dict[str, Any]:
    row = await db.get(ManualServiceRequest, entity_id)
    if not row:
        return {}
    details: dict[str, Any] = {
        "Service category": row.service_category.replace("_", " ").title(),
        "Service type":      row.service_type.replace("_", " ").title(),
        "Status":            row.status.value if hasattr(row.status, "value") else str(row.status),
    }
    if row.claimed_by_id:
        worker = await db.get(User, row.claimed_by_id)
        if worker:
            details["Handled by"] = worker.full_name
    return details


async def _details_identity_service(db: AsyncSession, entity_id: uuid.UUID) -> dict[str, Any]:
    from app.models.identity_service import IdentityServiceRequest, IdentityService
    row = await db.get(IdentityServiceRequest, entity_id)
    if not row:
        return {}
    details: dict[str, Any] = {
        "Status": row.status.value if hasattr(row.status, "value") else str(row.status),
    }
    service = await db.get(IdentityService, row.service_id)
    if service:
        details["Service"] = service.name
    return details


async def _details_bill_payment(db: AsyncSession, entity_id: uuid.UUID) -> dict[str, Any]:
    from app.models.bill_payment import BillPaymentRequest, Biller
    row = await db.get(BillPaymentRequest, entity_id)
    if not row:
        return {}
    details: dict[str, Any] = {
        "Recipient/account": row.customer_reference,
        "Status":            row.status.value if hasattr(row.status, "value") else str(row.status),
    }
    if row.validated_account_name:
        details["Account name"] = row.validated_account_name
    if row.token:
        details["Token"] = row.token
    biller = await db.get(Biller, row.biller_id)
    if biller:
        details["Biller"] = biller.name
        details["Product"] = biller.product_name
    return details


# Sources with no separate row to join — the transaction IS the record.
# Handled by returning {} and letting the receipt fall back to the
# transaction's own description/reference, not an error.
_NO_JOIN_NEEDED = {"wallet_funding", "sms_fee"}

_BUILDERS: dict[str, Callable[[AsyncSession, uuid.UUID], Awaitable[dict[str, Any]]]] = {
    "withdrawal":              _details_withdrawal,
    "contribution_card":       _details_contribution_card,
    "manual_service_request":  _details_manual_service_request,
    "identity_service":        _details_identity_service,
    "bill_payment":            _details_bill_payment,
}


async def build_receipt_details(db: AsyncSession, tx: WalletTransaction) -> dict[str, Any]:
    if not tx.related_entity_type:
        return {}
    if tx.related_entity_type in _NO_JOIN_NEEDED:
        return {}
    builder = _BUILDERS.get(tx.related_entity_type)
    if not builder or not tx.related_entity_id:
        return {}
    try:
        return await builder(db, tx.related_entity_id)
    except Exception:
        # A missing/garbled historical row should never break the
        # receipt page — fall back to the transaction's own fields.
        return {}
