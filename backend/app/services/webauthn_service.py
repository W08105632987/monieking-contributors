"""
Real WebAuthn registration + verification, using the already-installed
`webauthn` (py_webauthn) package. This replaces the previous "biometric"
check, which only verified that webauthn_assertion was a non-empty
string — any junk value passed it. Every assertion here is now
cryptographically verified against the user's actual registered
credential, with anti-replay via sign_count.
"""
import json
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    PublicKeyCredentialDescriptor,
    AttestationConveyancePreference,
)
from webauthn.helpers.exceptions import InvalidRegistrationResponse, InvalidAuthenticationResponse

from app.core.config import get_settings
from app.models.user import User
from app.models.webauthn_credential import WebAuthnCredential

settings = get_settings()

CHALLENGE_TTL_MINUTES = 3


async def _set_challenge(db: AsyncSession, user: User, challenge: bytes) -> None:
    # Same reasoning as _consume_challenge below: re-fetch fresh/attached
    # rather than trust whatever `user` object was passed in.
    user = await db.get(User, user.id)
    user.webauthn_challenge = bytes_to_base64url(challenge)
    user.webauthn_challenge_expires_at = datetime.now(timezone.utc) + timedelta(minutes=CHALLENGE_TTL_MINUTES)
    await db.flush()


async def _consume_challenge(db: AsyncSession, user: User) -> bytes:
    """One-time use — cleared immediately whether verification succeeds or not.

    Re-fetches `user` fresh by id first: webauthn_challenge and
    webauthn_challenge_expires_at are deliberately excluded from the
    current_user cache in dependencies.py (short-lived, actively mutated
    mid-flow — caching either risks serving a stale/already-consumed
    challenge), and a cached current_user also isn't session-attached, so
    the clears below wouldn't persist against it either.
    """
    user = await db.get(User, user.id)
    if not user.webauthn_challenge or not user.webauthn_challenge_expires_at:
        raise HTTPException(status_code=400, detail="No pending biometric request. Request a new one and try again.")
    if user.webauthn_challenge_expires_at < datetime.now(timezone.utc):
        user.webauthn_challenge = None
        user.webauthn_challenge_expires_at = None
        await db.flush()
        raise HTTPException(status_code=400, detail="Biometric request expired. Please try again.")

    challenge = base64url_to_bytes(user.webauthn_challenge)
    user.webauthn_challenge = None
    user.webauthn_challenge_expires_at = None
    await db.flush()
    return challenge


# ── Registration (enrolling a new device) ──────────────────────────
async def build_registration_options(db: AsyncSession, user: User) -> dict:
    existing = await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))
    exclude = []
    for c in existing.scalars().all():
        try:
            exclude.append(PublicKeyCredentialDescriptor(id=c.credential_id))
        except ValueError:
            print(f"[webauthn] Skipping corrupt credential row {c.id} for user {user.id}")

    options = generate_registration_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        rp_name=settings.WEBAUTHN_RP_NAME,
        user_id=str(user.id),
        user_name=user.phone_number,
        user_display_name=user.full_name,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=exclude,
    )
    await _set_challenge(db, user, options.challenge)
    return json.loads(options_to_json(options))


async def verify_registration(db: AsyncSession, user: User, credential_json: dict, nickname: str) -> WebAuthnCredential:
    challenge = await _consume_challenge(db, user)

    try:
        verification = verify_registration_response(
            credential=credential_json,
            expected_challenge=challenge,
            expected_origin=settings.webauthn_origin_list,
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            require_user_verification=True,
        )
    except InvalidRegistrationResponse as e:
        print(f"[webauthn] Registration verification failed: {e}")
        raise HTTPException(status_code=400, detail="Could not register this device. Please try again.")

    credential = WebAuthnCredential(
        user_id=       user.id,
        credential_id= verification.credential_id,
        public_key=    verification.credential_public_key,
        sign_count=    verification.sign_count,
        nickname=      nickname,
    )
    db.add(credential)
    await db.flush()
    return credential


# ── Authentication (logging in, or step-up for a sensitive action) ──
async def build_authentication_options(db: AsyncSession, user: User) -> dict:
    creds_result = await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))
    credentials = creds_result.scalars().all()
    if not credentials:
        raise HTTPException(status_code=400, detail="No biometric device registered for this account yet.")

    allow_credentials = []
    for c in credentials:
        try:
            allow_credentials.append(PublicKeyCredentialDescriptor(id=c.credential_id))
        except ValueError:
            print(f"[webauthn] Skipping corrupt credential row {c.id} for user {user.id}")

    options = generate_authentication_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    await _set_challenge(db, user, options.challenge)
    return json.loads(options_to_json(options))


async def verify_authentication(db: AsyncSession, user: User, assertion_json: dict) -> WebAuthnCredential:
    """
    Verifies a WebAuthn assertion against the user's registered
    credentials. Raises 401 on any failure — wrong device, expired/
    missing challenge, or a replayed assertion (sign_count check).
    Returns the matched credential on success.
    """
    challenge = await _consume_challenge(db, user)

    try:
        raw_id_bytes = base64url_to_bytes(assertion_json["rawId"])
    except (KeyError, Exception):
        raise HTTPException(status_code=400, detail="Malformed biometric response")

    cred_result = await db.execute(
        select(WebAuthnCredential).where(
            WebAuthnCredential.user_id == user.id,
            WebAuthnCredential.credential_id == raw_id_bytes,
        )
    )
    matched = cred_result.scalar_one_or_none()
    if not matched:
        raise HTTPException(status_code=401, detail="This device isn't registered to your account")

    try:
        verification = verify_authentication_response(
            credential=assertion_json,
            expected_challenge=challenge,
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=settings.webauthn_origin_list,
            credential_public_key=matched.public_key,
            credential_current_sign_count=matched.sign_count,
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as e:
        print(f"[webauthn] Authentication verification failed: {e}")
        raise HTTPException(status_code=401, detail="Biometric verification failed. Please try again.")

    matched.sign_count = verification.new_sign_count
    matched.last_used_at = datetime.now(timezone.utc)
    await db.flush()
    return matched
