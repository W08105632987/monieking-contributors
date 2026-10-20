"""Starting settings for the six Techhub async services, and the three service forms that did not exist
yet. Directors can change every value in the director screen / Service Builder; these are only the
first values. Pure data: unit tested against the service-template engine."""
from __future__ import annotations

from app.services import service_template_engine as eng

# techhub validation_type for each of OUR validation types
VALIDATION_TYPE_MAP = {
    "no_record": "no_record", "sim_validation": "sim", "vnin_validation": "v.nin_validation",
    "update_records": "update_records", "bank_validation": "bank_validation",
    "modification_validation": "modification", "photographic_error": "photo_error",
}

DEFAULT_CONFIGS: dict[str, dict] = {
    "nin_delinking": {
        "endpoint": "delinking.php", "field_map": {"nin": "nin", "email": "email"},
        "applies_when": {"service_type": ["email_retrieval"]},
    },
    "nin_validation": {
        "endpoint": "nin_validation.php", "field_map": {"nin": "nin"},
        "value_maps": {"validation_type": {"from": "service_type", "map": VALIDATION_TYPE_MAP}},
        "applies_when": {"submit_mode": ["single"]},     # bulk jobs stay manual (one NIN per Techhub request)
    },
    "nin_personalization": {
        "endpoint": "personalization.php", "field_map": {"tracking_id": "tracking_id"},
    },
    "bvn_retrieval": {
        "endpoint": "bvn_retrieval.php",
        "field_map": {"first_name": "first_name", "last_name": "last_name", "phone_number": "phone_number"},
        "applies_when": {"service_type": ["phone_number"]},
    },
    "ipe_clearance": {
        "endpoint": "ipe_clearance.php", "field_map": {"tracking_id": "tracking_id"},
    },
    "bvn_crm": {
        "endpoint": "bvn_crm.php", "status_param": "submission_id",
        "field_map": {"batch_id": "batch_id", "ticket_id": "enrollment_ticket_id",
                      "issue_description": "issue_description", "phone_number": "?phone_number",
                      "failure_date": "?failure_date", "additional_notes": "?additional_notes"},
        "file_params": {"screenshot": "screenshot"},
    },
}

TITLES = {
    "nin_delinking": "NIN Delinking", "nin_validation": "NIN Validation", "nin_personalization": "NIN Personalization",
    "bvn_retrieval": "BVN Retrieval", "ipe_clearance": "IPE Clearance", "bvn_crm": "BVN CRM",
}


def _f(key, label, ftype="text", required=False, width="full", section=None, **extra):
    d = {"key": key, "label": label, "type": ftype, "required": required, "width": width}
    if section:
        d["section"] = section
    d.update(extra)
    return d


def _schema(fields: list[dict], files: list[str] | None = None) -> dict:
    s = {"schema_version": eng.SCHEMA_VERSION, "selectors": [], "fields": fields, "fixed_service_type": "standard"}
    if files:
        s["uploaded_file_fields"] = files
    return s


# New services (they did not exist): code -> (tile, title, description, starter price kobo, schema)
NEW_SERVICES: dict[str, dict] = {
    "nin_personalization": {
        "category": "nimc", "title": "NIN Personalization", "price_kobo": 100_000,
        "description": "Get your NIN slip personalized after enrolment, using your NIMC tracking ID.",
        "schema": _schema([
            _f("full_name", "Full Name", "text", True, "full", "Your details"),
            _f("phone_number", "Phone Number", "phone", True, "full", "Your details"),
            _f("tracking_id", "NIMC Tracking ID", "text", True, "full", "Request",
               help="The tracking ID printed on your NIMC enrolment slip."),
        ]),
    },
    "ipe_clearance": {
        "category": "nimc", "title": "IPE Clearance", "price_kobo": 100_000,
        "description": "Clear an IPE (Immediate Photograph Enrolment) error using your tracking ID.",
        "schema": _schema([
            _f("full_name", "Full Name", "text", True, "full", "Your details"),
            _f("phone_number", "Phone Number", "phone", True, "full", "Your details"),
            _f("tracking_id", "Tracking ID", "text", True, "full", "Request",
               help="Letters and numbers only, up to 20 characters."),
        ]),
    },
    "bvn_crm": {
        "category": "bvn", "title": "BVN CRM", "price_kobo": 100_000,
        "description": "Submit a failed BVN enrolment for review and retrieval. Usually 24-48 hours.",
        "schema": _schema([
            _f("batch_id", "Batch ID of the failed enrolment", "text", True, "half", "Enrolment"),
            _f("enrollment_ticket_id", "Ticket ID of the failed enrolment", "text", True, "half", "Enrolment"),
            _f("issue_description", "What went wrong?", "textarea", True, "full", "Enrolment"),
            _f("phone_number", "Phone number used for the enrolment (optional)", "phone", False, "half", "More details"),
            _f("failure_date", "Date it failed (optional)", "date", False, "half", "More details"),
            _f("additional_notes", "Anything else we should know (optional)", "textarea", False, "full", "More details"),
            _f("screenshot", "Screenshot of the failed enrolment", "file", True, "full", "Evidence",
               accept="image/*", help="JPG, PNG or WEBP, up to 5MB."),
        ], files=["screenshot"]),
    },
}
