"""
Abstract base class for payment providers.
Concrete implementations: MonnifyProvider, PaystackProvider (future), FlutterwaveProvider (future).
Swapping providers requires only a config change — no business logic changes.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class ReservedAccount:
    account_number: str
    bank_name: str
    account_reference: str
    account_name: str
    provider: str


@dataclass
class WebhookEvent:
    transaction_reference: str
    amount_kobo: int
    account_number: str
    status: str          # "PAID" | "FAILED" etc
    provider: str
    raw: dict


@dataclass
class TransferResult:
    reference: str
    status: str           # "SUCCESS" | "PENDING_AUTHORIZATION" | "FAILED"
    fee_kobo: int
    raw: dict


class BasePaymentProvider(ABC):
    """Every payment provider must implement these methods."""

    @abstractmethod
    async def create_reserved_account(
        self,
        *,
        account_reference: str,
        account_name: str,
        customer_email: str,
        customer_name: str,
        bvn: Optional[str] = None,
        nin: Optional[str] = None,
    ) -> ReservedAccount:
        """Provision a dedicated virtual account for a user."""
        ...

    @abstractmethod
    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        """Verify HMAC signature of incoming webhook payload."""
        ...

    @abstractmethod
    def parse_webhook_event(self, payload: dict) -> WebhookEvent:
        """Extract normalised event data from provider-specific payload."""
        ...

    @abstractmethod
    async def get_transaction(self, reference: str) -> Optional[WebhookEvent]:
        """Fetch transaction status for reconciliation / manual retry."""
        ...

    @abstractmethod
    async def initiate_transfer(
        self,
        *,
        amount_kobo: int,
        reference: str,
        narration: str,
        destination_bank_code: str,
        destination_account_number: str,
        destination_account_name: str,
    ) -> TransferResult:
        """Send money out to a bank account (disbursement)."""
        ...
