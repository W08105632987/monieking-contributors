"""
GYKDATASUB client (https://gykdatasub.com): the VTU supplier for cheap data bundles, backup airtime, and Airtime-to-Cash.

WHAT WE KNOW (from their published Developer Hub documentation) AND WHAT WE DO NOT
  Known:
    * Auth     Authorization: Bearer <API key>, Content-Type: application/json. Base URL https://gykdatasub15072026.kalidevelopers.com.ng
               (NOT gykdatasub.com: that is only the website). Paths are settings (GYK_*_PATH); /api/v1/user/ and /api/v1/dataplan/ are confirmed.
    * Airtime  POST /api/topup/  {network, amount, phone}             network: 1 MTN, 2 Glo, 3 9mobile, 4 Airtel
    * Data     POST /api/data/   {network, plan, mobile_number}       (plan = a plan id from the plan list)
    * Plans    POST /api/dataplan/ {"action": "allplans"}  -> data: [ plan rows ]
    * Fees     GET  /api/details/fees/  (public) -> data: {air_mtn_charges, ..., air_to_cash}
    * Balance  POST /api/details/user/  -> data.wallet_balance
    * History  POST /api/wallet_history/ {"action": "transactions", page, limit, from_date, to_date}
    * A2C      POST /api/a2c/  action "otp" -> data.identifier; "verify" -> data.sessionId; "submit"
    * Replies  {"status": "success"|"error", "message": ..., "reference"/"transaction_id": ...}
  NOT provided by them: an idempotency key, a webhook, or a "look up this purchase" endpoint. A purchase whose reply is lost can
  therefore not be proven or denied with one call. We never guess: an unclear outcome stays PENDING and is matched against the
  wallet history (phone + time); if still unclear it goes to a human. Another supplier is only ever tried when this one
  DEFINITELY did nothing.
  Conflicting: their own mobile app calls slightly different paths/fields than their documentation (/api/airtime/ with network_id,
  /api/data/ with plan_id and phone). We cannot test their live API from here, so the data call sends BOTH spellings of every field,
  the paths are settings, and scripts/diagnose_gyk.py proves the real behaviour with one tiny purchase before anything is switched on.

Error classes (the same money-safety contract as the Monnify client):
  ambiguous=True  -> the purchase may exist (timeout after sending, 5xx, unreadable reply): hold the money, match against history.
  kind="customer" -> what the customer typed was rejected: do NOT try another supplier.
  kind="provider" -> our account or their service (key rejected, wallet empty, service off): safe to fail over.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger("monieking.gyk")

# Display network -> GYKDATASUB network id. Their docs call id 4 "ETISALAT", but their app, plan list and price list use 4 = Airtel, 3 = 9mobile.
NETWORK_SLUGS = {"MTN": "1", "Glo": "2", "9mobile": "3", "Airtel": "4"}
ID_TO_DISPLAY = {v: k for k, v in NETWORK_SLUGS.items()}
CUSTOMER_FACING = "We could not complete this purchase right now."

# Wording that tells us the request was refused BEFORE anything was bought.
_NOT_PROCESSED = re.compile(r"invalid user|user_key|insufficient|low balance|not enough|invalid (api|token|key)|unauthori[sz]ed|authentication|forbidden|disabled|suspended|inactive|maintenance|unavailable|temporar|service.*(down|off|not available)|ip .*(allowed|whitelist)|not activated|vendor.*(fail|error|down)|network error", re.I)
_CUSTOMER = re.compile(r"invalid (phone|number|mobile|network|plan|amount)|not a valid|wrong (number|network)|minimum|maximum|plan not found|does not (match|belong)|incorrect (number|phone)", re.I)


class VtuError(Exception):
    def __init__(self, message: str, *, code: str = "", status: int = 0, ambiguous: bool = False, kind: str = "provider", raw: str = ""):
        super().__init__(message)
        self.message = message          # customer-safe
        self.code = code
        self.status = status
        self.ambiguous = ambiguous
        self.kind = kind                # "customer" | "provider"
        self.raw = raw or message       # the real detail, for logs and operators only


class VtuNotFound(VtuError):
    """The supplier has no purchase lookup by our reference, so 'not found' is only ever concluded from the wallet history."""


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")[-10:]


def _first(row: dict, *names):
    for n in names:
        if row.get(n) is not None and row.get(n) != "":
            return row[n]
    return None


def _find(body, key: str, depth: int = 0):
    """The value stored under `key` anywhere in a (nested) reply: their replies put the same field at different depths."""
    if depth > 4:
        return None
    if isinstance(body, dict):
        if body.get(key) is not None:
            return body[key]
        for v in body.values():
            found = _find(v, key, depth + 1)
            if found is not None:
                return found
    elif isinstance(body, list):
        for v in body:
            found = _find(v, key, depth + 1)
            if found is not None:
                return found
    return None


def _is_success(body: dict) -> bool:
    status = body.get("status")
    if isinstance(status, bool):
        return status
    return str(status or "").lower() in ("success", "successful", "completed", "ok") or body.get("success") is True


def _is_pending(body: dict) -> bool:
    return str(body.get("status") or "").lower() in ("pending", "processing", "queued", "submitted")


def normalize(body: dict) -> dict:
    """Their reply -> the dict shape the bills service already understands (vendStatus / transactionReference / responseMessage)."""
    body = body if isinstance(body, dict) else {}
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    ref = (
        body.get("reference")
        or body.get("transaction_id")
        or body.get("transid")
        or body.get("id")
        or body.get("order_id")
        or body.get("ident")
        or data.get("reference")
        or data.get("transaction_id")
        or data.get("transid")
        or data.get("id")
        or data.get("order_id")
        or data.get("ident")
    )
    mapped = "SUCCESS" if _is_success(body) else "PROCESSING" if _is_pending(body) else "FAILED"
    return {"vendStatus": mapped, "transactionReference": ref, "responseMessage": body.get("message"),
            "walletBalance": body.get("wallet_balance") or data.get("wallet_balance")}


def classify_failure(http_status: int, message: str, *, purchase: bool) -> VtuError:
    raw = f"HTTP {http_status}: {message[:200]}"
    if _CUSTOMER.search(message):
        return VtuError("Please check the phone number and try again.", status=http_status, kind="customer", raw=raw)
    if http_status in (401, 403, 404, 429) or _NOT_PROCESSED.search(message):
        return VtuError(CUSTOMER_FACING, status=http_status, kind="provider", raw=raw)
    # Something we cannot classify. For a purchase assume it MAY have gone through: holding the money is safe, refunding is not.
    return VtuError(CUSTOMER_FACING, status=http_status, ambiguous=purchase, kind="provider", raw=raw)


class GykProvider:
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None):
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(settings.GYK_API_KEY)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=8.0), transport=self._transport)

    async def _request(self, method: str, path: str, payload: dict | None, *, purchase: bool = False, auth: bool = True) -> dict:
        if auth and not self.configured:
            raise VtuError(CUSTOMER_FACING, code="not_configured", raw="GYK_API_KEY is not set")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if auth:
            headers["Authorization"] = f"Bearer {settings.GYK_API_KEY}"
        try:
            async with self._client() as client:
                resp = await client.request(method, f"{settings.GYK_BASE_URL.rstrip('/')}{path}", json=payload if method != "GET" else None, headers=headers)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as e:
            raise VtuError(CUSTOMER_FACING, code="connect_failed", raw=f"{type(e).__name__}: {e}")      # never reached them: definite
        except httpx.HTTPError as e:
            raise VtuError(CUSTOMER_FACING, code="network", ambiguous=purchase, raw=f"{type(e).__name__}: {e}")   # may have been received
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if resp.status_code >= 500 or (resp.status_code == 200 and not body):
            raise VtuError(CUSTOMER_FACING, status=resp.status_code, ambiguous=purchase, raw=f"HTTP {resp.status_code}: unreadable reply")
        if resp.status_code >= 400:
            raise classify_failure(resp.status_code, str((body or {}).get("message") or (body or {}).get("error") or ""), purchase=purchase)
        return body if isinstance(body, dict) else {}

    async def _post(self, path: str, payload: dict, *, purchase: bool = False) -> dict:
        return await self._request("POST", path, payload, purchase=purchase)

    # ── Catalogue ──────────────────────────────────────────────────────────
    async def get_all_plans(self) -> list[dict]:
        body = await self._post(settings.GYK_PLANS_PATH, {"action": "allplans"})
        if not _is_success(body):
            raise VtuError(CUSTOMER_FACING, kind="provider", raw=f"plan list refused: {str(body.get('message'))[:160]}")
        plans = []
        rows = body.get("data")
        rows = rows if isinstance(rows, list) else (rows or {}).get("plans") or (rows or {}).get("data") or []
        for p in rows:
            if not isinstance(p, dict):
                continue
            plan_id = _first(p, "plan_id", "id", "planid", "dataplan_id")
            price_raw = p.get(settings.GYK_PRICE_FIELD) if settings.GYK_PRICE_FIELD else _first(p, "price", "amount", "plan_amount", "api_price", "selling_price")
            try:
                price = float(price_raw)
            except (TypeError, ValueError):
                continue
            net_val = _first(p, "network_id", "netid") or NETWORK_SLUGS.get(str(p.get("network") or "").strip()) or p.get("network")
            network = str(net_val or "")
            if plan_id is None or price <= 0 or network not in ID_TO_DISPLAY:
                continue
            name = str(_first(p, "plan_name", "name", "plan") or plan_id).strip()
            validity = str(_first(p, "validity", "plan_validity", "duration") or "").strip()
            plans.append({"variation_code": str(plan_id), "network": network, "name": f"{name} {validity}".strip(),
                          "amount_naira": price, "fixed_price": True})
        return plans

    async def get_data_plans(self, network_id: str) -> list[dict]:
        return [p for p in await self.get_all_plans() if p["network"] == str(network_id)]

    # ── Purchases (synchronous: the reply IS the answer) ────────────────────
    @staticmethod
    def _with_pin(payload: dict) -> dict:
        if settings.GYK_TRANSACTION_PIN:
            payload["pin"] = settings.GYK_TRANSACTION_PIN       # their app asks for the account PIN on each purchase; set it if the API does too
        return payload

    @staticmethod
    def _outcome(body: dict) -> dict:
        result = normalize(body)
        if result["vendStatus"] == "SUCCESS" and not result.get("transactionReference"):
            # A real successful purchase ALWAYS returns a reference/transaction_id.
            # A "success" with no reference means the endpoint didn't actually process
            # anything (e.g. wrong API path returning a generic 200 OK).
            logger.warning("[gyk] purchase returned 'success' but no reference — treating as FAILED: %s", body)
            result["vendStatus"] = "FAILED"
            result["_error"] = classify_failure(200, "No transaction reference in response — purchase was not processed", purchase=False)
            return result
        if result["vendStatus"] == "FAILED":
            # A 200 reply that says "error" is classified exactly like an error status, so failover/refund sees the right thing.
            result["_error"] = classify_failure(200, str(body.get("message") or ""), purchase=True)
        return result

    async def buy_airtime(self, *, network: str, phone: str, amount_naira: float, idempotency_key: str, ported: bool = False) -> dict:
        body = await self._post(settings.GYK_AIRTIME_PATH, self._with_pin({
            "network": str(network), "network_id": int(network), "amount": amount_naira, "phone": phone,
            "reference": idempotency_key, "ref": idempotency_key}), purchase=True)
        return self._outcome(body)

    async def buy_data(self, *, network: str, phone: str, variation_code: str, idempotency_key: str, ported: bool = False) -> dict:
        # Their documentation says {plan, mobile_number}; their own app sends {plan_id, phone}. Send both so either reading works.
        plan = int(variation_code) if str(variation_code).isdigit() else variation_code
        body = await self._post(settings.GYK_DATA_PATH, self._with_pin({
            "network": int(network), "plan": plan, "plan_id": plan, "mobile_number": phone, "phone": phone,
            "reference": idempotency_key, "ref": idempotency_key}), purchase=True)
        return self._outcome(body)

    # ── Reconciliation: find a purchase we are unsure about in the wallet history ─
    async def find_purchase(self, *, phone: str, since: datetime) -> dict | None:
        """-> a normalized outcome if EXACTLY ONE history row matches; {"vendStatus": "NOT_FOUND"} if the history is readable and has none;
        None if we cannot tell (history unreadable, or several look-alike rows)."""
        try:
            body = await self._post(settings.GYK_HISTORY_PATH, {
                "action": "transactions", "page": 1, "limit": 30,
                "from_date": (since - timedelta(days=1)).date().isoformat(), "to_date": (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()})
        except VtuError:
            return None
        if not _is_success(body):
            return None       # e.g. HTTP 200 + {"status":"error","message":"Invalid user"}: the call was REFUSED, which says nothing about our purchase
        want = _digits(phone)
        hits = []
        for row in body.get("data") or []:
            if not isinstance(row, dict) or _digits(str(row.get("mobile_number") or row.get("phone") or "")) != want:
                continue
            when = self._parse_time(row.get("date_time") or row.get("created_at") or "")
            if when is None or when < since - timedelta(seconds=120):
                continue
            hits.append(row)
        if not hits:
            return {"vendStatus": "NOT_FOUND"}        # history was readable and has nothing for this phone since `since`
        if len(hits) != 1:
            return None                               # several look-alikes (two real purchases in a row): cannot tell
        row = hits[0]
        status = str(row.get("status") or "").lower()
        mapped = "SUCCESS" if status in ("success", "successful", "completed") else "PROCESSING" if status in ("pending", "processing") else "FAILED"
        return {"vendStatus": mapped, "transactionReference": row.get("reference") or row.get("transaction_id"), "responseMessage": row.get("description")}

    @staticmethod
    def _parse_time(text: str) -> datetime | None:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                return datetime.strptime(str(text)[:19], fmt).replace(tzinfo=timezone(timedelta(hours=1)))   # Nigeria time (UTC+1)
            except ValueError:
                continue
        return None

    async def wallet_balance(self) -> float | None:
        try:
            body = await self._post(settings.GYK_USER_PATH, {})
        except VtuError:
            return None
        if not _is_success(body):
            return None
        try:
            return float(_find(body, "wallet_balance"))
        except (TypeError, ValueError):
            return None

    async def get_transaction(self, key: str) -> dict:
        """There is no lookup by our reference. Callers use find_purchase(); this exists so a stray call fails loudly, not silently."""
        raise VtuNotFound(CUSTOMER_FACING, raw="GYKDATASUB has no purchase lookup by reference; use find_purchase()")

    # ── Airtime to Cash ─────────────────────────────────────────────────────
    async def get_fees(self) -> dict:
        body = await self._request("GET", settings.GYK_FEES_PATH, None, auth=False)
        return body.get("data") if isinstance(body.get("data"), dict) else {}

    async def a2c_otp(self, *, network: str, phone: str) -> str:
        body = await self._post(settings.GYK_A2C_PATH, {"action": "otp", "network": int(network), "phone": phone})
        ident = (body.get("data") or {}).get("identifier") if isinstance(body.get("data"), dict) else None
        if not _is_success(body) or not ident:
            raise VtuError("We could not send the verification code. Check the number and try again.", kind="customer", raw=f"otp refused: {str(body.get('message'))[:160]}")
        return str(ident)

    async def a2c_verify(self, *, identifier: str, otp: str) -> str:
        body = await self._post(settings.GYK_A2C_PATH, {"action": "verify", "identifier": identifier, "otp": otp})
        session = (body.get("data") or {}).get("sessionId") if isinstance(body.get("data"), dict) else None
        if not _is_success(body) or not session:
            raise VtuError("That code is not correct.", kind="customer", raw=f"verify refused: {str(body.get('message'))[:160]}")
        return str(session)

    async def a2c_submit(self, *, network: str, phone: str, amount_naira: float, simpin: str, session_id: str, amount_to_receive: float) -> dict:
        """The SIM PIN is forwarded and forgotten: it is never logged, stored, or put in an error message."""
        body = await self._post(settings.GYK_A2C_PATH, self._with_pin({
            "action": "submit", "network": int(network), "phone": phone, "amount": amount_naira, "simpin": simpin,
            "sessionId": session_id, "amount_to_receive": amount_to_receive}), purchase=True)
        info, details = body.get("info"), body.get("details")
        ok = (_is_success(body) or body.get("code") == 200) and (
            (isinstance(info, dict) and (info.get("success") or 0) > 0)
            or (isinstance(details, list) and any(isinstance(d, dict) and d.get("status") == "success" for d in details))
            or (not info and not details and _is_success(body)))
        ref = body.get("reference") or (details[0].get("reference") if isinstance(details, list) and details and isinstance(details[0], dict) else None)
        return {"vendStatus": "SUCCESS" if ok else "FAILED", "transactionReference": ref, "responseMessage": body.get("message"),
                "walletBalance": body.get("wallet_balance")}


_provider: GykProvider | None = None


def get_vtu_provider() -> GykProvider:
    global _provider
    if _provider is None:
        _provider = GykProvider()
    return _provider
