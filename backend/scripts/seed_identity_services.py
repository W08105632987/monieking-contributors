"""
Seeds the identity_services catalog.

IMPORTANT — read this before editing SERVICES below:
Every `required_fields` list here was copied from a provider's own
published API reference, not guessed or inferred from what "seems right"
for a Nigerian ID form. Youverify's Nigeria KYC endpoints share one
request shape (POST /v2/api/identity/ng/<type> with {id, isSubjectConsent,
validations}), which is why most rows below look similar — that's the
provider's actual contract, confirmed against docs.youverify.co, not a
design choice we made up.

Round 19 fix: NIN and vNIN are NOT the same endpoint, even though they
share a request shape. NIN -> /v2/api/identity/ng/nin. vNIN has its own
dedicated endpoint -> /v2/api/identity/ng/vnin (confirmed directly against
Youverify's "Verify Virtual National Identification Number (vNIN)" docs
page). vnin_verification below was previously pointed at the NIN endpoint
by mistake — a 16-character vNIN token sent to the NIN endpoint would
either fail outright or, worse, be silently misread as a malformed NIN.

Before adding a NEW row or changing an existing one's required_fields,
re-check the provider's current docs first — field names, required-ness,
and even which endpoint exists at all can change between their doc
revisions. Don't extend this file from memory or by copying a sibling
row's shape without checking.

official_document_note (round 19): distinguishes a REAL government-
issued document (NIN slip — issued only by NIMC, only valid with its
Aztec barcode, which no verification API can produce) from a MonieKing-
generated verification reference (BVN/CAC/TIN) which is a summary of
what was checked, not a substitute for any official certificate. Never
build a look-alike of a real government document from a verification
API's response fields.

Run with:  python -m scripts.seed_identity_services
"""
import asyncio
from app.core.database import AsyncSessionLocal
from app.models.identity_service import IdentityService, IdentityServiceCategory
from sqlalchemy import select, delete

# Shared field shape for every Youverify Nigeria KYC "quick check" endpoint —
# see docs.youverify.co/know-your-customer-services-kyc/id-data-matching-eidv/nigeria
_YOUVERIFY_ID_FIELDS = lambda id_label, id_hint: [
    {"key": "id", "label": id_label, "type": "text", "required": True, "hint": id_hint},
    {"key": "isSubjectConsent", "label": "Customer has consented to this check", "type": "boolean", "required": True},
]

# The real, official NIN slip is issued ONLY by NIMC and is only valid with
# its Aztec barcode — NIMC's own docs state a slip without one "is
# considered invalid and has been illegally tampered with." No verification
# API can produce that document. This note sends the customer to NIMC's own
# free channels instead of implying MonieKing can issue the slip itself.
NIMC_OFFICIAL_NOTE = (
    "This confirms your NIN is valid — it is not the official NIN slip. "
    "MonieKing cannot issue that document; only NIMC can. Get your free, "
    "official slip (with the required security barcode) via the NINAuth "
    "app or the NIMC self-service portal at nimc.gov.ng."
)


def _reference_note(service_label: str, official_doc_label: str) -> str:
    """Generic clarification for services whose real-world official
    document (a bank BVN slip, a CAC certificate, a FIRS TIN certificate)
    also can't be reissued by a verification API. The downloadable PDF for
    these is a MonieKing verification reference, not that document."""
    return (
        f"This is a MonieKing verification reference confirming a {service_label} check was run and its result — "
        f"it is not, and does not replace, an official {official_doc_label}."
    )


SERVICES = [
    # ── NIMC (grouped under the "NIMC services" quick-action tile) ──────
    dict(category=IdentityServiceCategory.NIMC, code="nin_verification", name="NIN verification",
         provider="youverify", provider_endpoint="/v2/api/identity/ng/nin", is_active=True, price_kobo=5000,
         official_document_note=NIMC_OFFICIAL_NOTE,
         required_fields=_YOUVERIFY_ID_FIELDS("National Identification Number (NIN)", "11 digits")),
    dict(category=IdentityServiceCategory.NIMC, code="vnin_verification", name="Virtual NIN (vNIN) verification",
         provider="youverify", provider_endpoint="/v2/api/identity/ng/vnin", is_active=True, price_kobo=5000,
         official_document_note=NIMC_OFFICIAL_NOTE,
         required_fields=[
             {"key": "id", "label": "Virtual NIN (vNIN)", "type": "text", "required": True, "hint": "starts with YV, ends with FY"},
             {"key": "isSubjectConsent", "label": "Customer has consented to this check", "type": "boolean", "required": True},
         ]),  # FIXED round 19 — was pointed at the plain NIN endpoint; vNIN has its own endpoint (see module docstring).
    dict(category=IdentityServiceCategory.NIMC, code="nin_personalisation", name="NIN personalisation",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — gated behind NIMC FEP license, no live API yet. Do not populate fields until a real integration exists.
    dict(category=IdentityServiceCategory.NIMC, code="nin_modification", name="NIN modification",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — same as above.
    dict(category=IdentityServiceCategory.NIMC, code="nin_validation", name="NIN validation",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — confirm with provider whether this differs from plain verification before activating.

    # ── BVN (grouped under the "BVN services" quick-action tile) ────────
    dict(category=IdentityServiceCategory.BVN, code="bvn_verification", name="BVN verification",
         provider="youverify", provider_endpoint="/v2/api/identity/ng/bvn", is_active=True, price_kobo=5000,
         official_document_note=_reference_note("BVN", "BVN slip/certificate from your bank"),
         required_fields=[
             {"key": "id", "label": "Bank Verification Number (BVN)", "type": "text", "required": True, "hint": "11 digits"},
             {"key": "isSubjectConsent", "label": "Customer has consented to this check", "type": "boolean", "required": True},
             {"key": "premiumBVN", "label": "Include extended details (gender, address, watchlist status)", "type": "boolean", "required": False},
         ]),
    dict(category=IdentityServiceCategory.BVN, code="bvn_retrieval_phone", name="BVN retrieval — by phone number",
         provider="youverify", provider_endpoint="/v2/api/identity/ng/nin-phone", is_active=False, price_kobo=7500,
         required_fields=[
             {"key": "mobile", "label": "Phone number", "type": "text", "required": True, "hint": "e.g. 080XXXXXXXX"},
             {"key": "isSubjectConsent", "label": "Customer has consented to this check", "type": "boolean", "required": True},
         ]),  # DEACTIVATED (round 19) — this was live and charging N75/lookup while actually calling
              # Youverify's NIN-by-phone endpoint, not a BVN one. It was returning NIN data under a
              # service labeled "BVN retrieval". Youverify's public docs don't show a distinct
              # BVN-by-phone endpoint as of this pass — confirm one exists (sales/support) before
              # reactivating with a corrected provider_endpoint. If any customer paid for this while
              # it was live, that's worth a manual look/refund pass separately from the code fix.
    dict(category=IdentityServiceCategory.BVN, code="bvn_modification", name="BVN modification",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — gated behind NIBSS/enrollment-bank access, no live API. The 4-step form we mocked up earlier was illustrative only — don't build against it as if it were sourced from a real schema.
    dict(category=IdentityServiceCategory.BVN, code="bvn_retrieval_crm", name="BVN retrieval — by CRM",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Not found in Youverify's public docs as a distinct endpoint — confirm with their sales/support before building this form.
    dict(category=IdentityServiceCategory.BVN, code="ipe_clearance", name="IPE clearance",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — bank/NIBSS-gated, not a Youverify product.
    dict(category=IdentityServiceCategory.BVN, code="bvn_license_onboarding", name="License onboarding creation",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — this is MonieKing's OWN FEP/NIBSS licensing step, not a customer-facing service. Confirm this belongs in the customer catalog at all.
    dict(category=IdentityServiceCategory.BVN, code="bvn_self_service_delinking", name="Self-service delinking",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # Tier 2 — gated.

    # ── Standalone tiles ─────────────────────────────────────────────
    dict(category=IdentityServiceCategory.TIN, code="tin_verification", name="TIN verification",
         provider="youverify", provider_endpoint="/v2/api/verifications/ng/tin", is_active=True, price_kobo=5000,
         official_document_note=_reference_note("TIN", "Tax Identification Number certificate from FIRS"),
         required_fields=[
             {"key": "id", "label": "Tax Identification Number (TIN)", "type": "text", "required": True, "hint": "format like 00000000-0000"},
             {"key": "isSubjectConsent", "label": "Customer has consented to this check", "type": "boolean", "required": True},
         ]),  # NOTE: confirms an EXISTING TIN. Does not register a new one — that still runs through FIRS/CAC directly.
    dict(category=IdentityServiceCategory.TIN, code="tin_registration", name="TIN registration",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # New registration, distinct from verification above — no public API, runs through FIRS/CAC directly per the spec.
    dict(category=IdentityServiceCategory.ATTESTATION, code="attestation", name="Attestation",
         provider="manual", provider_endpoint=None, is_active=False, price_kobo=0,
         required_fields=[]),  # No confirmed provider endpoint yet — clarify exactly what document type this covers before scoping.
    dict(category=IdentityServiceCategory.CAC, code="cac_business_verification", name="CAC+ (business verification)",
         provider="youverify", provider_endpoint="/v2/api/kyb/ng/business", is_active=True, price_kobo=10000,
         official_document_note=_reference_note("CAC business registration", "Certificate of Incorporation / status report from CAC"),
         required_fields=[
             {"key": "registrationNumber", "label": "CAC registration number (RC/BN number)", "type": "text", "required": True, "hint": "e.g. RC1234567"},
             {"key": "isSubjectConsent", "label": "Business has consented to this check", "type": "boolean", "required": True},
         ]),  # Confirms an EXISTING registration. Does not register a new business.
    dict(category=IdentityServiceCategory.VENDOR, code="become_a_vendor", name="Become a vendor",
         provider="youverify", provider_endpoint="/v2/api/kyb/ng/business", is_active=False, price_kobo=0,
         required_fields=[
             {"key": "registrationNumber", "label": "CAC registration number (RC/BN number)", "type": "text", "required": True, "hint": "e.g. RC1234567"},
             {"key": "isSubjectConsent", "label": "Business has consented to this check", "type": "boolean", "required": True},
         ]),  # Reuses the KYB endpoint as a vendor-onboarding gate. is_active=False until the vendor approval workflow (officer/director review step) is designed — running the check isn't the same as having somewhere for the result to go yet.
]

# Codes removed in round 19: "airtime_data" and "bill_payments" used to sit
# here as inactive "manual" placeholders pointing at an unbuilt VTpass
# integration. That feature was since built for real — via Monnify Bills
# Payment (see app/integrations/monnify_bills.py, app/services/
# bill_payment_service.py) — which is a completely separate system from
# this identity-services catalog, not something that belongs in it at all.
# Keeping the old rows around would mean two different "sources of truth"
# claiming to represent the same customer-facing feature. seed() below
# removes them if they're still present from an earlier run.
STALE_CODES_TO_REMOVE = ["airtime_data", "bill_payments"]


async def seed():
    async with AsyncSessionLocal() as session:
        removed = await session.execute(
            delete(IdentityService).where(IdentityService.code.in_(STALE_CODES_TO_REMOVE))
        )
        if removed.rowcount:
            print(f"removed {removed.rowcount} stale row(s): {STALE_CODES_TO_REMOVE}")

        for row in SERVICES:
            existing = (await session.execute(
                select(IdentityService).where(IdentityService.code == row["code"])
            )).scalar_one_or_none()
            if existing:
                # Existing rows aren't overwritten automatically — official_document_note
                # and the vNIN endpoint fix need a one-time backfill on a DB that was
                # already seeded before round 19. Patch just those two fields in place
                # so a re-run heals an existing row instead of silently skipping it.
                changed = False
                if existing.official_document_note != row.get("official_document_note"):
                    existing.official_document_note = row.get("official_document_note")
                    changed = True
                if existing.provider_endpoint != row["provider_endpoint"]:
                    existing.provider_endpoint = row["provider_endpoint"]
                    changed = True
                if existing.is_active != row["is_active"] and row["code"] == "bvn_retrieval_phone":
                    # Only auto-correct is_active for the one known-bad row — never
                    # silently flip is_active for anything else on a re-run.
                    existing.is_active = row["is_active"]
                    changed = True
                print(f"{'patched' if changed else 'skip (exists, no change)'}: {row['code']}")
                continue
            session.add(IdentityService(**row))
            print(f"seeded: {row['code']}  active={row['is_active']}")
        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
