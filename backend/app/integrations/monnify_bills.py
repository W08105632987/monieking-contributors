"""
Monnify Bills Payment integration — airtime, data, electricity, cable TV.
Reuses the SAME merchant account/auth as monnify.py (Reserved Accounts);
this is a second product under one existing relationship, not a new vendor.

Flow per Monnify's docs (developers.monnify.com/docs/bills-payment):
  Discovery  -> get_biller_categories() / get_billers() / get_biller_products()
  Validation -> validate_customer() — the response's vendInstruction says
                whether a validationReference is required for the vend
                (requireValidationRef true/false). This is what powers the
                "Is this you?" screen for electricity/cable.
  Vending    -> vend_bill() — the actual charge. Include validationReference
                only when the validation response said it is required.
  Requery    -> requery_bill() — status check when a vend response is
                ambiguous (timeout, IN_PROGRESS etc), so we never guess
                at whether a customer was actually charged.

All endpoints live under /api/v1/vas/bills-payment (BILLS_PREFIX below).
The earlier /api/v1/billers/... paths do not exist on Monnify and returned
404 "Not Found" for every call.
"""
import logging
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from app.core.config import settings
from app.integrations.monnify import get_payment_provider

logger = logging.getLogger(__name__)

BILLS_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=15.0, pool=5.0)

# Every Bills Payment endpoint lives under this prefix.
BILLS_PREFIX = "/api/v1/vas/bills-payment"

# Discovery lists can be paged. We ask for big pages and keep going until a
# page adds nothing new, so a catalogue larger than one page is never
# silently truncated (electricity alone has 12+ DISCOs).
PAGE_SIZE = 100
MAX_PAGES = 50


class MonnifyBillsError(Exception):
    """
    Raised on any failure talking to the bills provider.

    retriable  — worth trying again later (network trouble, 5xx, 429).
    ambiguous  — we CANNOT be sure whether Monnify processed the request
                 (read timeout, connection dropped mid-flight, 5xx on a
                 POST). For a vend this means the customer may or may not
                 have been charged, so the caller must NOT treat it as a
                 clean failure — it must requery before refunding or
                 retrying. False means the request definitely did not
                 complete (couldn't connect, or Monnify rejected it with a
                 4xx), so the caller can safely treat it as failed.
    """
    def __init__(self, message: str, *, retriable: bool = False, ambiguous: bool = False):
        self.message = message
        self.retriable = retriable
        self.ambiguous = ambiguous
        super().__init__(message)


def vend_outcome(result: dict) -> str:
    """
    Collapse a vend / requery response into exactly one of:
      "SUCCESS" — Monnify confirms the bill was paid
      "FAILED"  — Monnify confirms it was NOT paid (safe to refund)
      "PENDING" — in progress, unknown, or unrecognised (do NOT refund,
                  do NOT mark complete; requery later)

    Anything we don't positively recognise is PENDING, never SUCCESS —
    handing over airtime/tokens on a guess is how money gets lost.
    """
    if not isinstance(result, dict):
        return "PENDING"
    raw = str(result.get("vendStatus") or result.get("status") or "").strip().upper().replace("-", "_").replace(" ", "_")
    if raw in ("SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID"):
        return "SUCCESS"
    if raw in ("FAILED", "FAILURE", "REVERSED", "REJECTED", "ERROR", "CANCELLED", "EXPIRED"):
        return "FAILED"
    if raw not in ("IN_PROGRESS", "PENDING", "PROCESSING", "INITIATED", "AWAITING_PROCESSING"):
        logger.warning("[monnify-bills] Unrecognised vend status %r — treating as pending. Body: %s", raw, result)
    return "PENDING"


class MonnifyBillsProvider:
    """
    Thin wrapper around MonnifyProvider's existing auth (_get_access_token /
    _headers) — deliberately composes rather than duplicates that logic, so
    a token-handling fix in monnify.py doesn't need a parallel fix here.

    Uses the shared MonnifyProvider singleton so the access token is cached
    and reused across every bills call (a fresh MonnifyProvider per call
    meant a fresh Monnify login on every single request).
    """

    def __init__(self):
        self._base = get_payment_provider()
        self.base_url = settings.MONNIFY_BASE_URL

    async def _headers(self) -> dict:
        return await self._base._headers()

    async def _request(self, method: str, path: str, *, _auth_retry: bool = True, **kwargs):
        """
        Raises MonnifyBillsError on any failure — network-level (timeout,
        can't connect), auth-level, or provider-level (4xx, requestSuccessful
        =false) — never fastapi.HTTPException. This method runs from real
        FastAPI endpoints AND from plain scripts (sync_billers.py) that have
        no HTTP request to attach a status code to; raising a framework
        exception outside an actual request just produces an unhandled
        crash there instead of a clean caught error.
        """
        try:
            headers = await self._headers()
        except HTTPException as e:
            # Auth/login problems surface from monnify.py as HTTPException.
            raise MonnifyBillsError(str(e.detail), retriable=e.status_code in (503, 504))

        try:
            async with httpx.AsyncClient(timeout=BILLS_TIMEOUT) as client:
                resp = await client.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as e:
            # The request never reached Monnify — definitely not processed.
            raise MonnifyBillsError(
                f"Could not reach the bills provider ({type(e).__name__}). This is almost always a network "
                "reachability problem (wrong MONNIFY_BASE_URL for this environment, or your server's IP isn't "
                "whitelisted with Monnify for live use). Please try again.",
                retriable=True, ambiguous=False,
            )
        except httpx.TimeoutException:
            # Sent, but no answer in time — Monnify may well have processed it.
            raise MonnifyBillsError(
                "The bills provider did not answer in time. The request may still have been processed.",
                retriable=True, ambiguous=True,
            )
        except httpx.TransportError as e:
            # Connection dropped / protocol error mid-flight.
            raise MonnifyBillsError(
                f"Connection to the bills provider was interrupted ({type(e).__name__}). "
                "The request may still have been processed.",
                retriable=True, ambiguous=True,
            )

        if resp.status_code == 401 and _auth_retry:
            # Token expired/revoked early. A 401 means Monnify rejected the
            # request before doing anything, so one retry with a fresh token
            # is always safe, even for a vend.
            self._base._access_token = None
            return await self._request(method, path, _auth_retry=False, **kwargs)

        try:
            body = resp.json()
        except ValueError:
            # A gateway/WAF/auth-layer rejection can come back as plain text
            # or HTML instead of JSON — surface the status and raw text.
            raise MonnifyBillsError(
                f"Bills provider returned a non-JSON response (HTTP {resp.status_code}): {resp.text[:300]}",
                retriable=resp.status_code >= 500,
                ambiguous=resp.status_code >= 500,
            )

        if not isinstance(body, dict):
            raise MonnifyBillsError(
                f"Bills provider returned an unexpected response (HTTP {resp.status_code}): {str(body)[:300]}",
                retriable=resp.status_code >= 500,
                ambiguous=resp.status_code >= 500,
            )

        if resp.status_code >= 400 or not body.get("requestSuccessful", True):
            message = (
                body.get("responseMessage") or body.get("message") or body.get("error")
                or body.get("error_description") or f"HTTP {resp.status_code}, no message field — raw body: {body}"
            )
            logger.warning("[monnify-bills] %s %s -> %s: %s", method, path, resp.status_code, body)
            raise MonnifyBillsError(
                message,
                retriable=resp.status_code >= 500 or resp.status_code == 429,
                # A 5xx on a POST may have been processed before it fell over.
                ambiguous=resp.status_code >= 500,
            )
        return body["responseBody"] if "responseBody" in body else body

    # ── Discovery ─────────────────────────────────────────────────
    @staticmethod
    def _rows(body) -> list[dict]:
        """Pull the list of rows out of either a bare list or a paged object."""
        if isinstance(body, list):
            return [r for r in body if isinstance(r, dict)]
        if isinstance(body, dict):
            for key in ("content", "items", "data", "billers", "products", "categories", "records"):
                value = body.get(key)
                if isinstance(value, list):
                    return [r for r in value if isinstance(r, dict)]
        return []

    @staticmethod
    def _is_empty_page(body) -> bool:
        """A normal paged answer that simply has no rows (e.g. a biller with no products) — not a surprise."""
        if isinstance(body, dict):
            return any(isinstance(body.get(k), list) for k in ("content", "items", "data", "billers", "products", "categories", "records"))
        return isinstance(body, list)

    async def _list_all(self, path: str, id_keys: tuple[str, ...]) -> list[dict]:
        """GET a list endpoint, following pages until one adds nothing new."""
        sep = "&" if "?" in path else "?"
        seen: set[str] = set()
        out: list[dict] = []
        for page in range(MAX_PAGES):
            try:
                body = await self._request("GET", f"{path}{sep}page={page}&size={PAGE_SIZE}")
            except MonnifyBillsError as e:
                if page == 0 and not e.retriable:
                    # The endpoint may not accept paging parameters — fall
                    # back to one plain call rather than failing the sync.
                    body = await self._request("GET", path)
                    rows = self._rows(body)
                    if body and not rows and not self._is_empty_page(body):
                        logger.warning("[monnify-bills] Unrecognised list shape from %s: %s", path, str(body)[:300])
                    return rows
                raise

            rows = self._rows(body)
            if body and not rows and page == 0 and not self._is_empty_page(body):
                logger.warning("[monnify-bills] Unrecognised list shape from %s: %s", path, str(body)[:300])

            new = 0
            for row in rows:
                key = next((str(row[k]) for k in id_keys if row.get(k)), None) or str(sorted(row.items()))
                if key in seen:
                    continue
                seen.add(key)
                out.append(row)
                new += 1
            if new == 0:
                break
            if isinstance(body, dict):
                if body.get("last") is True:
                    break
                total_pages = body.get("totalPages")
                if isinstance(total_pages, int) and page + 1 >= total_pages:
                    break
        return out

    async def get_biller_categories(self) -> list[dict]:
        return await self._list_all(f"{BILLS_PREFIX}/biller-categories", ("code", "categoryCode", "name"))

    async def get_billers(self, category_code: str) -> list[dict]:
        """category_code is Monnify's own category string (e.g.
        "ELECTRICITY", "DATA", "CABLE_TV") — see CATEGORY_CODE_MAP in
        bill_payment_service.py for the mapping from our internal
        lowercase category values.

        Monnify's prose docs call the filter `categoryCode`; at least one
        client library sends `category_code`. Unknown query parameters are
        ignored by the server, so we send both rather than guess."""
        c = quote(category_code, safe="")
        return await self._list_all(
            f"{BILLS_PREFIX}/billers?categoryCode={c}&category_code={c}", ("billerCode", "code"),
        )

    async def get_biller_products(self, biller_code: str) -> list[dict]:
        """get_billers() returns BILLERS (companies, e.g. "Ikeja Electric"),
        not the individual PRODUCTS with a real product code and price.
        Product-level data — what sync_billers needs to populate price_kobo
        and product_code — only comes from this call, filtered by billerCode
        (same dual-parameter reasoning as get_billers)."""
        b = quote(biller_code, safe="")
        return await self._list_all(
            f"{BILLS_PREFIX}/biller-products?billerCode={b}&biller_code={b}", ("productCode", "code"),
        )

    # ── Validation ────────────────────────────────────────────────
    async def validate_customer(self, *, product_code: str, customer_id: str) -> dict:
        """
        Field names (productCode, customerId) match Monnify's documented
        contract. The response carries a `vendInstruction` object whose
        `requireValidationRef` says whether the later vend needs the
        returned validationReference — see bill_payment_service.
        """
        payload = {
            "productCode": product_code,
            "customerId": customer_id,
        }
        return await self._request("POST", f"{BILLS_PREFIX}/validate-customer", json=payload)

    # ── Vending ───────────────────────────────────────────────────
    async def vend_bill(
        self, *, product_code: str, customer_id: str, amount_kobo: int,
        vend_reference: str, validation_reference: Optional[str] = None,
    ) -> dict:
        """
        vendReference is a REQUIRED merchant-supplied field per Monnify's
        docs. It is how Monnify recognises a retried request as "the same
        vend I already processed", which is what prevents duplicate charges
        on a network timeout/retry. Callers MUST pass a stable, unique
        reference — bill_payment_service.py uses the BillPaymentRequest's
        own id, generated before this call and never changing on retry.

        Only send validationReference when the validation step said it is
        required (Monnify: do not send one when requireValidationRef=false).
        """
        payload = {
            "productCode": product_code,
            "customerId": customer_id,
            "vendAmount": round(amount_kobo / 100, 2),   # Naira (decimal), not kobo — e.g. 5000.00
            "vendReference": vend_reference,
        }
        if validation_reference:
            payload["validationReference"] = validation_reference
        return await self._request("POST", f"{BILLS_PREFIX}/vend", json=payload)

    async def requery_bill(self, reference: str) -> dict:
        """Status check only — never charges. `reference` is the Monnify
        transactionReference from the vend response when we have it,
        otherwise our own vendReference."""
        return await self._request("GET", f"{BILLS_PREFIX}/requery?reference={quote(reference, safe='')}")


def get_bills_provider() -> MonnifyBillsProvider:
    return MonnifyBillsProvider()
