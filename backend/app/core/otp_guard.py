"""Per-ACCOUNT limits for SMS/email one-time codes (finding S-04).

The per-IP rate limit alone is not enough: an attacker who rotates IPs could request a fresh reset code
(which also reset the guess counter) again and again, getting unlimited guesses and flooding the victim's
phone with SMS. These counters are keyed on the account, not the IP, and use Redis INCR so parallel
requests are each counted. Redis being down fails OPEN (same philosophy as the rest of the app): the
per-IP limiter and the per-code attempt cap still apply.
"""
import logging

from app.core.redis_client import get_redis

log = logging.getLogger(__name__)

REQUESTS_PER_HOUR = 5       # reset codes that can be sent to one account per hour
WRONG_GUESSES_PER_HOUR = 10  # wrong codes across ALL codes issued in an hour


async def _bump(key: str, ttl: int) -> int | None:
    try:
        r = get_redis()
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, ttl)
        return int(n)
    except Exception as e:  # noqa: BLE001
        log.warning("otp_guard redis unavailable (%s) - failing open", e)
        return None


async def allow_code_request(account_id) -> bool:
    n = await _bump(f"otp:req:{account_id}", 3600)
    return n is None or n <= REQUESTS_PER_HOUR


async def note_wrong_guess(account_id) -> None:
    await _bump(f"otp:bad:{account_id}", 3600)


async def guesses_exhausted(account_id) -> bool:
    try:
        v = await get_redis().get(f"otp:bad:{account_id}")
        return v is not None and int(v) >= WRONG_GUESSES_PER_HOUR
    except Exception:  # noqa: BLE001
        return False
