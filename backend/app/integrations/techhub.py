"""
Techhub verification client (NIN / BVN slips + person data).

Every call returns the person's data AND a PDF in one response, and Techhub
charges us for it. Response contract (Techhub API docs):

  200  {"status":"success","response_code":"00","user_data":{...},"pdf_base64":"..."}
  400  {"status":"error","response_code":"01", ... "error_code":"INVALID_NIN"}   bad input
  400  {"status":"error","response_code":"02", "message":"... Record not found ..."}
  400  insufficient balance (our Techhub wallet) — also a 400, no special code documented
  403  IP blocked      429  rate limit      5xx / timeout  provider down

`interpret()` is a pure function so the whole mapping is unit-tested without
a network. Nothing in this module logs the API key, request fields or response
bodies — only endpoint file names and status codes.
"""
import base64
import logging
from dataclasses import dataclass

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(connect=5.0, read=40.0, write=10.0, pool=5.0)
MAX_RESPONSE_BYTES = 12 * 1024 * 1024


class TechhubError(Exception):
    """`user_message` is always safe to show a customer."""
    user_message = "This service is temporarily unavailable. You have not been charged."
    # Does this count toward tripping the circuit breaker?
    counts_as_failure = True
    reason = "unavailable"


class TechhubUnavailable(TechhubError):
    """Timeout, network, 5xx, malformed answer, blocked IP, our Techhub balance empty."""
    def __init__(self, reason: str = "unavailable"):
        self.reason = reason
        super().__init__(reason)


class TechhubBusy(TechhubError):
    """429. Provider is up, we are just going too fast — do not trip the breaker."""
    user_message = "Too many checks right now. Please try again in a minute. You have not been charged."
    counts_as_failure = False
    reason = "rate_limited"


class TechhubAuthError(TechhubError):
    """401 or a rejected key. Operator problem, generic message to the customer."""
    reason = "auth"


class TechhubInvalidInput(TechhubError):
    counts_as_failure = False
    reason = "invalid_input"

    def __init__(self, message: str = "Those details look wrong. Please check them and try again."):
        self.user_message = message
        super().__init__(message)


class TechhubNotFound(TechhubError):
    """A clean, completed 'no such record' answer. The service is healthy."""
    counts_as_failure = False
    reason = "not_found"
    user_message = "No record found for these details."


@dataclass
class TechhubResult:
    user_data: dict
    pdf: bytes


def _looks_like_balance(message: str) -> bool:
    m = (message or "").lower()
    return "balance" in m or "insufficient" in m or "fund" in m


def interpret(status_code: int, body) -> TechhubResult:
    """Map an HTTP status + parsed JSON body to a result or a typed error."""
    if status_code == 429:
        raise TechhubBusy()
    if status_code in (401,):
        raise TechhubAuthError("auth")
    if status_code == 403:
        raise TechhubUnavailable("ip_blocked")
    if status_code >= 500:
        raise TechhubUnavailable("provider_5xx")

    if not isinstance(body, dict):
        raise TechhubUnavailable("bad_response")

    code = str(body.get("response_code") or "")
    status = str(body.get("status") or "").lower()
    message = str(body.get("message") or "")

    if status_code == 200 and status == "success" and code in ("00", ""):
        data = body.get("user_data")
        b64 = body.get("pdf_base64")
        if not isinstance(data, dict) or not data:
            raise TechhubUnavailable("bad_response")
        pdf = b""
        if isinstance(b64, str) and b64:
            try:
                pdf = base64.b64decode(b64, validate=False)
            except Exception:
                raise TechhubUnavailable("bad_response")
        if not pdf.startswith(b"%PDF"):
            # Person data without a usable PDF is not a delivered product.
            raise TechhubUnavailable("no_pdf")
        return TechhubResult(user_data=data, pdf=pdf)

    if code == "02" or (status_code == 400 and "not found" in message.lower() and "record" in message.lower()):
        raise TechhubNotFound()
    if code == "01" or str(body.get("error_code") or "").startswith("INVALID"):
        raise TechhubInvalidInput()
    if status_code == 400 and _looks_like_balance(message):
        raise TechhubUnavailable("provider_balance")
    if status_code == 400:
        # Any other 400 we cannot classify is treated as OUR problem, not the
        # customer's: safer to say "unavailable, not charged" than to blame input.
        raise TechhubUnavailable("unclassified_400")
    raise TechhubUnavailable("unexpected_status")


async def call_techhub(endpoint_file: str, fields: dict) -> TechhubResult:
    """POST one lookup. Raises a TechhubError subclass on anything but a clean result."""
    if not settings.TECHHUB_API_KEY:
        raise TechhubAuthError("not_configured")
    url = f"{settings.TECHHUB_BASE_URL.rstrip('/')}/{endpoint_file}"
    payload = {"api_key": settings.TECHHUB_API_KEY, **fields}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
    except httpx.TimeoutException:
        logger.warning("techhub timeout endpoint=%s", endpoint_file)
        raise TechhubUnavailable("timeout")
    except httpx.HTTPError:
        logger.warning("techhub network error endpoint=%s", endpoint_file)
        raise TechhubUnavailable("network")

    if len(resp.content) > MAX_RESPONSE_BYTES:
        raise TechhubUnavailable("too_large")
    try:
        body = resp.json()
    except ValueError:
        body = None
    try:
        return interpret(resp.status_code, body)
    except TechhubError as e:
        logger.warning("techhub endpoint=%s http=%s outcome=%s", endpoint_file, resp.status_code, e.reason)
        raise
