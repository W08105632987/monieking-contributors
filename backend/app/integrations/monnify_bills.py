"""
Monnify Bills Payment integration — airtime, data, electricity, cable TV.
Reuses the SAME merchant account/auth as monnify.py (Reserved Accounts);
this is a second product under one existing relationship, not a new vendor.

Flow per Monnify's docs (developers.monnify.com/docs/bills-payment):
  Discovery  -> get_biller_categories() / get_billers()
  Validation -> validate_customer() — REQUIRED before vend when the
                biller's discovery response says requireValidationRef=true
                (this is what powers the "Is this you?" screen for
                electricity/cable). Airtime/data billers don't require it.
  Vending    -> vend_bill() — the actual charge. Include validationReference
                only when the product required one.
  Requery    -> requery_bill() — status check when a vend response is
                ambiguous (timeout, ""processing"" etc), so we never guess
                at whether a customer was actually charged.
"""
import logging
from typing import Optional

import httpx

from app.core.config import settings
from app.integrations.monnify import MonnifyProvider

logger = logging.getLogger(__name__)

BILLS_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=15.0, pool=5.0)


class MonnifyBillsError(Exception):
    """Raised on a confirmed provider-side failure (bad biller, invalid
    reference, insufficient merchant float, etc) — distinct from a network/
    timeout error so the caller can show the customer a real reason rather
    than a generic 'something went wrong'."""
    def __init__(self, message: str, *, retriable: bool = False):
        self.message = message
        self.retriable = retriable
        super().__init__(message)


class MonnifyBillsProvider:
    """
    Thin wrapper around MonnifyProvider's existing auth (_get_access_token /
    _headers) — deliberately composes rather than duplicates that logic, so
    a token-handling fix in monnify.py doesn't need a parallel fix here.
    """

    def __init__(self):
        self._base = MonnifyProvider()
        self.base_url = settings.MONNIFY_BASE_URL

    async def _headers(self) -> dict:
        return await self._base._headers()

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        """
        Raises MonnifyBillsError on any failure — network-level (timeout,
        can't connect) or provider-level (4xx, requestSuccessful=false) —
        never fastapi.HTTPException. This method runs from real FastAPI
        endpoints AND from plain scripts (sync_billers.py) that have no
        HTTP request to attach a status code to; raising a framework
        exception outside an actual request just produces an unhandled
        crash there instead of a clean caught error. Endpoint callers
        translate MonnifyBillsError to an HTTP response themselves (see
        bill_payment_service.py's existing except blocks) exactly the way
        every other provider-error path in this codebase already works.
        """
        try:
            async with httpx.AsyncClient(timeout=BILLS_TIMEOUT) as client:
                resp = await client.request(
                    method, f"{self.base_url}{path}", headers=await self._headers(), **kwargs
                )
        except httpx.TimeoutException:
            raise MonnifyBillsError(
                "Bills provider is taking too long to respond — this is almost always a network reachability "
                "problem (wrong MONNIFY_BASE_URL for this environment, or your server's IP isn't whitelisted "
                "with Monnify for live use) rather than Monnify itself being slow. Please try again.",
                retriable=True,
            )
        except httpx.ConnectError as e:
            raise MonnifyBillsError(f"Could not reach the bills provider ({e}). Please try again.", retriable=True)

        try:
            body = resp.json()
        except ValueError:
            # A gateway/WAF/auth-layer rejection (e.g. a 401/403) can come
            # back as plain text or an HTML page instead of JSON — surface
            # the actual status and raw text rather than crashing on
            # .json(), which would otherwise turn "your credentials were
            # rejected" into an unrelated-looking parse error.
            raise MonnifyBillsError(
                f"Bills provider returned a non-JSON response (HTTP {resp.status_code}): {resp.text[:300]}",
                retriable=resp.status_code >= 500,
            )

        if resp.status_code >= 400 or not body.get("requestSuccessful", True):
            # Try every field name Monnify (or an error at a different
            # layer — a gateway, a WAF) might plausibly use for the
            # human-readable reason, and fall back to the raw body/status
            # rather than a made-up generic string. A generic fallback
            # here was actively hiding the real reason from you on every
            # rejection so far — this is what should have shipped from
            # the start.
            message = (
                body.get("responseMessage") or body.get("message") or body.get("error")
                or body.get("error_description") or f"HTTP {resp.status_code}, no message field — raw body: {body}"
            )
            retriable = resp.status_code >= 500
            logger.warning(f"[monnify-bills] {method} {path} -> {resp.status_code}: {body}")
            raise MonnifyBillsError(message, retriable=retriable)
        return body.get("responseBody", body)

    # ── Discovery ─────────────────────────────────────────────────
    async def get_biller_categories(self) -> list[dict]:
        return await self._request("GET", "/api/v1/billers/categories")

    async def get_billers(self, category_code: str) -> list[dict]:
        """category_code is Monnify's own category string (e.g.
        "ELECTRICITY", "DATA", "CABLE_TV") — see CATEGORY_CODE_MAP in
        bill_payment_service.py for the mapping from our internal
        lowercase category values."""
        return await self._request("GET", f"/api/v1/billers?categoryCode={category_code}")

    async def get_biller_products(self, biller_code: str) -> list[dict]:
        """The discovery step our integration was missing entirely —
        get_billers() above returns BILLERS (companies, e.g. "Ikeja
        Electric"), not the individual PRODUCTS with a real price and
        product code (e.g. "IKEDC_PREPAID"). Per Monnify's own
        documented flow, product-level data — what sync_billers
        actually needs to populate price_kobo and product_code — only
        comes from this third call, filtered by billerCode."""
        return await self._request("GET", f"/api/v1/billers/products?billerCode={biller_code}")

    # ── Validation ────────────────────────────────────────────────
    async def validate_customer(self, *, product_code: str, customer_id: str) -> dict:
        """
        Field names below (productCode, customerId) match Monnify's
        documented contract and a real working integration's example
        call (confirmed via developers.monnify.com/docs/bills-payment/
        process-a-bill and the monnify-laravel package's actual
        validateCustomer() call) — NOT the previous version of this
        method, which sent billerId/productId/customerReference and
        would have failed validation against the real API the moment
        live credentials were used. Re-verify the exact response shape
        against your own sandbox call before fully trusting
        result.get("customerName") below — Monnify's docs describe the
        `vendInstruction` object generically without pinning down every
        field name in the surrounding response.
        """
        payload = {
            "productCode": product_code,
            "customerId": customer_id,
        }
        return await self._request("POST", "/api/v1/billers/validate-customer", json=payload)

    # ── Vending ───────────────────────────────────────────────────
    async def vend_bill(
        self, *, product_code: str, customer_id: str, amount_kobo: int,
        vend_reference: str, validation_reference: Optional[str] = None,
    ) -> dict:
        """
        Same field-name correction as validate_customer, plus one more
        that matters even more: vendReference is a REQUIRED merchant-
        supplied field per Monnify's docs, and the previous version of
        this method never sent one at all. Without it, Monnify has no
        way to recognize a retried request as "the same vend I already
        processed" — exactly the kind of gap that causes duplicate
        charges on a network timeout/retry, the same category of bug
        already fixed once this project in wallet_service.py. Callers
        MUST pass a stable, unique reference — bill_payment_service.py
        uses the BillPaymentRequest's own id, which is generated before
        this call and never changes on retry.
        """
        payload = {
            "productCode": product_code,
            "customerId": customer_id,
            "vendAmount": amount_kobo / 100,   # confirmed Naira (decimal), not kobo — e.g. 5000.00
            "vendReference": vend_reference,
        }
        if validation_reference:
            payload["validationReference"] = validation_reference
        return await self._request("POST", "/api/v1/billers/vend", json=payload)

    async def requery_bill(self, transaction_reference: str) -> dict:
        return await self._request("GET", f"/api/v1/billers/vend/{transaction_reference}")


def get_bills_provider() -> MonnifyBillsProvider:
    return MonnifyBillsProvider()
