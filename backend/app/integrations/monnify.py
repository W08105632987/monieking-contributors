"""
Monnify Reserved Accounts integration.
Primary payment provider for MonieKing Contributors.
"""
import hashlib
import hmac
import base64
import time
import logging
from typing import Optional

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.integrations.base_payment_provider import (
    BasePaymentProvider, ReservedAccount, WebhookEvent, TransferResult
)

MONNIFY_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0)


class MonnifyProvider(BasePaymentProvider):

    def __init__(self):
        self.base_url   = settings.MONNIFY_BASE_URL
        self.api_key    = settings.MONNIFY_API_KEY
        self.secret_key = settings.MONNIFY_SECRET_KEY
        self.contract_code = settings.MONNIFY_CONTRACT_CODE
        self._access_token: str | None = None
        # Was previously cached forever after the first fetch — Monnify
        # tokens expire (~1hr), so every request after that silently
        # started failing with a 401 from Monnify until the process was
        # restarted. That's the "works fine this minute, breaks the
        # next" pattern for anything payment-related (including new
        # customer registration, which provisions a virtual account).
        self._token_expires_at: float = 0.0

    @property
    def is_sandbox(self) -> bool:
        """True when MONNIFY_BASE_URL points at Monnify's sandbox host.
        Callers (webhooks.py) use this to decide how to treat a missing
        'monnify-signature' header — see verify_webhook_signature below
        for why sandbox never sends one at all."""
        return "sandbox" in self.base_url.lower()

    # ── Auth ──────────────────────────────────────────────────────
    async def _get_access_token(self) -> str:
        credentials = base64.b64encode(
            f"{self.api_key}:{self.secret_key}".encode()
        ).decode()
        try:
            async with httpx.AsyncClient(timeout=MONNIFY_TIMEOUT) as client:
                resp = await client.post(
                    f"{self.base_url}/api/v1/auth/login",
                    headers={"Authorization": f"Basic {credentials}"},
                )
                resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Payment provider is taking too long to respond. Please try again.")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Could not reach the payment provider. Please try again.")
        except httpx.HTTPStatusError:
            raise HTTPException(status_code=502, detail="Payment provider rejected our credentials. Please contact support.")

        body = resp.json()["responseBody"]
        # Refresh a minute early rather than cutting it exactly at expiry.
        expires_in = body.get("expiresIn", 3600)
        self._token_expires_at = time.monotonic() + max(expires_in - 60, 60)
        return body["accessToken"]

    async def _headers(self) -> dict:
        if not self._access_token or time.monotonic() >= self._token_expires_at:
            self._access_token = await self._get_access_token()
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

    # ── Identity verification (BVN / NIN) ───────────────────────────
    # These two endpoints are Monnify's LIVE-ONLY verification services —
    # they don't exist on sandbox at all, so this will 404/fail there by
    # design until real credentials are in place. That's expected, not a
    # bug: there's nothing to verify against in sandbox.
    #
    # Monnify's own docs are inconsistent across versions about the exact
    # response shape — an older reference shows granular per-field match
    # info (name/DOB/mobile each with their own status), while the
    # current docs describe a single boolean. We check for both here
    # rather than assume one, so this doesn't silently break if the live
    # response turns out to use the shape we didn't expect.
    async def verify_bvn(self, *, bvn: str, name: str, date_of_birth: str, mobile_no: str) -> bool:
        """Returns True if the supplied details are an acceptable match
        for the BVN record (full or partial match both count — legitimate
        users routinely get partial matches over things like middle names
        or spacing differences)."""
        payload = {"bvn": bvn, "name": name, "dateOfBirth": date_of_birth, "mobileNo": mobile_no}
        return await self._run_verification("/api/v1/vas/bvn-details-match", payload, bool_field="bvnInformationMatch")

    async def verify_nin(self, *, nin: str) -> bool:
        """Returns True if the NIN is valid and verifiable.
        NOTE: the exact endpoint path below is our best-informed guess
        based on Monnify's established /api/v1/vas/ naming convention for
        this family of endpoints (bvn-account-match, bvn-details-match) —
        we could not get 100% confirmation of the literal NIN path from
        public docs (their interactive API reference is JS-rendered and
        not scrapeable). If this 404s once live keys are in, that's the
        signal to grab the exact path from the Monnify dashboard's API
        reference or ask integration-support@monnify.com, and it's a
        one-line fix here.
        """
        payload = {"nin": nin}
        return await self._run_verification("/api/v1/vas/nin-details-match", payload, bool_field="ninInformationMatch")

    async def _run_verification(self, path: str, payload: dict, *, bool_field: str) -> bool:
        headers = await self._headers()
        try:
            async with httpx.AsyncClient(timeout=MONNIFY_TIMEOUT) as client:
                resp = await client.post(f"{self.base_url}{path}", json=payload, headers=headers)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Verification is taking too long. Please try again.")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Could not reach the verification service. Please try again.")

        try:
            data = resp.json()
        except ValueError:
            raise HTTPException(status_code=502, detail="Verification service returned an unexpected response.")

        if not data.get("requestSuccessful"):
            raise HTTPException(status_code=422, detail=data.get("responseMessage", "Could not verify those details."))

        body = data.get("responseBody", {})

        # Current shape: a plain boolean.
        if bool_field in data:
            return bool(data[bool_field])
        if bool_field in body:
            return bool(body[bool_field])

        # Older/alternate shape: granular per-field match status. This is
        # actually the shape Monnify's own BVN Information Verification
        # docs sample — dateOfBirth/mobileNo are exact-match strings
        # ("FULL_MATCH"/"NO_MATCH"), name is the only field with a
        # PARTIAL_MATCH tier. A name match alone isn't enough to accept:
        # two people can share a surname, and PARTIAL_MATCH can trigger
        # off as little as a shared middle name. Require the name match
        # AND at least one of dateOfBirth/mobileNo to fully match, so a
        # coincidental name overlap can't pass on its own.
        name_match = body.get("name", {})
        if isinstance(name_match, dict) and "matchStatus" in name_match:
            name_ok = name_match["matchStatus"] in ("FULL_MATCH", "PARTIAL_MATCH")
            corroborated = (
                body.get("dateOfBirth") == "FULL_MATCH"
                or body.get("mobileNo") == "FULL_MATCH"
            )
            return name_ok and corroborated

        # If neither known shape is present, fail closed rather than
        # silently accepting unverified identity info.
        logger.warning(f"[monnify] Unrecognized verification response shape for {path}: {data}")
        raise HTTPException(status_code=502, detail="Could not confirm verification result. Please try again or contact support.")

    # ── Reserved account creation ─────────────────────────────────
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
        payload: dict = {
            "accountReference":  account_reference,
            "accountName":       account_name,
            "currencyCode":      "NGN",
            "contractCode":      self.contract_code,
            "customerEmail":     customer_email,
            "customerName":      customer_name,
            "getAllAvailableBanks": False,
            "preferredBanks":    ["035"],  # Wema Bank ALAT
        }
        if bvn:
            payload["bvn"] = bvn
        if nin:
            payload["nin"] = nin

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/api/v2/bank-transfer/reserved-accounts",
                json=payload,
                headers=await self._headers(),
                timeout=30,
            )
            resp.raise_for_status()
            body = resp.json()["responseBody"]

        accounts = body.get("accounts", [])
        first = accounts[0] if accounts else {}

        return ReservedAccount(
            account_number=    first.get("accountNumber", ""),
            bank_name=         first.get("bankName", ""),
            account_reference= body["accountReference"],
            account_name=      body["accountName"],
            provider=          "monnify",
        )

    async def update_reserved_account_kyc(self, *, account_reference: str, bvn: Optional[str] = None, nin: Optional[str] = None) -> None:
        """Links a BVN and/or NIN to an ALREADY-EXISTING reserved account.
        Distinct from create_reserved_account — accounts are created
        immediately at signup with no BVN/NIN at all (unverified, capped
        at Monnify's limited transaction amount), and this is what raises
        that cap once the customer completes KYC. Per Monnify's docs:
        one of BVN/NIN gets the account off the lowest cap, both gets
        the maximum transaction limit."""
        payload: dict = {}
        if bvn:
            payload["bvn"] = bvn
        if nin:
            payload["nin"] = nin
        if not payload:
            return

        async with httpx.AsyncClient() as client:
            resp = await client.put(
                f"{self.base_url}/api/v1/bank-transfer/reserved-accounts/{account_reference}/kyc-info",
                json=payload,
                headers=await self._headers(),
                timeout=30,
            )
            resp.raise_for_status()

    # ── Single transfer (disbursement) ────────────────────────────
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
        payload = {
            "amount":                   amount_kobo / 100,
            "reference":                reference,
            "narration":                narration,
            "destinationBankCode":      destination_bank_code,
            "destinationAccountNumber": destination_account_number,
            "destinationAccountName":   destination_account_name,
            "currency":                 "NGN",
            "sourceAccountNumber":      settings.MONNIFY_SOURCE_ACCOUNT_NUMBER,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/api/v2/disbursements/single",
                json=payload,
                headers=await self._headers(),
                timeout=30,
            )
            resp.raise_for_status()
            body = resp.json()["responseBody"]

        return TransferResult(
            reference= body.get("reference", reference),
            status=    body.get("status", "FAILED"),
            fee_kobo=  round(body.get("totalFee", 0) * 100),
            raw=       body,
        )

    # ── Resolve account name (verify bank + account number, used at
    # registration and when editing bank details — customers never type
    # their own account name) ──────────────────────────────────────
    async def resolve_account_name(self, account_number: str, bank_code: str) -> str:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/disbursements/account/validate",
                params={"accountNumber": account_number, "bankCode": bank_code},
                headers=await self._headers(),
                timeout=15,
            )
            resp.raise_for_status()
            body = resp.json().get("responseBody", {})
            account_name = body.get("accountName")
            if not account_name:
                raise ValueError("Could not verify this account — check the account number and bank")
            return account_name

    # ── Get banks (used to resolve bank codes for transfers) ───────
    async def get_banks(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/banks",
                headers=await self._headers(),
                timeout=15,
            )
            resp.raise_for_status()
            return resp.json()["responseBody"]

    # ── Webhook signature verification ────────────────────────────
    # Two wrinkles here, both confirmed directly against Monnify's current
    # "Webhook Event Types" docs page:
    #
    # 1. The 'monnify-signature' header is ONLY sent on production
    #    notifications — Monnify's own docs state sandbox webhooks never
    #    carry it at all. So for a sandbox demo (exactly what's being
    #    prepared here), every real webhook Monnify sends will arrive
    #    with NO signature header, and this method must never be the
    #    thing that rejects those — see webhooks.py, which now checks
    #    is_sandbox before calling this at all.
    # 2. The same docs page contradicts itself on the algorithm: the
    #    "Security Reminder" box says to compute an HMAC-SHA512 of the
    #    body; the "Transaction Hash Computation" section below it says
    #    the formula is plain SHA-512(secret + body) — i.e. concatenation,
    #    NOT HMAC. Third-party integrations (Laravel/PHP, several blog
    #    write-ups) implement true HMAC-SHA512. Since we can't get a real
    #    signed production webhook to test against yet, we accept either
    #    shape here rather than guess wrong and silently drop every real
    #    webhook once live. Once production traffic is flowing, log which
    #    branch actually matched and drop the other.
    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        if not signature:
            return False

        secret = settings.MONNIFY_WEBHOOK_SECRET

        hmac_sig = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()
        if hmac.compare_digest(hmac_sig.lower(), signature.lower()):
            return True

        concat_sig = hashlib.sha512((secret + payload.decode("utf-8")).encode()).hexdigest()
        return hmac.compare_digest(concat_sig.lower(), signature.lower())

    # ── Parse webhook event ───────────────────────────────────────
    def parse_webhook_event(self, payload: dict) -> WebhookEvent:
        body = payload.get("eventData", {})
        if not isinstance(body, dict) or not body:
            body = payload

        amount_val = (
            body.get("amountPaid")
            or body.get("amount")
            or body.get("totalPayable")
            or body.get("settlementAmount")
            or 0
        )
        try:
            amount_naira = float(amount_val)
        except (ValueError, TypeError):
            amount_naira = 0.0

        dest_info = body.get("destinationAccountInformation") or {}
        account_num = (
            dest_info.get("accountNumber")
            or body.get("destinationAccountNumber")
            or body.get("accountNumber")
            or payload.get("accountNumber")
            or ""
        )

        tx_ref = (
            body.get("transactionReference")
            or body.get("paymentReference")
            or payload.get("transactionReference")
            or payload.get("paymentReference")
            or ""
        )

        status_str = str(body.get("paymentStatus") or body.get("status") or "").upper()

        return WebhookEvent(
            transaction_reference= str(tx_ref),
            amount_kobo=           int(round(amount_naira * 100)),
            account_number=        str(account_num),
            status=                status_str,
            provider=              "monnify",
            raw=                   payload,
        )

    # ── Fetch transaction ─────────────────────────────────────────
    async def get_transaction(self, reference: str) -> Optional[WebhookEvent]:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.base_url}/api/v2/transactions/{reference}",
                    headers=await self._headers(),
                    timeout=15,
                )
                resp.raise_for_status()
                body = resp.json()["responseBody"]
            return WebhookEvent(
                transaction_reference= body.get("transactionReference", ""),
                amount_kobo=           int(float(body.get("amountPaid", 0)) * 100),
                account_number=        body.get("destinationAccountNumber", ""),
                status=                body.get("paymentStatus", ""),
                provider=              "monnify",
                raw=                   body,
            )
        except Exception:
            # This directly verifies a payment against Monnify's own API —
            # meant as the safety check behind webhook-driven crediting.
            # Silently returning None here (no log at all) means a real
            # failure — Monnify being down, a bug, a broken auth token —
            # would be indistinguishable from "transaction genuinely
            # doesn't exist," with zero trace for anyone to investigate
            # if payments stop reconciling correctly.
            logger.exception("Monnify get_transaction failed for reference=%s", reference)
            return None


# ── Singleton factory ─────────────────────────────────────────────
_provider: MonnifyProvider | None = None

def get_payment_provider() -> MonnifyProvider:
    global _provider
    if _provider is None:
        _provider = MonnifyProvider()
    return _provider
