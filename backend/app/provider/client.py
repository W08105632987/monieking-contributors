"""HTTP client for Techhub's async services. Nothing here logs the API key, request values or
response bodies: only endpoint names, status codes and key NAMES."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=20.0, pool=5.0)


@dataclass
class SubmitOutcome:
    # ok | rejected (Techhub said no, nothing charged) | busy | auth | off | balance | unknown (may have gone through)
    kind: str
    ticket_ref: str | None = None
    cost_raw: int | None = None
    message: str = ""
    status_word: str = ""
    extra: dict = field(default_factory=dict)


def _int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def interpret_submit(status_code: int, body) -> SubmitOutcome:
    """Pure: HTTP status + parsed JSON -> what we do next."""
    msg = str(body.get("message") or "") if isinstance(body, dict) else ""
    if status_code == 429:
        return SubmitOutcome("busy", message="Techhub is busy. Please try again in a minute.")
    if status_code == 401:
        return SubmitOutcome("auth", message="The Techhub key was rejected.")
    if status_code == 403:
        return SubmitOutcome("off", message="Techhub blocked this server's address.")
    if status_code == 503:
        return SubmitOutcome("off", message=msg or "Techhub has switched this service off for now.")
    if status_code >= 500 or not isinstance(body, dict):
        return SubmitOutcome("unknown", message="Techhub did not give a clear answer.")
    ok = body.get("success") is True or str(body.get("status") or "").lower() == "success"
    if 200 <= status_code < 300 and ok:
        ref = body.get("ticket_id") or body.get("submission_id")
        if not ref:
            return SubmitOutcome("unknown", message="Techhub accepted the request but gave no reference.",
                                 cost_raw=_int(body.get("amount_charged")))
        return SubmitOutcome("ok", ticket_ref=str(ref), cost_raw=_int(body.get("amount_charged")),
                             status_word=str(body.get("status") or ""), message=msg)
    low = msg.lower()
    if status_code == 400 and ("balance" in low or "insufficient" in low or "fund" in low):
        return SubmitOutcome("balance", message="Our Techhub balance is too low. A director has been told.")
    if status_code == 400 and "not priced" in low:
        return SubmitOutcome("off", message="Techhub has not priced this service for our account yet.")
    if status_code in (400, 404, 413, 422):
        return SubmitOutcome("rejected", message=msg or "Techhub rejected these details.")
    return SubmitOutcome("unknown", message="Techhub did not give a clear answer.")


async def submit(endpoint: str, payload: dict) -> SubmitOutcome:
    if not settings.TECHHUB_API_KEY:
        return SubmitOutcome("auth", message="The Techhub key is not set on the server.")
    url = f"{settings.TECHHUB_BASE_URL.rstrip('/')}/{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, json={"api_key": settings.TECHHUB_API_KEY, **payload})
    except httpx.HTTPError:
        # The request may or may not have reached them. Never assume it did not.
        logger.warning("techhub async submit network error endpoint=%s", endpoint)
        return SubmitOutcome("unknown", message="The connection to Techhub dropped.")
    try:
        body = resp.json()
    except ValueError:
        body = None
    out = interpret_submit(resp.status_code, body)
    logger.info("techhub async submit endpoint=%s http=%s outcome=%s", endpoint, resp.status_code, out.kind)
    if out.kind in ("unknown",) and isinstance(body, dict):
        logger.warning("techhub async submit shape endpoint=%s keys=%s", endpoint, sorted(body.keys()))
    return out


async def check(endpoint: str, ref_param: str, ref: str) -> tuple[str, dict | None]:
    """-> ("ok", body) | ("notfound", None) | ("error", None)"""
    if not settings.TECHHUB_API_KEY:
        return "error", None
    url = f"{settings.TECHHUB_BASE_URL.rstrip('/')}/{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url, params={"api_key": settings.TECHHUB_API_KEY, ref_param: ref})
    except httpx.HTTPError:
        return "error", None
    if resp.status_code == 404:
        return "notfound", None
    if resp.status_code != 200:
        return "error", None
    try:
        body = resp.json()
    except ValueError:
        return "error", None
    if isinstance(body, dict) and body.get("success") is False:
        return "error", None
    return "ok", body if isinstance(body, dict) else None
