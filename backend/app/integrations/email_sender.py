"""
Email sending, built the way professional systems do it:

  * TWO transports with automatic fallback. If RESEND_API_KEY is set the message goes over HTTPS first (works from hosts
    that block SMTP ports, and a domain verified there gets SPF/DKIM for you). Plain SMTP (any provider's relay) is the
    other transport, and each one backs up the other when both are configured.
  * Each transport is retried with a short back-off before giving up (a single dropped connection must not lose an alert).
  * Proper headers: Date, Message-ID on our own domain, Reply-To, and Auto-Submitted for machine-generated mail so
    auto-responders and out-of-office replies never loop.
  * Every outcome is recorded (when it last worked, when it last failed and why) so the app can SHOW whether email is
    healthy instead of failing silently. See alert_service.alerting_status().

Returns False on any failure rather than raising: callers (alerts, health checks) have other channels, and the monitoring
loop must never crash because one channel is down.
"""
import asyncio
import logging
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid, parseaddr

import aiosmtplib
import httpx

from app.core.config import settings

logger = logging.getLogger("monieking.email")

_BACKOFF_SECONDS = (0, 2, 5)          # three tries per transport


async def _record(ok: bool, transport: str, reason: str = "") -> None:
    """Remember the last success / failure so the director can see email health. Never raises."""
    try:
        from app.core.redis_client import get_redis
        r = get_redis()
        now = datetime.now(timezone.utc).isoformat()
        if ok:
            await r.set("mail:last_ok", f"{now}|{transport}")
        else:
            await r.set("mail:last_fail", f"{now}|{transport}|{reason[:200]}")
    except Exception:
        pass


def _build(to: list[str], subject: str, body: str, html: str | None, automated: bool, reply_to: str | None) -> MIMEMultipart:
    message = MIMEMultipart("alternative") if html else MIMEMultipart()
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = ", ".join(to)
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False)
    domain = parseaddr(settings.SMTP_FROM_EMAIL)[1].split("@")[-1] or "monieking.app"
    message["Message-ID"] = make_msgid(domain=domain)
    rt = reply_to or settings.SMTP_REPLY_TO
    if rt:
        message["Reply-To"] = rt
    if automated:
        message["Auto-Submitted"] = "auto-generated"
        message["X-Auto-Response-Suppress"] = "All"
    message.attach(MIMEText(body, "plain", "utf-8"))
    if html:
        message.attach(MIMEText(html, "html", "utf-8"))
    return message


async def _send_via_resend(to: list[str], subject: str, body: str, html: str | None, automated: bool, reply_to: str | None) -> tuple[bool, str]:
    payload: dict = {"from": settings.SMTP_FROM_EMAIL, "to": to, "subject": subject, "text": body}
    if html:
        payload["html"] = html
    rt = reply_to or settings.SMTP_REPLY_TO
    if rt:
        payload["reply_to"] = rt
    if automated:
        payload["headers"] = {"Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All"}
    last = ""
    for delay in _BACKOFF_SECONDS:
        if delay:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post("https://api.resend.com/emails", json=payload,
                                         headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"})
            if resp.status_code in (200, 201, 202):
                return True, ""
            last = f"HTTP {resp.status_code}: {resp.text[:160]}"
            if resp.status_code in (400, 401, 403, 422):   # a rejected request will not succeed on retry
                break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
    return False, last


async def _send_via_smtp(message: MIMEMultipart) -> tuple[bool, str]:
    implicit_tls = settings.SMTP_PORT == 465          # port 465 = TLS from the first byte; 587 = upgrade with STARTTLS
    last = ""
    for delay in _BACKOFF_SECONDS:
        if delay:
            await asyncio.sleep(delay)
        try:
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST, port=settings.SMTP_PORT,
                username=settings.SMTP_USERNAME or None, password=settings.SMTP_PASSWORD or None,
                use_tls=implicit_tls, start_tls=(settings.SMTP_USE_TLS and not implicit_tls), timeout=15,
            )
            return True, ""
        except aiosmtplib.SMTPAuthenticationError as e:
            return False, f"SMTP login rejected: {e}"          # wrong credentials: retrying only risks a lockout
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
    return False, last


async def send_email(*, to: list[str], subject: str, body: str, html: str | None = None,
                     automated: bool = False, reply_to: str | None = None) -> bool:
    to = [t for t in to if t]
    if not to or not (settings.SMTP_HOST or settings.RESEND_API_KEY):
        logger.warning("[email] no email transport configured (set RESEND_API_KEY or SMTP_HOST) or no recipients -- not sent. Subject: %s", subject)
        await _record(False, "none", "no transport configured or no recipients")
        return False

    errors: list[str] = []
    if settings.RESEND_API_KEY:
        ok, why = await _send_via_resend(to, subject, body, html, automated, reply_to)
        if ok:
            await _record(True, "resend")
            return True
        errors.append(f"resend: {why}")
    if settings.SMTP_HOST:
        ok, why = await _send_via_smtp(_build(to, subject, body, html, automated, reply_to))
        if ok:
            await _record(True, "smtp")
            return True
        errors.append(f"smtp: {why}")

    logger.error("[email] FAILED to send '%s' to %d recipient(s): %s", subject, len(to), " | ".join(errors))
    await _record(False, "all", " | ".join(errors))
    return False
