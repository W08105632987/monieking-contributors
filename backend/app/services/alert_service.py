"""
Central alerting. Everything that needs to tell a human "something is wrong" goes through here, so there is ONE place that:

  * remembers every incident (system_alerts table: what, when, how many times, who acknowledged it, when it recovered),
  * de-duplicates (the same problem happening 500 times is ONE incident with a counter, not 500 emails),
  * delivers by email to every operator (ALERT_EMAIL_TO plus every director with a verified email) and by SMS for critical
    problems (ALERT_PHONE_TO), with a proper HTML email,
  * tells you when it has RECOVERED,
  * and can report whether its own delivery channels are healthy (alerting_status), so a broken mailbox is not a silent failure.

raise_alert / resolve_alert NEVER raise: an alert about a problem must not become a second problem.
"""
from __future__ import annotations

import asyncio
import html as _html
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.integrations.email_sender import send_email
from app.integrations.termii import send_sms
from app.models.system_alert import SystemAlert

logger = logging.getLogger("monieking.alerts")

SEVERITIES = ("info", "warning", "critical")
EMOJI = {"info": "\u2139\ufe0f", "warning": "\u26a0\ufe0f", "critical": "\U0001f534", "resolved": "\u2705"}
COLOR = {"info": "#2563eb", "warning": "#d97706", "critical": "#dc2626", "resolved": "#16a34a"}
# How long an UNRESOLVED incident stays quiet before it is mentioned again ("still happening, 40 times now").
RENOTIFY_AFTER = {"critical": timedelta(minutes=30), "warning": timedelta(hours=3), "info": None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """A timestamp read back without a timezone is UTC. Keeps comparisons safe whatever the database driver returns."""
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def configured_emails() -> list[str]:
    return [e.strip() for e in settings.ALERT_EMAIL_TO.split(",") if e.strip()]


def configured_phones() -> list[str]:
    return [p.strip() for p in settings.ALERT_PHONE_TO.split(",") if p.strip()]


async def alert_recipients(db) -> list[str]:
    """ALERT_EMAIL_TO plus every director who has a verified email on their account. De-duplicated, order kept."""
    emails = configured_emails()
    try:
        from app.models.user import User, UserRole
        rows = (await db.execute(select(User.email).where(
            User.role == UserRole.DIRECTOR, User.email.is_not(None), User.email_verified_at.is_not(None)))).all()
        for (em,) in rows:
            if em and em.lower() not in {e.lower() for e in emails}:
                emails.append(em)
    except Exception:  # noqa: BLE001
        pass
    return emails


def _fmt_detail_value(v) -> str:
    if isinstance(v, (dict, list)):
        import json
        return json.dumps(v, default=str)[:300]
    return str(v)[:300]


def render_text(kind: str, severity: str, title: str, detail: dict | None, occurrences: int = 1) -> str:
    head = {"new": "NEW ALERT", "repeat": f"STILL HAPPENING ({occurrences} occurrences)", "resolved": "RECOVERED"}[kind]
    lines = [f"MonieKing system alert: {head}", "", title, "", f"Severity: {severity}", f"Time: {_now().isoformat()}"]
    for k, v in (detail or {}).items():
        lines.append(f"{k}: {_fmt_detail_value(v)}")
    lines += ["", f"Open the alerts page: {settings.WEBAUTHN_ORIGIN.rstrip('/')}/director/alerts"]
    return "\n".join(lines)


def render_html(kind: str, severity: str, title: str, detail: dict | None, occurrences: int = 1) -> str:
    key = "resolved" if kind == "resolved" else severity
    color = COLOR[key]
    label = {"new": "New alert", "repeat": f"Still happening &middot; {occurrences} occurrences", "resolved": "Recovered"}[kind]
    rows = "".join(
        f'<tr><td style="padding:6px 10px;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap">{_html.escape(str(k))}</td>'
        f'<td style="padding:6px 10px;color:#111827;font-size:13px;word-break:break-word">{_html.escape(_fmt_detail_value(v))}</td></tr>'
        for k, v in (detail or {}).items())
    link = f"{settings.WEBAUTHN_ORIGIN.rstrip('/')}/director/alerts"
    return f"""<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb" cellpadding="0" cellspacing="0">
<tr><td style="background:{color};padding:16px 20px;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">{label} &middot; {_html.escape(key)}</td></tr>
<tr><td style="padding:20px 20px 8px"><div style="font-size:18px;font-weight:700;color:#111827;line-height:1.35">{_html.escape(title)}</div>
<div style="font-size:12px;color:#6b7280;margin-top:6px">{_now().strftime('%d %b %Y, %H:%M UTC')}</div></td></tr>
<tr><td style="padding:8px 10px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table></td></tr>
<tr><td style="padding:16px 20px 22px"><a href="{_html.escape(link)}" style="display:inline-block;background:#14532d;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:999px">Open alerts</a></td></tr>
<tr><td style="padding:12px 20px;background:#f9fafb;color:#9ca3af;font-size:11px">Automated message from the MonieKing monitor. Replies are not read unless a reply-to mailbox is configured.</td></tr>
</table></td></tr></table></body></html>"""


async def _deliver(db, alert: SystemAlert, kind: str, *, sms: bool) -> None:
    subject_tag = {"new": "", "repeat": "[still happening] ", "resolved": "[recovered] "}[kind]
    emoji = EMOJI["resolved"] if kind == "resolved" else EMOJI[alert.severity]
    subject = f"{emoji} MonieKing {subject_tag}{alert.title}"[:200]
    recipients = await alert_recipients(db)
    ok = False
    if recipients:
        ok = await send_email(
            to=recipients, subject=subject, automated=True,
            body=render_text(kind, alert.severity, alert.title, alert.detail, alert.occurrences),
            html=render_html(kind, alert.severity, alert.title, alert.detail, alert.occurrences))
    else:
        logger.error("[alerts] NO RECIPIENTS: set ALERT_EMAIL_TO. Alert not emailed: %s", alert.title)
    alert.emailed_at, alert.email_ok = _now(), ok
    if sms and (alert.severity == "critical" or kind == "resolved"):
        for phone in configured_phones():
            try:
                await send_sms(phone, f"{subject}"[:300])
                alert.sms_at = _now()
            except Exception:  # noqa: BLE001
                pass


async def raise_alert(*, severity: str, category: str, title: str, detail: dict | None = None,
                      dedupe_key: str | None = None, sms: bool | None = None, notify: str = "auto") -> None:
    """Record an incident and tell the operators.

    dedupe_key  same key = same incident. None means "every call is its own incident" (use for one-off events).
    notify      "auto": email on first sight, then again only after RENOTIFY_AFTER while it stays unresolved.
                "always": email every call (the caller has already decided this deserves it).
    sms         force SMS on/off; default is SMS for critical only.
    """
    try:
        severity = severity if severity in SEVERITIES else "warning"
        key = dedupe_key or f"event:{uuid.uuid4().hex}"
        detail = detail or {}
        async with AsyncSessionLocal() as db:
            alert = (await db.execute(select(SystemAlert).where(SystemAlert.dedupe_key == key, SystemAlert.status != "resolved"))).scalar_one_or_none()
            kind = "new"
            if alert is None:
                alert = SystemAlert(severity=severity, category=category, title=title[:200], detail=detail, dedupe_key=key[:200])
                db.add(alert)
                try:
                    await db.flush()
                except IntegrityError:          # a parallel worker just created the same incident
                    await db.rollback()
                    alert = (await db.execute(select(SystemAlert).where(SystemAlert.dedupe_key == key, SystemAlert.status != "resolved"))).scalar_one()
                    kind = "repeat"
            else:
                kind = "repeat"
            if kind == "repeat":
                alert.occurrences += 1
                alert.last_seen_at = _now()
                alert.detail = {**(alert.detail or {}), **detail}
                if _rank(severity) > _rank(alert.severity):
                    alert.severity = severity       # an incident only ever gets MORE severe while it is open
                    alert.title = title[:200]
            send = kind == "new" or notify == "always"
            if not send and kind == "repeat":
                gap = RENOTIFY_AFTER.get(alert.severity)
                send = bool(gap and (alert.emailed_at is None or _now() - _aware(alert.emailed_at) >= gap) and alert.status == "open")
            if send:
                await _deliver(db, alert, "new" if kind == "new" else "repeat", sms=(sms if sms is not None else True))
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.error("[alerts] could not raise alert '%s': %r", title, e)


def _rank(sev: str) -> int:
    return SEVERITIES.index(sev) if sev in SEVERITIES else 1


async def resolve_alert(dedupe_key: str, *, note: str | None = None, sms: bool = True) -> None:
    """Mark the incident recovered and say so, but only if someone was actually told about it."""
    try:
        async with AsyncSessionLocal() as db:
            alert = (await db.execute(select(SystemAlert).where(SystemAlert.dedupe_key == dedupe_key, SystemAlert.status != "resolved"))).scalar_one_or_none()
            if alert is None:
                return
            alert.status, alert.resolved_at = "resolved", _now()
            if note:
                alert.detail = {**(alert.detail or {}), "recovery": note}
            if alert.emailed_at is not None:
                await _deliver(db, alert, "resolved", sms=sms and alert.severity == "critical")
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.error("[alerts] could not resolve alert %s: %r", dedupe_key, e)


def raise_alert_soon(**kwargs) -> None:
    """Fire-and-forget from a request handler: the user's request never waits on (or fails because of) an alert."""
    try:
        asyncio.get_running_loop().create_task(raise_alert(**kwargs))
    except RuntimeError:
        pass


def _mask(email: str) -> str:
    name, _, dom = email.partition("@")
    return f"{name[:2]}***@{dom}" if dom else email


async def alerting_status() -> dict:
    """Is the alert system itself able to reach you? Shown on the director's Alerts page and used by the monitor."""
    last_ok = last_fail = sms_ok = sms_fail = None
    try:
        from app.core.redis_client import get_redis
        r = get_redis()
        last_ok, last_fail = await r.get("mail:last_ok"), await r.get("mail:last_fail")
        sms_ok, sms_fail = await r.get("sms:last_ok"), await r.get("sms:last_fail")
    except Exception:  # noqa: BLE001
        pass
    async with AsyncSessionLocal() as db:
        recipients = await alert_recipients(db)
    transport = "resend+smtp" if (settings.RESEND_API_KEY and settings.SMTP_HOST) else "resend" if settings.RESEND_API_KEY else "smtp" if settings.SMTP_HOST else "none"
    problems: list[str] = []
    if transport == "none":
        problems.append("No email transport is configured (set RESEND_API_KEY, or SMTP_HOST with its login). Alerts CANNOT be emailed.")
    if not recipients:
        problems.append("No alert recipients. Set ALERT_EMAIL_TO, or give a director a verified email.")
    if last_fail and (not last_ok or last_fail.split("|")[0] > last_ok.split("|")[0]):
        problems.append(f"The last email attempt FAILED: {last_fail.split('|', 2)[-1]}")
    if not configured_phones():
        problems.append("No phone numbers for critical SMS alerts (ALERT_PHONE_TO).")
    if not settings.TERMII_API_KEY:
        problems.append("SMS is not configured (TERMII_API_KEY), so critical alerts will not be texted.")
    if not settings.ALERT_HEARTBEAT_URL:
        problems.append("No external watchdog (ALERT_HEARTBEAT_URL). If the whole server goes down nothing can tell you.")
    if not settings.SMTP_REPLY_TO:
        problems.append("No reply-to mailbox (SMTP_REPLY_TO): replies to alert emails go nowhere.")
    return {
        "email_transport": transport, "from": settings.SMTP_FROM_EMAIL, "reply_to": settings.SMTP_REPLY_TO or None,
        "recipients": [_mask(e) for e in recipients], "recipient_count": len(recipients),
        "phones": len(configured_phones()), "sms_configured": bool(settings.TERMII_API_KEY),
        "email_last_ok": last_ok.split("|")[0] if last_ok else None,
        "email_last_fail": last_fail.split("|")[0] if last_fail else None,
        "email_last_fail_reason": last_fail.split("|", 2)[-1] if last_fail else None,
        "sms_last_ok": sms_ok, "sms_last_fail": sms_fail.split("|")[0] if sms_fail else None,
        "heartbeat_configured": bool(settings.ALERT_HEARTBEAT_URL), "sentry_configured": bool(settings.SENTRY_DSN),
        "problems": problems, "ready": not any(p.startswith(("No email transport", "No alert recipients")) for p in problems),
    }
