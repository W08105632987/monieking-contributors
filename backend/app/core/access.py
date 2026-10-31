"""Allow-list role guard for customer money/personal data (finding S-10).

Many read endpoints only ever REFUSED two roles (a customer looking at someone else's data, an officer outside
their zone). Any other role fell straight through and was allowed - in particular SERVICE_WORKER could read any
customer's cards, contribution history and profile just by knowing an id. The safe pattern is the reverse:
list who IS allowed and refuse everyone else.
"""
from fastapi import HTTPException

# Roles that may ever look at a customer's cards. (Ownership / zone checks still apply after this.)
CARD_VIEW_ROLES = {"customer", "officer", "director", "admin"}


def _role(user) -> str:
    r = user.role
    return str(r.value if hasattr(r, "value") else r)


def require_card_viewer(user) -> None:
    if _role(user) not in CARD_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")


def forbid_other_people_for_service_worker(user, target_id) -> None:
    """A service worker may only ever see their own profile."""
    if _role(user) == "service_worker" and user.id != target_id:
        raise HTTPException(status_code=403, detail="Access denied")


# ───────────────────────── officers acting for customers (finding S-17) ─────────────────────────
# Everywhere else in the app an officer can only act for customers in THEIR OWN ZONE (cards, withdrawals, profiles).
# Three "officer pays/orders on behalf of a customer" endpoints (bill payments, identity checks, manual services)
# never checked it: an officer could name ANY customer id and the price was taken from THAT customer's wallet,
# and the airtime / electricity token / lookup result went to the officer. This is the one shared check.
async def require_officer_zone_for(db, officer, customer_id) -> None:
    """403 unless the customer exists, is a customer, and is in the officer's own zone."""
    from app.models.user import User, UserRole
    customer = await db.get(User, customer_id)
    if (
        customer is None
        or customer.role != UserRole.CUSTOMER
        or not officer.zone_id
        or customer.zone_id != officer.zone_id
    ):
        raise HTTPException(status_code=403, detail="This customer is not in your zone")


async def require_can_view_customer_data(db, user, customer_id) -> None:
    """Who may read a customer's records: the customer, an officer of their zone, a director or an admin. Nobody else."""
    role = _role(user)
    if role in ("director", "admin"):
        return
    if role == "customer":
        if user.id != customer_id:
            raise HTTPException(status_code=403, detail="Not your request")
        return
    if role == "officer":
        await require_officer_zone_for(db, user, customer_id)
        return
    raise HTTPException(status_code=403, detail="Access denied")
