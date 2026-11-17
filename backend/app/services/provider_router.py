"""
Which supplier serves a purchase, and when to switch.

  * VTU (GYKDATASUB) DATA plans are only sold by GYKDATASUB; Monnify "Standard" data plans only by Monnify. They are different
    products, so data has no plan-to-plan failover. Instead the app shows the other catalogue when one supplier is down.
  * AIRTIME is just "network + amount", so either supplier can serve it. The director picks the primary (default Monnify) and
    an automatic backup. A supplier counts as DOWN when the monitor says so, or after repeated definite provider-side failures.

Safety rule that makes failover safe: we only ever move to the other supplier when the first one DEFINITELY did not buy anything
(it rejected the request, or could not be reached). An ambiguous outcome (timeout after sending) is never retried elsewhere,
because the first supplier may have delivered: it stays pending and is checked later.
"""
from __future__ import annotations

import logging
import re

from app.integrations.gyk import NETWORK_SLUGS, get_vtu_provider
from app.models.bill_payment import Biller, BillerCategory

logger = logging.getLogger("monieking.router")

PROVIDERS = ("monnify", "vtu")
DOWN_TTL_SECONDS = 300
TRIP_AFTER = 3                  # definite provider-side failures inside the window that mark a supplier down
FAIL_WINDOW_SECONDS = 300

# A rejection caused by what the customer typed is NOT a reason to switch supplier.
_CUSTOMER_ERROR = re.compile(r"invalid (phone|number|mobile|account|customer|meter)|not a valid|wrong (number|network)|minimum|maximum|amount.*(low|high)|prefix|validation|verify|check the phone", re.I)


def looks_like_customer_error(text: str | None) -> bool:
    return bool(text and _CUSTOMER_ERROR.search(text))


def other(name: str) -> str:
    return "vtu" if name == "monnify" else "monnify"


async def _redis():
    from app.core.redis_client import get_redis
    return get_redis()


async def is_down(name: str) -> bool:
    try:
        return bool(await (await _redis()).get(f"prov:down:{name}"))
    except Exception:  # noqa: BLE001 -- no Redis: assume up rather than block sales
        return False


async def mark_down(name: str, seconds: int = DOWN_TTL_SECONDS) -> None:
    try:
        await (await _redis()).set(f"prov:down:{name}", "1", ex=seconds)
    except Exception:  # noqa: BLE001
        pass


async def clear_down(name: str) -> None:
    try:
        await (await _redis()).delete(f"prov:down:{name}", f"prov:fail:{name}")
    except Exception:  # noqa: BLE001
        pass


async def note_failure(name: str) -> bool:
    """One definite provider-side failure. Returns True if this tipped the supplier into 'down'."""
    try:
        r = await _redis()
        key = f"prov:fail:{name}"
        n = int(await r.incr(key))
        if n == 1:
            await r.expire(key, FAIL_WINDOW_SECONDS)
        if n >= TRIP_AFTER:
            await mark_down(name)
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


async def note_success(name: str) -> None:
    try:
        await (await _redis()).delete(f"prov:fail:{name}")
    except Exception:  # noqa: BLE001
        pass


def network_slug(biller: Biller) -> str | None:
    """GYKDATASUB network id for a Monnify airtime biller, from its name. None = cannot tell, so no VTU for this one."""
    from app.services.bill_config import network_of_biller_name
    net = network_of_biller_name(f"{biller.name} {biller.product_name}")
    return NETWORK_SLUGS.get(net) if net else None


def vtu_ready() -> bool:
    return get_vtu_provider().configured


async def providers_for(biller: Biller, cfg: dict) -> list[str]:
    """Ordered suppliers to try for this purchase (first = preferred)."""
    if getattr(biller, "provider", "monnify") == "vtu":
        return ["vtu"]
    if biller.category != BillerCategory.AIRTIME:
        return ["monnify"]
    primary = cfg.get("airtime_provider", "monnify")
    primary = primary if primary in PROVIDERS else "monnify"
    can_vtu = vtu_ready() and network_slug(biller) is not None
    if primary == "vtu" and not can_vtu:
        primary = "monnify"
    order = [primary]
    if cfg.get("provider_auto_failover", True) and (primary == "vtu" or can_vtu):
        order.append(other(primary))
    # A supplier already known to be down goes to the back of the line (never removed: it might have recovered).
    if len(order) == 2 and await is_down(order[0]) and not await is_down(order[1]):
        order.reverse()
    return order
