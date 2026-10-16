"""Pure refund rules (no database), unit tested."""
import uuid


def refund_reference(job_id: uuid.UUID) -> str:
    return f"RF-{job_id.hex}"


def amount_to_refund(charges_kobo: list[int], already_refunded: bool) -> int:
    """Pure rule: refund everything charged, once."""
    if already_refunded:
        return 0
    return max(0, sum(c for c in charges_kobo if c and c > 0))


def naira(kobo: int) -> str:
    return f"₦{kobo / 100:,.2f}".replace(".00", "")
