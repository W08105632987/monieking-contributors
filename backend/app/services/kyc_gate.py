"""KYC gate: customers and officers must finish identity verification (NIN) before they can use the app's services."""
from fastapi import HTTPException

KYC_CODE = "kyc_required"
KYC_MESSAGE = "Please complete your KYC (identity verification) to use this service."


def needs_kyc(user) -> bool:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role in ("customer", "officer") and not (user.nin_linked or user.bvn_linked)


def require_kyc(user) -> None:
    if needs_kyc(user):
        raise HTTPException(status_code=403, detail={"code": KYC_CODE, "message": KYC_MESSAGE})
