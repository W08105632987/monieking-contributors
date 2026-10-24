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


def _raise_for_status_logged(resp: httpx.Response, what: str) -> None:
    """Same as resp.raise_for_status(), but first logs Monnify's own error
    text — the bare HTTPStatusError only says "400 Bad Request" and hides the
    actual reason (invalid BVN, duplicate reference, wallet not enabled...)."""
    if resp.status_code >= 400:
        logger.error("[monnify] %s failed: HTTP %s — %s", what, resp.status_code, resp.text[:500])
    resp.raise_for_status()


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
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            logger.error("[monnify] login failed: HTTP %s — %s", code, e.response.text[:300])
            if code in (401, 403):
                raise HTTPException(status_code=502, detail="Payment provider rejected our credentials. Please contact support.")
            raise HTTPException(status_code=502, detail=f"Payment provider login failed (HTTP {code}). Please try again.")

        try:
            body = resp.json()["responseBody"]
            access_token = body["accessToken"]
        except (ValueError, KeyError, TypeError):
            logger.error("[monnify] login returned an unexpected body: %s", resp.text[:300])
            raise HTTPException(status_code=502, detail="Payment provider returned an unexpected login response. Please try again.")
        # Refresh a minute early rather than cutting it exactly at expiry.
        expires_in = body.get("expiresIn", 3600)
        self._token_expires_at = time.monotonic() + max(expires_in - 60, 60)
        return access_token

    async def _headers(self) -> dict:
        if not self._access_token or time.monotonic() >= self._token_expires_at:
            self._access_token = await self._get_access_token()
        return {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

    # ── Identity verification (BVN / NIN) ───────────────────────────
    # Per Monnify's "Verifying your Customers" docs, BVN Information
    # Verification and NIN Verification exist on the LIVE environment ONLY
    # (and are billed per successful call). On sandbox they cannot work, so
    # on sandbox we skip the check with a loud warning instead of failing
    # every customer's KYC — the rest of the flow (linking the BVN/NIN to the
    # virtual account) can still be exercised.
    #
    # Monnify's docs are inconsistent across versions about the response
    # shape — an older reference shows granular per-field match info
    # (name/DOB/mobile each with their own status), while the current docs
    # describe a single boolean. We check for both rather than assume one.
    async def verify_bvn(self, *, bvn: str, name: str, date_of_birth: str, mobile_no: str) -> bool:
        """Returns True if the supplied details are an acceptable match
        for the BVN record (full or partial match both count — legitimate
        users routinely get partial matches over things like middle names
        or spacing differences). date_of_birth must be dd-MMM-yyyy."""
        payload = {"bvn": bvn, "name": name, "dateOfBirth": date_of_birth, "mobileNo": mobile_no}
        return await self._run_verification("/api/v1/vas/bvn-details-match", payload, bool_field="bvnInformationMatch")

    async def verify_nin(self, *, nin: str) -> bool:
        """Returns True if the NIN is valid and verifiable.
        The NIN endpoint is POST /api/v1/vas/nin-details (body {"nin": ...}).
        The earlier path here, /nin-details-match, was a guess and is only
        kept as a fallback if Monnify answers 404 for the first one. The
        endpoint receives only the NIN, so "verified" here means "this NIN
        exists and Monnify could look it up" — there is nothing else to
        compare against."""
        payload = {"nin": nin}
        return await self._run_verification(
            "/api/v1/vas/nin-details", payload, bool_field="ninInformationMatch",
            fallback_path="/api/v1/vas/nin-details-match", accept_valid_record=True,
        )

    async def _run_verification(
        self, path: str, payload: dict, *, bool_field: str,
        fallback_path: str | None = None, accept_valid_record: bool = False,
    ) -> bool:
        if self.is_sandbox:
            logger.warning(
                "[monnify] %s is a LIVE-ONLY service — skipping identity verification because "
                "MONNIFY_BASE_URL is the sandbox. Use live credentials to verify for real.", path,
            )
            return True

        headers = await self._headers()
        resp = None
        for attempt_path in [p for p in (path, fallback_path) if p]:
            try:
                async with httpx.AsyncClient(timeout=MONNIFY_TIMEOUT) as client:
                    resp = await client.post(f"{self.base_url}{attempt_path}", json=payload, headers=headers)
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Verification is taking too long. Please try again.")
            except httpx.ConnectError:
                raise HTTPException(status_code=503, detail="Could not reach the verification service. Please try again.")
            if resp.status_code == 404 and attempt_path != fallback_path and fallback_path:
                logger.warning("[monnify] %s returned 404 — trying %s", attempt_path, fallback_path)
                continue
            path = attempt_path
            break

        # Never log the request payload — it holds the BVN/NIN.
        if resp.status_code >= 400:
            logger.error("[monnify] verification %s failed: HTTP %s — %s", path, resp.status_code, resp.text[:400])

        try:
            data = resp.json()
        except ValueError:
            raise HTTPException(status_code=502, detail="Verification service returned an unexpected response.")
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="Verification service returned an unexpected response.")

        if resp.status_code in (401, 403, 404) or resp.status_code >= 500:
            # Our side / account side problem (service not enabled on this
            # Monnify account, IP not whitelisted, endpoint missing, outage) —
            # not something the customer got wrong, so don't show them
            # Monnify's raw text as if their details were rejected.
            raise HTTPException(
                status_code=502,
                detail="Identity verification is unavailable right now. Please try again later.",
            )

        if not data.get("requestSuccessful"):
            msg = str(data.get("responseMessage") or "")
            low = msg.lower()
            if "invalid bvn" in low or "invalid nin" in low:
                # The customer typed a number that is not a real 11-digit BVN/NIN: their mistake, say so plainly.
                raise HTTPException(status_code=422, detail="That number is not a valid " + ("BVN" if "bvn" in low else "NIN") + ". Check it and try again.")
            if str(data.get("responseCode")) == "99" or "try again later" in low or "unable to process" in low:
                # A generic Monnify failure is almost never the customer's fault. The usual causes are on OUR Monnify
                # account: the verification service is not switched on, the wallet cannot cover the per-check fee
                # (BVN ₦10, NIN ₦60), or the server IP is not allowed. Log the cause for the operator, keep the
                # customer's message calm.
                logger.error(
                    "[monnify] %s answered code 99 (%r). Check with Monnify: (1) BVN/NIN verification enabled on this LIVE "
                    "contract, (2) Monnify wallet balance covers the fee, (3) API calls allowed from this server.", path, msg[:120],
                )
                raise HTTPException(status_code=502, detail="Identity verification is unavailable right now. Please try again later.")
            raise HTTPException(status_code=422, detail=msg or "Could not verify those details.")

        body = data.get("responseBody") or {}
        if not isinstance(body, dict):
            body = {}

        # Current shape: a plain boolean.
        if bool_field in data:
            return bool(data[bool_field])
        if bool_field in body:
            return bool(body[bool_field])

        # Older/alternate shape: granular per-field match status. dateOfBirth/
        # mobileNo are exact-match strings ("FULL_MATCH"/"NO_MATCH"), name is
        # the only field with a PARTIAL_MATCH tier. A name match alone isn't
        # enough to accept: two people can share a surname, so require the
        # name match AND at least one of dateOfBirth/mobileNo to fully match.
        name_match = body.get("name", {})
        if isinstance(name_match, dict) and "matchStatus" in name_match:
            name_ok = name_match["matchStatus"] in ("FULL_MATCH", "PARTIAL_MATCH")
            corroborated = (
                body.get("dateOfBirth") == "FULL_MATCH"
                or body.get("mobileNo") == "FULL_MATCH"
            )
            return name_ok and corroborated

        # NIN lookups return the NIN record itself (there is no match flag to
        # read because only the NIN was supplied): a successful response with
        # a record means the NIN is real.
        if accept_valid_record and body:
            logger.info("[monnify] NIN lookup succeeded (record fields: %s)", sorted(body.keys())[:15])
            return True

        # If no known shape is present, fail closed rather than silently
        # accepting unverified identity info.
        logger.warning("[monnify] Unrecognized verification response shape for %s: keys=%s", path, sorted(data.keys()))
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
            _raise_for_status_logged(resp, "create reserved account")
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
            _raise_for_status_logged(resp, "update reserved account KYC")

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
            _raise_for_status_logged(resp, "single transfer")
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
    async def _get_json(self, path: str, params: dict | None = None) -> httpx.Response:
        """GET with the bearer token; if Monnify says 401 (token expired early /
        revoked) fetch a fresh token and retry exactly once."""
        for attempt in (1, 2):
            async with httpx.AsyncClient(timeout=MONNIFY_TIMEOUT) as client:
                resp = await client.get(f"{self.base_url}{path}", params=params, headers=await self._headers())
            if resp.status_code == 401 and attempt == 1:
                self._access_token = None
                continue
            return resp
        return resp  # pragma: no cover

    async def resolve_account_name(self, account_number: str, bank_code: str) -> str:
        """Bank lookup. A wrong number/bank is a ValueError carrying Monnify's own
        message (shown to the person); only real outages bubble up as 5xx/timeouts."""
        try:
            resp = await self._get_json(
                "/api/v1/disbursements/account/validate",
                {"accountNumber": account_number, "bankCode": bank_code},
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="The bank lookup is taking too long. Please try again.")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Could not reach the bank lookup service. Please try again.")
        try:
            data = resp.json()
        except Exception:
            data = {}
        if 400 <= resp.status_code < 500:
            msg = (data.get("responseMessage") or "").strip()
            raise ValueError(msg or "Could not verify this account — check the account number and bank")
        resp.raise_for_status()
        account_name = (data.get("responseBody") or {}).get("accountName")
        if not account_name:
            raise ValueError("Could not verify this account — check the account number and bank")
        return account_name

    # ── Get banks (bank picker + transfers) ─────────────────────────
    # The list changes rarely: cache it for 6h, and if Monnify hiccups serve the
    # last good copy instead of leaving the picker empty.
    _banks_cache: tuple[float, list[dict]] | None = None

    async def get_banks(self) -> list[dict]:
        cached = MonnifyProvider._banks_cache
        if cached and time.monotonic() - cached[0] < 6 * 3600:
            return cached[1]
        try:
            resp = await self._get_json("/api/v1/banks")
            resp.raise_for_status()
            banks = resp.json()["responseBody"]
        except Exception:
            if cached:
                return cached[1]
            raise
        MonnifyProvider._banks_cache = (time.monotonic(), banks)
        return banks

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

        # Monnify signs notifications with your Client SECRET KEY — there is no
        # separate "webhook secret" in their dashboard. If MONNIFY_WEBHOOK_SECRET
        # was left blank, fall back to the secret key instead of verifying
        # against an empty key (which would reject every live payment).
        secret = settings.MONNIFY_WEBHOOK_SECRET or settings.MONNIFY_SECRET_KEY

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
