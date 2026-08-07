"""
Resolves a bank name (as stored on a user's profile) to the bank code
Monnify's transfer API expects.

This intentionally queries Monnify's own Get Banks list (cached in memory
after the first call) rather than using a hardcoded table. Bank codes are
NOT standardized across payment providers — the newer fintech banks (Opay,
Palmpay, Moniepoint, Kuda, etc.) show different codes on different
providers' lists, and only Monnify's own list is guaranteed correct for
calls to Monnify's own transfer API.
"""
import re
from app.integrations.monnify import get_payment_provider

_bank_code_cache: dict[str, str] | None = None


def _normalize(name: str) -> str:
    name = name.lower()
    name = re.sub(r"\(.*?\)", "", name)   # drop parenthetical abbreviations e.g. "(GTBank)"
    name = re.sub(r"[^a-z0-9 ]", "", name)
    name = re.sub(r"\b(bank|nigeria|plc|of|the|limited|ltd|mfb|microfinance)\b", "", name)
    return re.sub(r"\s+", " ", name).strip()


async def resolve_bank_code(bank_name: str | None) -> str | None:
    global _bank_code_cache
    if not bank_name:
        return None

    if _bank_code_cache is None:
        provider = get_payment_provider()
        try:
            banks = await provider.get_banks()
        except Exception as e:
            # A slow/unreachable Monnify here used to bubble all the way
            # up as an unhandled exception -> generic 500 on withdrawal,
            # instead of the clear "couldn't determine your bank's
            # transfer code" message the withdraw route already has for
            # exactly this situation. Returning None lets that existing,
            # friendlier error path handle it; the cache is left unset so
            # the next attempt retries rather than being stuck on a
            # failure from one bad request.
            print(f"[bank_codes] get_banks() failed (non-fatal): {e}")
            return None
        _bank_code_cache = {
            _normalize(b.get("name", "")): b.get("code", "")
            for b in banks if b.get("code")
        }

    target = _normalize(bank_name)
    if target in _bank_code_cache:
        return _bank_code_cache[target]

    # Fall back to a partial match for slight name variations
    for key, code in _bank_code_cache.items():
        if target in key or key in target:
            return code
    return None