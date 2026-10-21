"""
SMS rules (one place):

* An SMS goes out only when something happens on a customer's card (a contribution
  is marked) — or when a director sends a bulk / personal SMS. Ordinary in-app
  notifications never send SMS any more.
* Customers who opted in pay a per-SMS fee set by the directors (per segment).
  - normal customers: taken from their wallet (may go slightly negative, cleared
    by the next funding);
  - customers managed by an officer have no wallet: the fee piles up in
    users.sms_accrued_kobo and is taken off the card at withdrawal.
* Director-initiated SMS is free to the recipient.
* Text is squeezed into the GSM-7 alphabet before sending: one "₦" or "—" silently
  switches a message to Unicode, which cuts a segment from 160 to 70 characters
  and more than doubles the provider bill.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.termii import send_sms
from app.models.user import User

logger = logging.getLogger(__name__)

DEFAULT_FEE_KOBO = 500
DEFAULT_PROVIDER_COST_KOBO = 400

_GSM7 = set(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
_GSM7_EXT = set("^{}\\[~]|€\f")
_REPLACE = {"₦": "N", "—": "-", "–": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", "•": "-", "✓": "", " ": " "}


def compact(text: str) -> str:
    """Rewrite common characters so the message stays in the cheap GSM-7 alphabet."""
    for a, b in _REPLACE.items():
        text = text.replace(a, b)
    return text


def count_segments(text: str) -> dict:
    """Characters, encoding and how many billable segments a message is."""
    if all(c in _GSM7 or c in _GSM7_EXT for c in text):
        units = sum(2 if c in _GSM7_EXT else 1 for c in text)
        single, multi, enc = 160, 153, "GSM-7"
    else:
        units = len(text.encode("utf-16-le")) // 2     # an emoji is two units
        single, multi, enc = 70, 67, "Unicode"
    if units == 0:
        segs = 0
    elif units <= single:
        segs = 1
    else:
        segs = -(-units // multi)
    return {"chars": len(text), "units": units, "encoding": enc, "segments": segs, "per_segment": single if segs <= 1 else multi}


async def get_fee_kobo(db: AsyncSession) -> int:
    from app.services.settings_service import get_config_int
    return max(0, await get_config_int(db, "sms_fee_per_sms_kobo", DEFAULT_FEE_KOBO))


async def get_provider_cost_kobo(db: AsyncSession) -> int:
    from app.services.settings_service import get_config_int
    return max(0, await get_config_int(db, "sms_provider_cost_per_segment_kobo", DEFAULT_PROVIDER_COST_KOBO))


async def send_card_sms(db: AsyncSession, user: User, text: str, *, reason: str = "contribution") -> dict:
    """
    SMS to a customer about their card. Sent only if they opted in; the fee is
    charged only after the provider accepted the message. Never raises.
    """
    out = {"sent": False, "charged_kobo": 0, "segments": 0}
    try:
        if not (user and user.sms_alerts_enabled and user.phone_number):
            return out
        text = compact(text)
        segs = count_segments(text)["segments"]
        out["segments"] = segs
        if not await send_sms(user.phone_number, text):
            return out
        out["sent"] = True
        fee = (await get_fee_kobo(db)) * segs
        if fee <= 0:
            return out
        # current_user objects can be cached/unattached: always charge through an attached row
        row = await db.get(User, user.id)
        if row.is_manual_customer or row.managing_officer_id:
            row.sms_accrued_kobo = (row.sms_accrued_kobo or 0) + fee
            await db.flush()
        else:
            from app.models.wallet import TxCategory
            from app.services.wallet_service import debit_wallet, get_or_create_wallet
            wallet = await get_or_create_wallet(db, row.id)
            await debit_wallet(
                db, wallet=wallet, amount_kobo=fee, category=TxCategory.SMS_FEE,
                reference=f"SMS-{uuid.uuid4().hex[:16]}",
                description=f"SMS alert ({segs} SMS)", initiated_by=row.id,
                allow_negative=True, related_entity_type="sms_fee",
            )
        out["charged_kobo"] = fee
    except Exception as e:  # an SMS problem must never break the contribution that triggered it
        logger.warning("card SMS failed for %s: %s", getattr(user, "id", None), e)
    return out
