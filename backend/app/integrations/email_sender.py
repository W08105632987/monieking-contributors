"""
Plain SMTP email sending — deliberately not a vendor SDK (SendGrid,
Mailgun, SES each have their own client library) since plain SMTP works
identically against any of them via their SMTP relay, without adding a
new dependency per provider. Matches the "one integration module per
capability" pattern already used for SMS (termii.py).

Currently used only for system-health alerts (health_service.py) — not
a general-purpose transactional email sender for customers, since this
app has never needed one (everything customer-facing goes by SMS or
in-app notification).
"""
import logging
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.core.config import settings

logger = logging.getLogger("monieking.email")


async def send_email(*, to: list[str], subject: str, body: str) -> bool:
    """Returns False on any failure rather than raising — callers
    (health_service.py) already have SMS as a second delivery channel
    for the same alert, so one channel failing should never crash the
    monitoring loop that's specifically trying to tell someone
    something else is broken."""
    if not settings.SMTP_HOST or not to:
        logger.warning("[email] SMTP_HOST not configured or no recipients — email not sent. Subject: %s", subject)
        return False

    message = MIMEMultipart()
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = ", ".join(to)
    message["Subject"] = subject
    message.attach(MIMEText(body, "plain"))

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME or None,
            password=settings.SMTP_PASSWORD or None,
            start_tls=settings.SMTP_USE_TLS,
            timeout=15,
        )
        return True
    except Exception as e:
        logger.error("[email] Failed to send '%s' to %s: %s", subject, to, e)
        return False
