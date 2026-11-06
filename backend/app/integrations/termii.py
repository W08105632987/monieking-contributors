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
                    "channel": settings.TERMII_CHANNEL or "generic",
                    "api_key": settings.TERMII_API_KEY,
                },
            )
        except httpx.HTTPError as e:
            print(f"[termii] SMS send failed: {e}")
            await _record_sms(False, f"{type(e).__name__}: {e}")
            return False
        ok = resp.status_code in (200, 201)
        if not ok:
            # Say WHY. Termii's reply explains an empty balance, an unapproved sender ID, a bad number, etc.
            print(f"[termii] SMS rejected: HTTP {resp.status_code}: {resp.text[:200]}")
        await _record_sms(ok, "" if ok else f"HTTP {resp.status_code}: {resp.text[:160]}")
        if ok:
            # Accounting: count what Termii bills us for (one unit per message segment).
            try:
                from app.services.sms_service import count_segments
                from app.services.usage_log import record_usage
                await record_usage("termii.sms", max(1, count_segments(message).get("segments") or 1))
            except Exception:
                pass
        return ok


async def _record_sms(ok: bool, reason: str = "") -> None:
    """Remember the last SMS success / failure so the director can see SMS health. Never raises."""
    try:
        from datetime import datetime, timezone
        from app.core.redis_client import get_redis
        now = datetime.now(timezone.utc).isoformat()
        await get_redis().set("sms:last_ok" if ok else "sms:last_fail", now if ok else f"{now}|{reason[:200]}")
    except Exception:
        pass


async def get_balance() -> dict | None:
    """Termii account balance, e.g. {"balance": 1250.0, "currency": "NGN"}. None if it cannot be read."""
    if not settings.TERMII_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{TERMII_BASE_URL}/get-balance", params={"api_key": settings.TERMII_API_KEY})
        data = resp.json()
        if resp.status_code == 200 and "balance" in data:
            return {"balance": float(data["balance"]), "currency": data.get("currency", "NGN")}
    except Exception:
        pass
    return None
