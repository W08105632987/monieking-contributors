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
    pdf: bytes   # b"" when Techhub sent no usable PDF


def _looks_like_balance(message: str) -> bool:
    m = (message or "").lower()
    return "balance" in m or "insufficient" in m or "fund" in m


# Field-name variants seen across providers; we always hand the rest of the app the
# canonical names the docs use (first_name, last_name, ...).
_ALIASES = {
    "first_name": ("first_name", "firstname", "firstName", "first"),
    "last_name": ("last_name", "lastname", "lastName", "surname"),
    "middle_name": ("middle_name", "middlename", "middleName", "othername", "other_name"),
    "gender": ("gender", "sex"),
    "date_of_birth": ("date_of_birth", "dateOfBirth", "dob", "birthdate", "birth_date"),
    "phone_number": ("phone_number", "phoneNumber", "phone", "telephoneno", "mobile"),
    "address": ("address", "residence_address", "residenceAddress"),
    "nin": ("nin", "NIN"),
    "bvn": ("bvn", "BVN"),
}
_SUCCESS_WORDS = {"success", "successful", "ok", "true", "00", "0", "200"}
_FAIL_WORDS = {"error", "failed", "fail", "false"}


def canonical_user_data(data: dict) -> dict:
    out = dict(data)
    for canon, names in _ALIASES.items():
        if out.get(canon) not in (None, ""):
            continue
        for n in names:
            v = data.get(n)
            if v not in (None, ""):
                out[canon] = v
                break
    return out


def _decode_pdf(value) -> bytes:
    """Base64 PDF, tolerating a data-URI prefix, whitespace and stray bytes before %PDF.
    Returns b"" when there is no usable PDF."""
    if not isinstance(value, str) or not value:
        return b""
    if "base64," in value[:80]:
        value = value.split("base64,", 1)[1]
    try:
        raw = base64.b64decode("".join(value.split()), validate=False)
    except Exception:
        return b""
    i = raw.find(b"%PDF")
    return raw[i:] if 0 <= i < 1024 else b""


def find_pdf(obj, _depth: int = 0) -> bytes:
    """First embedded PDF anywhere in a parsed reply (any key name, any nesting)."""
    if _depth > 5:
        return b""
    if isinstance(obj, str):
        if len(obj) > 200:
            return _decode_pdf(obj)
        return b""
    vals = obj.values() if isinstance(obj, dict) else obj if isinstance(obj, list) else ()
    for v in vals:
        got = find_pdf(v, _depth + 1)
        if got:
            return got
    return b""


def _safe_text(v, n: int = 60) -> str:
    """Short, digit-free rendering of a scalar for diagnostics (never person data)."""
    import re
    return re.sub(r"\d", "#", str(v))[:n]


def describe_shape(status_code: int, body) -> str:
    """Names and types only, plus short status words. Never values of user_data."""
    if not isinstance(body, dict):
        return f"http={status_code} body={type(body).__name__}"
    ud = body.get("user_data") if isinstance(body.get("user_data"), dict) else body.get("data")
    return (
        f"http={status_code} keys={sorted(body.keys())} "
        f"status={_safe_text(body.get('status'))!r} code={_safe_text(body.get('response_code'))!r} "
        f"success={_safe_text(body.get('success'))!r} err={_safe_text(body.get('error_code'))!r} "
        f"msg={_safe_text(body.get('message'), 80)!r} "
        f"data_keys={sorted(ud.keys()) if isinstance(ud, dict) else None} "
        f"pdf_len={len(body.get('pdf_base64') or '') if isinstance(body.get('pdf_base64'), str) else None} "
        f"pdf_found={bool(find_pdf(body))} all_keys={_key_paths(body)}"
    )


def _key_paths(o, prefix: str = "", depth: int = 0, out: list | None = None) -> list:
    out = [] if out is None else out
    if depth > 3 or len(out) > 40:
        return out
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (dict, list)):
                _key_paths(v, f"{prefix}{k}.", depth + 1, out)
            else:
                out.append(f"{prefix}{k}")
    elif isinstance(o, list) and o:
        _key_paths(o[0], prefix + "[].", depth + 1, out)
    return out


def interpret(status_code: int, body, want: str = "person") -> TechhubResult:
    """Map an HTTP status + parsed JSON body to a result or a typed error.

    Success means: a 2xx answer that carries the person's data and does not say
    it failed. The PDF is a bonus: if it is missing or unreadable the person's
    details are still delivered (we have already paid for the lookup) and only
    the Techhub slip for that tier is unavailable."""
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
    status = str(body.get("status") if body.get("status") is not None else "").lower()
    flag = body.get("success")
    message = str(body.get("message") or "")

    data = body.get("user_data")
    if not (isinstance(data, dict) and data):
        data = body.get("data")
    said_failure = (status in _FAIL_WORDS) or (flag is False) or code in ("01", "02")
    if 200 <= status_code < 300 and isinstance(data, dict) and data and not said_failure:
        pdf = _decode_pdf(body.get("pdf_base64") or body.get("pdf")) or find_pdf(body)
        return TechhubResult(user_data=canonical_user_data(data), pdf=pdf)
    if want == "slip" and 200 <= status_code < 300 and not said_failure:
        # A slip reply may carry only the PDF (no person data). The PDF is the product.
        pdf = find_pdf(body)
        if pdf:
            return TechhubResult(user_data=canonical_user_data(data) if isinstance(data, dict) else {}, pdf=pdf)
        raise TechhubUnavailable("no_pdf")

    if code == "02" or (status_code == 400 and "not found" in message.lower() and "record" in message.lower()):
        raise TechhubNotFound()
    if code == "01" or str(body.get("error_code") or "").startswith("INVALID"):
        raise TechhubInvalidInput()
    if status_code == 400 and _looks_like_balance(message):
        raise TechhubUnavailable("provider_balance")
    if 200 <= status_code < 300:
        raise TechhubUnavailable("unexpected_shape")
    if status_code == 400:
        # Any other 400 we cannot classify is treated as OUR problem, not the
        # customer's: safer to say "unavailable, not charged" than to blame input.
        raise TechhubUnavailable("unclassified_400")
    raise TechhubUnavailable("unexpected_status")


async def call_techhub(endpoint_file: str, fields: dict, want: str = "person") -> TechhubResult:
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
    if want == "slip" and 200 <= resp.status_code < 300 and resp.content[:1024].find(b"%PDF") >= 0 \
            and "json" not in (resp.headers.get("content-type") or "").lower():
        i = resp.content.find(b"%PDF")
        return TechhubResult(user_data={}, pdf=resp.content[i:])   # the reply IS the PDF
    try:
        body = resp.json()
    except ValueError:
        body = None
    try:
        return interpret(resp.status_code, body, want)
    except TechhubError as e:
        logger.warning("techhub endpoint=%s http=%s outcome=%s", endpoint_file, resp.status_code, e.reason)
        if e.reason.startswith("unexpected") or e.reason in ("bad_response", "unclassified_400", "no_pdf"):
            # Structure only (key names, short status words) so a mismatch can be diagnosed from logs.
            logger.warning("techhub shape endpoint=%s %s", endpoint_file, describe_shape(resp.status_code, body))
        raise
