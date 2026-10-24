"""Optional account email (Module D2): verification codes and password-reset codes.
Everything here is best-effort — a failed email never breaks the flow that called it; callers fall back to SMS."""
import re
import secrets
from datetime import datetime, timedelta, timezone

from app.core.security import hash_password, verify_password
from app.integrations.email_sender import send_email

CODE_TTL_MINUTES = 10
MAX_CODE_ATTEMPTS = 5
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")


def normalize_email(value: str | None) -> str | None:
    v = (value or "").strip().lower()
    return v or None


def is_valid_email(value: str | None) -> bool:
    return bool(value) and len(value) <= 254 and bool(_EMAIL_RE.match(value))


def new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(code: str) -> str:
    return hash_password(code)


def check_code(code: str, code_hash: str | None) -> bool:
    return bool(code_hash) and verify_password(code, code_hash)


def expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=CODE_TTL_MINUTES)


def _html(title: str, intro: str, code: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#052E16">'
        f'<h2 style="margin:0 0 12px">{title}</h2><p style="margin:0 0 16px">{intro}</p>'
        f'<div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#ECFDF5;padding:16px;'
        f'text-align:center;border-radius:12px">{code}</div>'
        f'<p style="color:#555;font-size:13px;margin-top:16px">This code expires in {CODE_TTL_MINUTES} minutes. '
        "Never share it with anyone — MonieKing staff will never ask for it.</p>"
        '<p style="color:#888;font-size:12px">If you did not request this, you can ignore this email.</p></div>'
    )


async def send_verification_code(to_email: str, code: str) -> bool:
    text = (f"Your MonieKing email verification code is {code}. It expires in {CODE_TTL_MINUTES} minutes. "
            "Do not share it with anyone.")
    return await send_email(to=[to_email], subject="Verify your email — MonieKing", body=text,
                            html=_html("Verify your email", "Enter this code in the app to confirm your email address.", code))


async def send_reset_code(to_email: str, code: str) -> bool:
    text = (f"Your MonieKing password reset code is {code}. It expires in {CODE_TTL_MINUTES} minutes. "
            "Do not share it with anyone.")
    return await send_email(to=[to_email], subject="Your MonieKing password reset code", body=text,
                            html=_html("Reset your password", "Use this code to choose a new password.", code))
