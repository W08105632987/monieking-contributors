"""
Placeholder text for the ten live services' form fields (Phase 4a).
==================================================================
These are the hints the ORIGINAL hardcoded forms showed inside empty boxes (e.g. "e.g. John").
The Phase 2 seeds did not carry them, so the template form showed plain empty boxes.

`apply_placeholders` only ADDS a hint where a field has none: it never overwrites text a
director wrote. Standard library only.
"""
from __future__ import annotations

import copy

PLACEHOLDERS: dict[str, dict[str, str]] = {
    "bvn_license": {
        "first_name": "e.g. John",
        "middle_name": "e.g. Emeka",
        "last_name": "e.g. Doe",
        "phone_number": "e.g. 08012345678",
        "nin": "11-digit NIN",
        "bvn": "11-digit BVN (leave blank if none)",
    },
    "bvn_modification": {
        "bvn": "Enter your 11-digit BVN",
        "nin": "Enter your 11-digit NIN",
        "first_name": "Enter first name",
        "middle_name": "Enter middle name",
        "last_name": "Enter last name",
        "phone_number": "Enter phone number",
        "second_phone_number": "Enter alternative phone",
        "address_line_1": "Enter address line 1",
        "address_line_2": "Enter address line 2",
        "town_city": "Enter town/city",
        "lga": "Enter LGA",
        "postal_code": "Enter postal code",
    },
    "bvn_retrieval": {
        "first_name": "e.g. John",
        "middle_name": "e.g. Emeka",
        "last_name": "e.g. Doe",
        "phone_number": "e.g. 08012345678",
        "account_number": "10-digit account number",
        "bank_name": "e.g. Access Bank",
        "bvn": "11-digit BVN (optional if unknown)",
        "crm_details": "Describe the issue or information to investigate in CRM...",
    },
    "cac_registration": {
        "proposed_name_1": "e.g. ABC Ventures",
        "proposed_name_2": "e.g. ABC Global Ventures",
        "proposed_name_3": "e.g. ABC International Ventures",
        "business_address": "Street address of the business",
        "city": "e.g. Lagos",
        "lga": "e.g. Ikeja",
        "email": "e.g. info@business.com",
        "phone": "e.g. 08012345678",
        "proprietor_first_name": "e.g. John",
        "proprietor_middle_name": "e.g. Emeka",
        "proprietor_last_name": "e.g. Doe",
        "proprietor_nin": "11-digit NIN",
        "proprietor_bvn": "11-digit BVN",
        "proprietor_phone": "e.g. 08012345678",
        "proprietor_email": "e.g. john@example.com",
        "proprietor_address": "Full residential address",
        "proprietor_occupation": "e.g. Businessman, Trader, Engineer",
        "director2_full_name": "e.g. Jane Doe",
        "director2_nin": "11-digit NIN",
        "director2_phone": "e.g. 08098765432",
    },
    "nin_attestation": {
        "nin": "11-digit NIN",
        "first_name": "e.g. John",
        "middle_name": "e.g. Emeka",
        "last_name": "e.g. Doe",
        "phone_number": "e.g. 08012345678",
        "address": "Full residential address",
        "destination_country": "e.g. United Kingdom",
        "passport_number": "e.g. A12345678",
    },
    "nin_delinking": {
        "nin": "11-digit NIN",
        "account_to_delink": "Phone number or account to be delinked",
        "first_name": "e.g. John",
        "middle_name": "e.g. Emeka",
        "last_name": "e.g. Doe",
        "phone_number": "e.g. 08012345678",
        "email": "e.g. john@example.com",
        "reason_for_delinking": "Briefly explain why you need to delink this account...",
    },
    "nin_modification": {
        "nin": "Enter 11-digit NIN",
        "first_name": "Enter first name",
        "middle_name": "Enter middle name",
        "last_name": "Enter last name",
        "phone_number": "Enter new phone number (e.g. 08012345678)",
        "address_line_1": "Enter address line 1",
        "address_line_2": "Enter address line 2",
        "town_city": "Enter town/city",
        "postal_code": "Enter postal code",
        "lga_of_origin": "Enter LGA of Origin",
        "village_of_origin": "Enter Village/Town of Origin",
        "place_of_birth": "Enter Place of Birth",
        "resident_lga": "Enter Resident LGA",
        "resident_village": "Enter Resident Village/Town",
        "resident_address": "Enter Full Resident Address",
        "lga_of_birth": "Enter LGA of Birth",
        "village_of_birth": "Enter Village/Town of Birth",
        "father_surname": "Enter Father's Surname",
        "father_firstname": "Enter Father's Firstname",
        "father_lga_of_origin": "Enter Father's LGA",
        "father_village_of_origin": "Enter Village/Town",
        "mother_surname": "Enter Mother's Surname",
        "mother_firstname": "Enter Mother's Firstname",
        "mother_maiden_name": "Enter Mother's Maiden Name",
        "mother_lga_of_origin": "Enter Mother's LGA",
        "mother_village_of_origin": "Enter Village/Town",
    },
    "nin_validation": {
        "nin": "Enter 11-digit NIN",
    },
    "self_service_modification": {
        "nin": "11-digit NIN",
        "first_name": "Enter new first name",
        "middle_name": "Enter new middle name (if applicable)",
        "last_name": "Enter new last name",
        "phone_number": "New phone number (e.g. 08012345678)",
        "address_line_1": "House number, street name",
        "address_line_2": "Estate, area, landmark (optional)",
        "town_city": "e.g. Lagos",
        "lga": "Local Government Area",
        "postal_code": "e.g. 100001",
    },
    "tin_registration": {
        "first_name": "e.g. John",
        "middle_name": "e.g. Emeka",
        "last_name": "e.g. Doe",
        "phone_number": "e.g. 08012345678",
        "email": "e.g. john@example.com",
        "nin": "11-digit NIN",
        "bvn": "11-digit BVN",
        "lga": "Local Government Area",
        "residential_address": "Full residential address",
        "company_name": "e.g. ABC Enterprises Ltd.",
        "rc_number": "e.g. RC1234567",
        "company_email": "e.g. info@company.com",
        "company_phone": "e.g. 08012345678",
        "business_address": "Full registered business address",
        "director_name": "e.g. John Doe",
        "director_nin": "11-digit NIN",
        "director_phone": "e.g. 08012345678",
    },
}


def apply_placeholders(service_code: str, schema: dict) -> tuple[dict, list[str]]:
    """Return (new_schema, keys_changed). Adds a placeholder to fields that have none; the input is not modified."""
    hints = PLACEHOLDERS.get(service_code, {})
    new = copy.deepcopy(schema)
    changed: list[str] = []
    for f in new.get("fields", []):
        if isinstance(f, dict) and f.get("key") in hints and not str(f.get("placeholder", "")).strip():
            f["placeholder"] = hints[f["key"]]
            changed.append(f["key"])
    return new, changed
