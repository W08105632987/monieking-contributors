from pydantic import BaseModel, field_validator, ConfigDict
from typing import Optional
import uuid
from datetime import datetime
from app.models.user import UserRole, UserStatus


class UserBase(BaseModel):
    full_name:    str
    phone_number: str
    bank_name:      Optional[str] = None
    bank_code:      Optional[str] = None
    account_number: Optional[str] = None
    account_name:   Optional[str] = None
    next_of_kin_name:  Optional[str] = None
    next_of_kin_phone: Optional[str] = None
    zone_id: Optional[uuid.UUID] = None


class RegisterCustomerRequest(UserBase):
    password:            str
    withdrawal_password: str
    bank_name:      str
    bank_code:      Optional[str] = None
    account_number: str
    account_name:   str
    next_of_kin_name:  str
    next_of_kin_phone: str
    accepted_terms: bool

    @field_validator("accepted_terms")
    @classmethod
    def must_accept_terms(cls, v: bool) -> bool:
        if not v:
            raise ValueError("You must accept the Terms of Service and Privacy Policy to create an account")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("withdrawal_password")
    @classmethod
    def withdrawal_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Withdrawal password must be at least 8 characters")
        if v.isdigit():
            raise ValueError("Withdrawal password can't be all numbers — add a letter or symbol")
        if v.lower() in ("password", "12345678", "qwertyui"):
            raise ValueError("That withdrawal password is too easy to guess — please choose another")
        return v


class CreateOfficerRequest(BaseModel):
    full_name:    str
    phone_number: str
    password:     str
    zone_id:      uuid.UUID


class CreateDirectorRequest(BaseModel):
    full_name:    str
    phone_number: str
    password:     str


class UpdateUserStatusRequest(BaseModel):
    status: UserStatus


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:           uuid.UUID
    customer_number: int
    role:         UserRole
    full_name:    str
    phone_number: str
    bank_name:      Optional[str]
    bank_code:      Optional[str]
    account_number: Optional[str]
    account_name:   Optional[str]
    face_image_url: Optional[str]
    next_of_kin_name:  Optional[str]
    next_of_kin_phone: Optional[str]
    zone_id:             Optional[uuid.UUID]
    zone_name:           Optional[str] = None
    is_manual_customer:  bool
    managing_officer_id: Optional[uuid.UUID]
    status:     UserStatus
    avatar_url: Optional[str]
    location_consent_status: str
    detected_state: Optional[str]
    has_withdrawal_password: bool = False
    bvn_linked: bool = False
    nin_linked: bool = False
    bvn_last4:  Optional[str] = None
    nin_last4:  Optional[str] = None
    sms_alerts_enabled: bool = False
    onboarding_completed: bool = False
    state_of_residence: Optional[str] = None
    referral_code:      Optional[str] = None
    commission_balance_kobo: int = 0
    created_at: datetime
    updated_at: datetime


class UpdateSmsAlertsRequest(BaseModel):
    enabled: bool


class LocationUpdateRequest(BaseModel):
    consent: bool
    latitude:  Optional[float] = None
    longitude: Optional[float] = None


class UpdateBankDetailsRequest(BaseModel):
    bank_name:      str
    bank_code:      str
    account_number: str
    # Password-only for now — biometric step-up removed from this one
    # specific endpoint per instruction (this is the highest-value
    # target for an attacker to redirect: change it once, every future
    # withdrawal follows). Simpler here specifically = less that can go
    # wrong on the single most sensitive write in the app. KYC's own
    # biometric option below is untouched — that request came scoped
    # to bank details only, not biometrics generally, and the frontend
    # already hides biometric UI everywhere via FEATURE_FLAGS regardless.
    withdrawal_password: str


class KycSubmitRequest(BaseModel):
    bvn: Optional[str] = None
    nin: Optional[str] = None
    date_of_birth: Optional[str] = None  # required only when bvn is supplied — ISO "YYYY-MM-DD" from a native date input; converted to Monnify's DD-Mon-YYYY server-side
    auth_method:         str   # "password" | "biometric"
    withdrawal_password: Optional[str] = None
    webauthn_assertion:  Optional[dict] = None

    @field_validator("bvn", "nin")
    @classmethod
    def validate_digits(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not (v.isdigit() and len(v) == 11):
            raise ValueError("Must be exactly 11 digits")
        return v
