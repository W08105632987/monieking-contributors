"""
Youverify identity verification integration.

Endpoint shapes here are copied directly from docs.youverify.co (Nigeria
KYC + KYB) as of the docs pass done for this integration — see
backend/scripts/seed_identity_services.py for the per-service field
mapping this was sourced from. If Youverify changes their request/response
shape, that's the file to re-check first, not this one.
"""
import logging
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

YOUVERIFY_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)


class YouverifyError(Exception):
    """Base class. `user_message` is safe to show a customer as-is;
    never surface the raw exception text to the frontend."""
    def __init__(self, user_message: str, *, retryable: bool):
        self.user_message = user_message
        self.retryable = retryable
        super().__init__(user_message)


class YouverifyUnavailableError(YouverifyError):
    """Network/timeout/5xx — our side has no evidence the lookup ran at
    all. Caller must NOT charge the wallet when this is raised."""
    def __init__(self):
        super().__init__(
            "The verification service is temporarily unavailable. You have not been charged — please try again shortly.",
            retryable=True,
        )


class YouverifyRejectedError(YouverifyError):
    """4xx that isn't an auth problem — bad input, e.g. malformed NIN.
    Also must NOT be charged."""
    def __init__(self, detail: str):
        super().__init__(detail, retryable=False)


class YouverifyAuthError(YouverifyError):
    """401/403 — our API key/token is wrong or expired. This is an
    operator problem, not the customer's — message stays generic to the
    customer, real detail goes to logs only."""
    def __init__(self):
        super().__init__(
            "This service is temporarily unavailable. Our team has been notified.",
            retryable=False,
        )


async def call_youverify(endpoint: str, payload: dict) -> dict:
    """
    POST to a Youverify identity/KYB endpoint. Returns the parsed response
    body on success. Raises a YouverifyError subclass on any failure —
    callers should catch YouverifyError, not httpx exceptions directly,
    so a provider outage always degrades the same predictable way
    regardless of which service triggered it.
    """
    url = f"{settings.YOUVERIFY_BASE_URL}{endpoint}"
    headers = {"token": settings.YOUVERIFY_TOKEN, "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=YOUVERIFY_TIMEOUT) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except httpx.TimeoutException:
        logger.warning("Youverify timeout calling %s", endpoint)
        raise YouverifyUnavailableError()
    except httpx.ConnectError:
        logger.warning("Youverify connection failed calling %s", endpoint)
        raise YouverifyUnavailableError()

    if resp.status_code in (401, 403):
        logger.error("Youverify auth failure (%s) calling %s — check YOUVERIFY_TOKEN", resp.status_code, endpoint)
        raise YouverifyAuthError()

    if resp.status_code >= 500:
        logger.warning("Youverify %s returned %s", endpoint, resp.status_code)
        raise YouverifyUnavailableError()

    if resp.status_code >= 400:
        try:
            body = resp.json()
            detail = body.get("message") or "That request couldn't be processed — please check the details and try again."
        except Exception:
            detail = "That request couldn't be processed — please check the details and try again."
        raise YouverifyRejectedError(detail)

    try:
        return resp.json()
    except Exception:
        logger.error("Youverify %s returned a non-JSON 2xx body", endpoint)
        raise YouverifyUnavailableError()
