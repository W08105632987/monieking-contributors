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
