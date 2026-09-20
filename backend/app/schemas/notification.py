from pydantic import BaseModel, Field, field_validator
import uuid


class BroadcastRequest(BaseModel):
    """
    BUG MK-VALIDATION-001 FIX: /notifications/broadcasts used to accept a
    raw `dict` — the only endpoint in the whole route inventory that did
    — so a malformed zone_id (anything uuid.UUID() couldn't parse) hit
    an unhandled ValueError and 500ed instead of the clean 422 every
    other endpoint returns for bad input. A real Pydantic schema gets
    that validation for free: FastAPI rejects a malformed zone_id (or a
    missing/blank title or body) before this function's body ever runs.
    """
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    target_roles: str = "all"   # "all" or a comma-separated list, e.g. "customer,officer"
    zone_id: uuid.UUID | None = None

    @field_validator("target_roles")
    @classmethod
    def validate_target_roles(cls, v: str) -> str:
        if v == "all":
            return v
        allowed = {"customer", "officer", "admin", "director"}
        roles = [r.strip() for r in v.split(",") if r.strip()]
        if not roles or any(r not in allowed for r in roles):
            raise ValueError(f'target_roles must be "all" or a comma-separated list from {sorted(allowed)}')
        return v
