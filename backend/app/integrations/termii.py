"""
Termii SMS integration — used for the forgot-password OTP flow.
TERMII_API_KEY / TERMII_SENDER_ID were already scaffolded in config.py,
never wired up until now.
"""
import httpx
from app.core.config import get_settings

settings = get_settings()

TERMII_BASE_URL = "https://api.ng.termii.com/api"


async def send_sms(phone_number: str, message: str) -> bool:
    """
    Sends a plain SMS via Termii. Returns True on success. Phone numbers
    are normalized to Termii's expected international format (234...).
    """
    if not settings.TERMII_API_KEY:
        # No API key configured yet. In local dev this is genuinely
        # useful — printing what would have been sent lets you test the
        # OTP flow without burning real SMS credits. But the message
        # itself IS the OTP code, so this must never happen in
        # production — if TERMII_API_KEY were ever accidentally left
        # unset there, this would otherwise write live OTP codes
        # straight into the platform's log viewer in plaintext. DEBUG
        # already defaults to False (see core/config.py), so this is
        # safe even if someone forgets to set it explicitly.
        if settings.DEBUG:
            print(f"[termii] TERMII_API_KEY not set — would have sent to {phone_number}: {message}")
        else:
            print(f"[termii] TERMII_API_KEY not set — SMS to {phone_number} not sent")
        return False

    to = phone_number.lstrip("0")
    if not to.startswith("234"):
        to = f"234{to}"

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)) as client:
        try:
            resp = await client.post(
                f"{TERMII_BASE_URL}/sms/send",
                json={
                    "to": to,
                    "from": settings.TERMII_SENDER_ID or "MonieKing",
                    "sms": message,
                    "type": "plain",
                    "channel": "generic",
                    "api_key": settings.TERMII_API_KEY,
                },
            )
        except httpx.HTTPError as e:
            print(f"[termii] SMS send failed: {e}")
            return False
        return resp.status_code in (200, 201)
