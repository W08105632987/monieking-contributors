"""
Starting templates for the ten live manual services (Phase 2).
==============================================================
Each template is a snapshot of what the hardcoded form in
apps/web/src/components/manual-services/ asks today, plus price rules generated
from the LIVE saved price table (not the code defaults), so the engine charges
exactly what the current charge function charges.

Nothing here touches the database; see scripts/seed_service_templates.py.
Standard library only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.manual_pricing import PRICE_MAP, resolve_category

# ─── Reference data (copied from the forms' constants) ───────────────────────
NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT - Abuja", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
    "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
]
ENROLLMENT_BANKS = [
    ("agency", "Agency"), ("access_bank", "Access Bank"), ("boa_bank", "BOA Bank"),
    ("first_bank", "First Bank"), ("gtbank", "GT Bank"), ("heritage_bank", "Heritage Bank"),
    ("jaiz_bank", "JAIZ Bank"), ("keystone_bank", "Keystone Bank"),
]
EDUCATION_LEVELS = [
    "Primary School", "Secondary School (SSCE/WAEC)", "OND / NCE", "HND / Bachelor Degree (B.Sc)",
    "Master Degree (M.Sc)", "Doctorate (Ph.D)", "None",
]
MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"]
BUSINESS_NATURE = [
    "Trading / Commerce", "Manufacturing / Production", "Construction", "Real Estate", "Agriculture",
    "ICT / Technology", "Education", "Healthcare", "Logistics / Transport", "Financial Services",
    "Consulting / Professional Services", "Entertainment / Media", "Food & Beverage",
    "Fashion / Textiles", "Other",
]
TITLE_OPTIONS = ["Mr.", "Mrs.", "Miss", "Dr.", "Prof.", "Chief", "Alhaji", "Alhaja"]
TIN_BUSINESS_TYPES = [
    "Sole Proprietorship", "Partnership", "Limited Liability Company (LLC)",
    "Public Limited Company (PLC)", "NGO / Non-Profit", "Other",
]
ATTESTATION_PURPOSES = [
    "Travel Abroad", "Employment Abroad", "School Admission Abroad", "Visa Application",
    "Embassy Document", "Bank Account Opening Abroad", "Legal / Court Purposes", "Other",
]

BVN_COMBO_TYPES = ["update_name_dob", "update_name_phone", "update_name_address", "update_dob_phone"]

# Catalog codes that the customer "All services" screen shows as always open today.
ALWAYS_OPEN_CATALOG_CODES = frozenset({
    "nin_modification", "nin_validation", "nin_delinking", "bvn_retrieval", "bvn_modification",
    "bvn_license_onboarding", "tin_registration", "attestation", "cac_registration",
})


# ─── Tiny builders ───────────────────────────────────────────────────────────
def _opts(pairs: list[tuple[str, str]], descriptions: dict[str, str] | None = None) -> list[dict]:
    out = []
    for v, l in pairs:
        o = {"value": v, "label": l}
        if descriptions and v in descriptions:
            o["description"] = descriptions[v]
        out.append(o)
    return out


def _selector(key: str, label: str, pairs: list[tuple[str, str]], descriptions=None, required: bool = True) -> dict:
    return {"key": key, "label": label, "required": required, "options": _opts(pairs, descriptions)}


def _f(key: str, label: str, ftype: str = "text", required: bool = False, width: str = "full",
       section: str | None = None, show: list[dict] | None = None, **extra: Any) -> dict:
    d: dict[str, Any] = {"key": key, "label": label, "type": ftype, "required": required, "width": width}
    if section:
        d["section"] = section
    if show:
        d["visible_when"] = show
    d.update(extra)
    return d


def _in(field_key: str, *values: str) -> list[dict]:
    return [{"field": field_key, "in": list(values)}]


def _state(key: str, label: str, required=True, **kw) -> dict:
    return _f(key, label, "select", required, options=NIGERIAN_STATES, **kw)


def _nin(key="nin", label="NIN (National Identity Number)", required=True, **kw) -> dict:
    return _f(key, label, "digits", required, length=11, sensitive=True, **kw)


def _file(key: str, label: str, required=False, **kw) -> dict:
    return _f(key, label, "file", required, accept="image/*,application/pdf", **kw)


# ─── Price rules from a price table (exactly mirrors manual_pricing.get_price) ─
def rules_from_price_map(category: str, tiers: dict[str, int]) -> list[dict]:
    """Ordered rules that reproduce get_price(category, ...) for the given tiers."""
    tiers = dict(tiers or {})
    per = "bulk_count" if category == "nin_validation" else "flat"

    def rule(when: dict, price: int) -> dict:
        return {"when": when, "price_kobo": int(price), "per": per}

    rules: list[dict] = []
    if category == "bvn_modification":
        # 1) combinations are priced by their type, whatever the bank
        for combo in BVN_COMBO_TYPES:
            rules.append(rule({"service_type": [combo]}, tiers.get(combo, 900_000)))
        singles = {k: v for k, v in tiers.items() if k != "default" and k not in BVN_COMBO_TYPES}
        # 2) the old code let ANY saved key match the enrollment bank first ...
        for k, v in singles.items():
            rules.append(rule({"enrollment_bank": [k]}, v))
        # 3) ... and then fall back to a key matching the service type
        for k, v in singles.items():
            rules.append(rule({"service_type": [k]}, v))
        rules.append(rule({}, tiers.get("default", 700_000)))
        return rules

    for k, v in tiers.items():
        if k != "default":
            rules.append(rule({"service_type": [k]}, v))
    default = tiers.get("default", 100_000 if category == "nin_validation" else 0)
    rules.append(rule({}, default))
    return rules


# ─── The ten services ────────────────────────────────────────────────────────
def _nin_modification() -> tuple[dict, dict]:
    st = "service_type"
    name = ("update_name", "update_name_dob", "update_name_phone")
    phone = ("update_phone", "update_name_phone")
    addr = ("update_address",)
    dobfam = ("update_dob", "update_name_dob")
    fields = [
        _nin(required=True, section="Identity"),
        # name
        _f("first_name", "First Name", "text", True, "third", "New Name", _in(st, *name)),
        _f("middle_name", "Middle Name", "text", True, "third", "New Name", _in(st, *name)),
        _f("last_name", "Last Name", "text", True, "third", "New Name", _in(st, *name)),
        # phone
        _f("phone_number", "New Phone Number", "phone", True, "full", "New Phone Number", _in(st, *phone)),
        # address
        _f("address_line_1", "Address Line 1", "text", True, "full", "New Address", _in(st, *addr)),
        _f("address_line_2", "Address Line 2", "text", True, "full", "New Address", _in(st, *addr)),
        _f("town_city", "Town / City", "text", True, "half", "New Address", _in(st, *addr)),
        _f("postal_code", "Postal Code", "text", True, "half", "New Address", _in(st, *addr)),
        _state("state", "State", True, section="New Address", show=_in(st, *addr)),
        # date of birth & family
        _f("new_dob", "New Date of Birth", "date", True, "half", "Date of Birth & Personal Information", _in(st, *dobfam)),
        _f("marital_status", "Marital Status", "select", True, "half", "Date of Birth & Personal Information", _in(st, *dobfam), options=MARITAL_STATUSES),
        _state("state_of_origin", "State of Origin", True, width="half", section="Date of Birth & Personal Information", show=_in(st, *dobfam)),
        _f("lga_of_origin", "L.G.A of Origin", "text", True, "half", "Date of Birth & Personal Information", _in(st, *dobfam)),
        _f("village_of_origin", "Village/Town of Origin", "text", True, "half", "Date of Birth & Personal Information", _in(st, *dobfam)),
        _f("place_of_birth", "Place of Birth", "text", True, "half", "Date of Birth & Personal Information", _in(st, *dobfam)),
        _f("housing_type", "Hospital or House", "select", True, "half", "Residence", _in(st, *dobfam), options=["Hospital", "House"]),
        _state("resident_state", "Resident State", True, width="half", section="Residence", show=_in(st, *dobfam)),
        _f("resident_lga", "Resident L.G.A", "text", True, "half", "Residence", _in(st, *dobfam)),
        _f("resident_village", "Resident Village/Town", "text", True, "half", "Residence", _in(st, *dobfam)),
        _f("resident_address", "Resident Full Address", "text", True, "full", "Residence", _in(st, *dobfam)),
        _f("education_level", "Level of Education", "select", True, "half", "Birth & Education", _in(st, *dobfam), options=EDUCATION_LEVELS),
        _state("state_of_birth", "State of Birth", True, width="half", section="Birth & Education", show=_in(st, *dobfam)),
        _f("lga_of_birth", "L.G.A of Birth", "text", True, "half", "Birth & Education", _in(st, *dobfam)),
        _f("village_of_birth", "Village/Town of Birth", "text", True, "half", "Birth & Education", _in(st, *dobfam)),
        _f("father_surname", "Father's Surname", "text", True, "half", "Father's Details", _in(st, *dobfam)),
        _f("father_firstname", "Father's Firstname", "text", True, "half", "Father's Details", _in(st, *dobfam)),
        _state("father_state_of_origin", "Father's State of Origin", True, width="half", section="Father's Details", show=_in(st, *dobfam)),
        _f("father_lga_of_origin", "Father's LGA of Origin", "text", True, "half", "Father's Details", _in(st, *dobfam)),
        _f("father_village_of_origin", "Father's Village/Town", "text", True, "half", "Father's Details", _in(st, *dobfam)),
        _f("mother_surname", "Mother's Surname", "text", True, "half", "Mother's Details", _in(st, *dobfam)),
        _f("mother_firstname", "Mother's Firstname", "text", True, "half", "Mother's Details", _in(st, *dobfam)),
        _f("mother_maiden_name", "Mother's Maiden Name", "text", True, "half", "Mother's Details", _in(st, *dobfam)),
        _state("mother_state_of_origin", "Mother's State of Origin", True, width="half", section="Mother's Details", show=_in(st, *dobfam)),
        _f("mother_lga_of_origin", "Mother's LGA of Origin", "text", True, "half", "Mother's Details", _in(st, *dobfam)),
        _f("mother_village_of_origin", "Mother's Village/Town", "text", True, "half", "Mother's Details", _in(st, *dobfam)),
        _file("supporting_document", "Upload Supporting Document (Attestation)", False, section="Supporting Document",
              show=_in(st, *dobfam), help="Optional sworn affidavit or age declaration document"),
    ]
    schema = {
        "schema_version": 1,
        "selectors": [_selector(st, "Modification Type", [
            ("update_name", "Update Name"), ("update_phone", "Update Phone Number"),
            ("update_dob", "Update Date of Birth"), ("update_address", "Update Address"),
            ("update_name_dob", "Update Name & DOB"), ("update_name_phone", "Update Name & Phone"),
        ])],
        "fields": fields,
        "legacy_extras": [{"key": "selected_modification", "from": st, "as": "value"}],
        "uploaded_file_fields": ["supporting_document"],
    }
    meta = {"title": "NIN Modification", "description": "Update your NIN record — name, phone, date of birth, or address."}
    return schema, meta


def _nin_validation() -> tuple[dict, dict]:
    st = "service_type"
    pairs = [
        ("no_record", "No Record Found"), ("sim_validation", "SIM Validation"),
        ("vnin_validation", "v.nin validation"), ("update_records", "Update Records Validation"),
        ("bank_validation", "Bank Validation"), ("modification_validation", "Modification Validation"),
        ("photographic_error", "Photographic Error"),
    ]
    schema = {
        "schema_version": 1,
        "selectors": [
            _selector("submit_mode", "Submission Mode", [("single", "Single NIN"), ("bulk", "Bulk (up to 50 NINs)")]),
            _selector(st, "Validation Type", pairs),
        ],
        "fields": [
            _nin("nin", "NIN Number (11 digits)", True, show=_in("submit_mode", "single")),
            _f("bulk_nins", "Enter NINs (one per line, 11 digits each)", "nin_list", True, section="Bulk",
               show=_in("submit_mode", "bulk"), max_items=50, sensitive=True),
        ],
        # price is multiplied by the number of NINs in bulk mode
        "quantity_from": {"field": "bulk_nins", "when": {"submit_mode": "bulk"}},
        "legacy_extras": [
            {"key": "validation_type", "from": st, "as": "value"},
            {"key": "validation_label", "from": st, "as": "label"},
            {"key": "submit_mode", "from": "submit_mode", "as": "value"},
        ],
    }
    return schema, {"title": "NIN Validation", "description": "Validate or resolve issues with an existing NIN record."}


def _nin_delinking() -> tuple[dict, dict]:
    st = "service_type"
    schema = {
        "schema_version": 1,
        "selectors": [_selector(st, "Delinking Type", [
            ("self_service_delinking", "Self-Service Delinking"), ("email_retrieval", "Email Retrieval Delinking"),
        ], {"self_service_delinking": "Delink your SIM or account from NIN through self-service",
            "email_retrieval": "Delink using email retrieval process"})],
        "fields": [
            _nin("nin", "NIN (National Identity Number)", True, section="NIN Details"),
            _f("account_to_delink", "Account / Phone to Delink", "text", True, "full", "NIN Details"),
            _f("first_name", "First Name", "text", True, "third", "Personal Information"),
            _f("middle_name", "Middle Name", "text", False, "third", "Personal Information"),
            _f("last_name", "Last Name / Surname", "text", True, "third", "Personal Information"),
            _f("dob", "Date of Birth", "date", True, "half", "Personal Information"),
            _f("phone_number", "Phone Number", "phone", True, "half", "Personal Information"),
            _f("email", "Email Address", "email", True, "full", "Personal Information", _in(st, "email_retrieval")),
            _f("reason_for_delinking", "Reason for Delinking", "textarea", False, "full", "Reason for Delinking"),
            _file("supporting_doc_url", "Upload Supporting Document", False, section="Supporting Document",
                  help="Upload any supporting document (e.g. affidavit, ID card, court order)."),
        ],
        "legacy_extras": [
            {"key": "delinking_type", "from": st, "as": "value"},
            {"key": "delinking_label", "from": st, "as": "label"},
        ],
        "uploaded_file_fields": ["supporting_doc_url"],
    }
    return schema, {"title": "NIN Delinking", "description": "Delink a SIM, phone, or account from your NIN."}


def _bvn_modification() -> tuple[dict, dict]:
    st = "service_type"
    name = ("update_name", "update_name_dob", "update_name_phone", "update_name_address")
    phone = ("update_phone", "update_name_phone", "update_dob_phone")
    dob = ("update_dob", "update_name_dob", "update_dob_phone")
    addr = ("update_address", "update_name_address")
    schema = {
        "schema_version": 1,
        "selectors": [
            _selector(st, "Modification Type", [
                ("update_name", "Update Name"), ("update_phone", "Update Phone Number"),
                ("update_dob", "Update Date of Birth"), ("update_address", "Update Address"),
                ("update_name_dob", "Update Name & DOB"), ("update_name_phone", "Update Name & Phone"),
                ("update_name_address", "Update Name & Address"), ("update_dob_phone", "Update DOB & Phone"),
            ]),
            _selector("enrollment_bank", "Enrollment Type (Bank)", list(ENROLLMENT_BANKS)),
        ],
        "fields": [
            _f("bvn", "BVN Number (11 digits)", "digits", True, "full", "Identity", length=11, sensitive=True),
            _nin("nin", "NIN Number (11 digits)", True, section="Identity"),
            _f("first_name", "First Name", "text", True, "third", "New Name", _in(st, *name)),
            _f("middle_name", "Middle Name", "text", False, "third", "New Name", _in(st, *name)),
            _f("last_name", "Last Name", "text", True, "third", "New Name", _in(st, *name)),
            _f("phone_number", "Phone Number", "phone", True, "half", "New Phone", _in(st, *phone)),
            _f("second_phone_number", "Second Phone Number", "phone", False, "half", "New Phone", _in(st, *phone)),
            _f("dob", "Date of Birth", "date", True, "full", "Date of Birth", _in(st, *dob)),
            _f("address_line_1", "Address Line 1", "text", True, "full", "New Address", _in(st, *addr)),
            _f("address_line_2", "Address Line 2", "text", False, "full", "New Address", _in(st, *addr)),
            _f("town_city", "Town / City", "text", True, "half", "New Address", _in(st, *addr)),
            _f("lga", "LGA", "text", True, "half", "New Address", _in(st, *addr)),
            _f("postal_code", "Postal Code", "text", False, "half", "New Address", _in(st, *addr)),
            _state("state", "State", True, width="half", section="New Address", show=_in(st, *addr)),
        ],
        "legacy_extras": [
            {"key": "selected_modification", "from": st, "as": "value"},
            {"key": "enrollment_bank", "from": "enrollment_bank", "as": "label"},
        ],
    }
    return schema, {"title": "BVN Modification", "description": "Update your BVN record through your enrollment bank."}


def _bvn_retrieval() -> tuple[dict, dict]:
    st = "service_type"
    schema = {
        "schema_version": 1,
        "selectors": [_selector(st, "Retrieval Type", [
            ("phone_number", "Phone Number Retrieval"), ("crm_investigation", "CRM Investigation"),
        ], {"phone_number": "Retrieve a lost BVN using a phone number",
            "crm_investigation": "Deep investigation of BVN records via CRM"})],
        "fields": [
            _f("first_name", "First Name", "text", True, "third", "Personal Information"),
            _f("middle_name", "Middle Name", "text", False, "third", "Personal Information"),
            _f("last_name", "Last Name / Surname", "text", True, "third", "Personal Information"),
            _f("dob", "Date of Birth", "date", True, "full", "Personal Information"),
            _f("phone_number", "Phone Number", "phone", True, "full", "Phone & Account Details", _in(st, "phone_number")),
            _f("account_number", "Account Number", "digits", True, "half", "Phone & Account Details", _in(st, "phone_number"), length=10),
            _f("bank_name", "Bank Name", "text", True, "half", "Phone & Account Details", _in(st, "phone_number")),
            _f("bvn", "BVN (if known)", "digits", False, "full", "CRM Investigation Details", _in(st, "crm_investigation"), length=11, sensitive=True),
            _f("crm_account_number", "Account Number", "digits", False, "half", "CRM Investigation Details", _in(st, "crm_investigation"), length=10),
            _f("crm_bank_name", "Bank Name", "text", False, "half", "CRM Investigation Details", _in(st, "crm_investigation")),
            _f("crm_details", "Additional Details / Description", "textarea", True, "full", "CRM Investigation Details", _in(st, "crm_investigation")),
        ],
        "legacy_extras": [
            {"key": "retrieval_type", "from": st, "as": "value"},
            {"key": "retrieval_label", "from": st, "as": "label"},
        ],
        # The old form stored CRM account number / bank under the SAME keys as the phone path.
        # Phase 3 must map these back so workers keep seeing account_number / bank_name.
        "legacy_key_aliases": {"crm_account_number": "account_number", "crm_bank_name": "bank_name"},
    }
    return schema, {"title": "BVN Retrieval", "description": "Retrieve a lost or forgotten BVN by phone number or CRM."}


def _bvn_license() -> tuple[dict, dict]:
    schema = {
        "schema_version": 1,
        "selectors": [_selector("enrollment_bank", "Enrollment Bank", list(ENROLLMENT_BANKS))],
        "fields": [
            _f("first_name", "First Name", "text", True, "third", "Personal Information"),
            _f("middle_name", "Middle Name", "text", False, "third", "Personal Information"),
            _f("last_name", "Last Name / Surname", "text", True, "third", "Personal Information"),
            _f("dob", "Date of Birth", "date", True, "half", "Personal Information"),
            _f("phone_number", "Phone Number", "phone", True, "half", "Personal Information"),
            _nin("nin", "NIN (National Identity Number)", True, section="Identity Numbers"),
            _f("bvn", "Existing BVN (if any)", "digits", False, "full", "Identity Numbers", length=11, sensitive=True),
            _file("screenshot_url", "Upload Document", False, section="Supporting Document (Optional)",
                  help="Upload any relevant document such as a government-issued ID or screenshot."),
        ],
        "fixed_service_type": "bvn_license",
        "legacy_extras": [{"key": "enrollment_bank", "from": "enrollment_bank", "as": "label"}],
        "uploaded_file_fields": ["screenshot_url"],
    }
    return schema, {"title": "BVN License Creation", "description": "Create and register a new BVN with your enrollment bank."}


def _tin_registration() -> tuple[dict, dict]:
    st = "service_type"
    ind, co = _in(st, "individual"), _in(st, "company")
    schema = {
        "schema_version": 1,
        "selectors": [_selector(st, "Registration Type", [
            ("individual", "Individual TIN Registration"), ("company", "Company / Business TIN Registration"),
        ], {"individual": "Register a TIN for a private individual",
            "company": "Register a TIN for a company or business entity"})],
        "fields": [
            _f("title", "Title", "select", False, "full", "Personal Information", ind, options=TITLE_OPTIONS),
            _f("first_name", "First Name", "text", True, "third", "Personal Information", ind),
            _f("middle_name", "Middle Name", "text", False, "third", "Personal Information", ind),
            _f("last_name", "Last Name / Surname", "text", True, "third", "Personal Information", ind),
            _f("dob", "Date of Birth", "date", True, "half", "Personal Information", ind),
            _f("phone_number", "Phone Number", "phone", True, "half", "Personal Information", ind),
            _f("email", "Email Address", "email", False, "full", "Personal Information", ind),
            _nin("nin", "NIN", True, section="Identity & Location", show=ind),
            _f("bvn", "BVN", "digits", False, "full", "Identity & Location", ind, length=11, sensitive=True),
            _state("state_of_origin", "State of Origin", True, width="half", section="Identity & Location", show=ind),
            _f("lga", "LGA", "text", True, "half", "Identity & Location", ind),
            _f("residential_address", "Residential Address", "text", True, "full", "Identity & Location", ind),
            _state("state_of_residence", "State of Residence", True, width="half", section="Identity & Location", show=ind),
            _file("id_card_url", "Upload ID Card", True, section="Means of Identification", show=ind,
                  help="Upload a valid government-issued ID card (NIN slip, International Passport, Driver's License, Voter's Card)."),
            _f("company_name", "Company / Business Name", "text", True, "full", "Company Information", co),
            _f("rc_number", "RC Number (CAC Registration Number)", "text", True, "half", "Company Information", co),
            _f("business_type", "Type of Business", "select", True, "half", "Company Information", co, options=TIN_BUSINESS_TYPES),
            _f("date_of_incorporation", "Date of Incorporation", "date", True, "half", "Company Information", co),
            _f("company_email", "Company Email", "email", True, "half", "Company Information", co),
            _f("company_phone", "Company Phone", "phone", True, "half", "Company Information", co),
            _f("business_address", "Business Address", "text", True, "full", "Company Information", co),
            _f("director_name", "Director Full Name", "text", True, "full", "Director / Proprietor Information", co),
            _nin("director_nin", "Director NIN", True, section="Director / Proprietor Information", show=co),
            _f("director_phone", "Director Phone", "phone", True, "half", "Director / Proprietor Information", co),
            _file("cac_doc_url", "Upload CAC Document", True, section="CAC Certificate / Incorporation Document", show=co),
        ],
        "legacy_extras": [
            {"key": "tin_type", "from": st, "as": "value"},
            {"key": "tin_type_label", "from": st, "as": "label"},
        ],
        "uploaded_file_fields": ["id_card_url", "cac_doc_url"],
    }
    return schema, {"title": "TIN Registration", "description": "Register a Tax Identification Number (TIN) for individuals or companies."}


def _nin_attestation() -> tuple[dict, dict]:
    schema = {
        "schema_version": 1,
        "selectors": [],
        "fields": [
            _nin("nin", "NIN (National Identity Number)", True, section="Personal Information"),
            _f("first_name", "First Name", "text", True, "third", "Personal Information"),
            _f("middle_name", "Middle Name", "text", False, "third", "Personal Information"),
            _f("last_name", "Last Name / Surname", "text", True, "third", "Personal Information"),
            _f("dob", "Date of Birth", "date", True, "half", "Personal Information"),
            _f("gender", "Gender", "select", True, "half", "Personal Information", options=["Male", "Female"]),
            _f("phone_number", "Phone Number", "phone", True, "full", "Personal Information"),
            _f("address", "Residential Address", "text", True, "full", "Personal Information"),
            _f("purpose_of_attestation", "Purpose of Attestation", "select", True, "full", "Attestation Purpose", options=ATTESTATION_PURPOSES),
            _f("destination_country", "Destination Country", "text", False, "full", "Attestation Purpose"),
            _f("passport_number", "International Passport Number", "text", False, "full", "Attestation Purpose"),
            _file("nin_slip_url", "NIN Slip / NIMC Card", True, section="Documents"),
            _file("photo_url", "Recent Passport Photograph", True, section="Documents"),
            _file("additional_doc_url", "Additional Supporting Document (Optional)", False, section="Documents"),
        ],
        "fixed_service_type": "nin_attestation",
        "uploaded_file_fields": ["nin_slip_url", "photo_url", "additional_doc_url"],
    }
    return schema, {"title": "NIN Attestation", "description": "Officially attest your NIN for use abroad or legal purposes."}


def _cac_registration() -> tuple[dict, dict]:
    st = "service_type"
    co = _in(st, "company")
    schema = {
        "schema_version": 1,
        "selectors": [_selector(st, "Registration Type", [
            ("business_name", "Business Name Registration"), ("company", "Limited Liability Company"),
        ], {"business_name": "Register a sole proprietorship or partnership business name (CAC BN)",
            "company": "Incorporate a private limited liability company (CAC RC)"})],
        "fields": [
            _f("proposed_name_1", "1st Choice", "text", True, "full", "Proposed Business Names"),
            _f("proposed_name_2", "2nd Choice", "text", True, "full", "Proposed Business Names"),
            _f("proposed_name_3", "3rd Choice", "text", False, "full", "Proposed Business Names"),
            _f("nature_of_business", "Nature of Business", "select", True, "full", "Business Details", options=BUSINESS_NATURE),
            _f("business_address", "Business Address", "text", True, "full", "Business Details"),
            _f("city", "City", "text", True, "half", "Business Details"),
            _f("lga", "LGA", "text", True, "half", "Business Details"),
            _state("state", "State", True, width="half", section="Business Details"),
            _f("email", "Business Email", "email", True, "half", "Business Details"),
            _f("phone", "Business Phone", "phone", True, "half", "Business Details"),
            _f("proprietor_first_name", "First Name", "text", True, "third", "Proprietor / Director 1 Information"),
            _f("proprietor_middle_name", "Middle Name", "text", False, "third", "Proprietor / Director 1 Information"),
            _f("proprietor_last_name", "Last Name / Surname", "text", True, "third", "Proprietor / Director 1 Information"),
            _nin("proprietor_nin", "NIN", True, section="Proprietor / Director 1 Information"),
            _f("proprietor_bvn", "BVN", "digits", True, "half", "Proprietor / Director 1 Information", length=11, sensitive=True),
            _f("proprietor_dob", "Date of Birth", "date", True, "half", "Proprietor / Director 1 Information"),
            _f("proprietor_phone", "Phone Number", "phone", True, "half", "Proprietor / Director 1 Information"),
            _f("proprietor_email", "Email Address", "email", True, "half", "Proprietor / Director 1 Information"),
            _f("proprietor_address", "Residential Address", "text", True, "full", "Proprietor / Director 1 Information"),
            _f("proprietor_occupation", "Occupation", "text", True, "full", "Proprietor / Director 1 Information"),
            _f("director2_full_name", "Full Name", "text", True, "full", "Director 2 Information", co),
            _nin("director2_nin", "NIN", True, section="Director 2 Information", show=co),
            _f("director2_phone", "Phone Number", "phone", True, "full", "Director 2 Information", co),
            _file("proprietor_id_url", "Proprietor / Director 1 — Valid ID Card", True, section="Documents"),
            _file("proprietor_photo_url", "Proprietor / Director 1 — Passport Photograph", True, section="Documents"),
            _file("director2_id_url", "Director 2 — Valid ID Card", True, section="Documents", show=co),
            _file("director2_photo_url", "Director 2 — Passport Photograph", True, section="Documents", show=co),
            _file("signature_url", "Signature (Optional)", False, section="Documents"),
        ],
        "legacy_extras": [
            {"key": "cac_type", "from": st, "as": "value"},
            {"key": "cac_type_label", "from": st, "as": "label"},
        ],
        "uploaded_file_fields": ["proprietor_id_url", "proprietor_photo_url", "director2_id_url", "director2_photo_url", "signature_url"],
    }
    return schema, {"title": "CAC Registration", "description": "Register your business name or company with the CAC."}


def _self_service_modification() -> tuple[dict, dict]:
    st = "service_type"
    name = ("update_name", "update_name_phone", "update_name_dob")
    phone = ("update_phone", "update_name_phone")
    schema = {
        "schema_version": 1,
        "selectors": [_selector(st, "Modification Type", [
            ("update_name", "Update Name"), ("update_phone", "Update Phone Number"),
            ("update_address", "Update Address"), ("update_name_phone", "Update Name & Phone"),
            ("update_name_dob", "Update Name & DOB"),
        ])],
        "fields": [
            _nin("nin", "NIN (National Identity Number)", True, section="Identity"),
            _f("first_name", "New First Name", "text", True, "third", "New Name", _in(st, *name)),
            _f("middle_name", "New Middle Name", "text", False, "third", "New Name", _in(st, *name)),
            _f("last_name", "New Last Name / Surname", "text", True, "third", "New Name", _in(st, *name)),
            _f("phone_number", "New Phone Number", "phone", True, "full", "New Phone Number", _in(st, *phone)),
            _f("new_dob", "New Date of Birth", "date", True, "full", "New Date of Birth", _in(st, "update_name_dob")),
            _f("address_line_1", "Address Line 1", "text", True, "full", "New Address", _in(st, "update_address")),
            _f("address_line_2", "Address Line 2", "text", False, "full", "New Address", _in(st, "update_address")),
            _f("town_city", "Town / City", "text", True, "half", "New Address", _in(st, "update_address")),
            _f("lga", "LGA", "text", True, "half", "New Address", _in(st, "update_address")),
            _state("state", "State", True, width="half", section="New Address", show=_in(st, "update_address")),
            _f("postal_code", "Postal Code", "text", False, "half", "New Address", _in(st, "update_address")),
            _file("affidavit_url", "Affidavit of Name Change", True, section="Documents", show=_in(st, *name)),
            _file("supporting_doc_url", "Additional Supporting Document (Optional)", False, section="Documents"),
        ],
        "legacy_extras": [
            {"key": "modification_type", "from": st, "as": "value"},
            {"key": "modification_label", "from": st, "as": "label"},
        ],
        "uploaded_file_fields": ["affidavit_url", "supporting_doc_url"],
    }
    return schema, {"title": "Self-Service Modification", "description": "Modify your NIN record directly through the self-service portal."}


_BUILDERS = {
    "nin_modification": _nin_modification,
    "nin_validation": _nin_validation,
    "nin_delinking": _nin_delinking,
    "bvn_modification": _bvn_modification,
    "bvn_retrieval": _bvn_retrieval,
    "bvn_license": _bvn_license,
    "tin_registration": _tin_registration,
    "nin_attestation": _nin_attestation,
    "cac_registration": _cac_registration,
    "self_service_modification": _self_service_modification,
}

SEEDED_SERVICE_CODES = tuple(_BUILDERS)


@dataclass
class SeedTemplate:
    service_code: str
    title: str
    description: str
    schema: dict
    price_rules: list[dict]
    catalog_codes: list[str] = field(default_factory=list)


def catalog_codes_for(service_code: str) -> list[str]:
    """The service code plus every catalog alias that opens it."""
    from app.services.manual_pricing import CATEGORY_ALIASES
    return [service_code] + [a for a, c in CATEGORY_ALIASES.items() if c == service_code]


def build_seed_templates(price_map: dict[str, dict[str, int]] | None = None) -> list[SeedTemplate]:
    """Templates for the ten live services, priced from `price_map` (defaults to the built-in table)."""
    pm = price_map if price_map is not None else PRICE_MAP
    out = []
    for code, builder in _BUILDERS.items():
        schema, meta = builder()
        out.append(SeedTemplate(
            service_code=code,
            title=meta["title"],
            description=meta["description"],
            schema=schema,
            price_rules=rules_from_price_map(code, pm.get(resolve_category(code), {})),
            catalog_codes=catalog_codes_for(code),
        ))
    return out


def initial_enabled(template: SeedTemplate, identity_active_by_code: dict[str, bool]) -> bool:
    """Mirror today's behaviour: cards the customer screen forces open stay open; the rest follow
    the catalog's is_active (defaulting to open when the catalog has no row for them)."""
    if any(c in ALWAYS_OPEN_CATALOG_CODES for c in template.catalog_codes):
        return True
    rows = [identity_active_by_code[c] for c in template.catalog_codes if c in identity_active_by_code]
    return any(rows) if rows else True
