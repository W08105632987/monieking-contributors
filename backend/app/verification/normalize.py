"""Input validation and display helpers. Pure functions, no I/O."""
import re
from datetime import date, datetime

from app.verification.constants import METHODS

_DIGITS11 = re.compile(r"^\d{11}$")
_NAME = re.compile(r"^[A-Za-z][A-Za-z '\-]{0,59}$")


class InputError(ValueError):
    """Message is safe to show the customer."""


def _digits(value) -> str:
    return re.sub(r"[\s\-]", "", str(value or ""))


def normalize_phone(value) -> str:
    """Accepts 08012345678, +2348012345678, 2348012345678, 8012345678."""
    s = _digits(value)
    if s.startswith("+"):
        s = s[1:]
    if s.startswith("234") and len(s) == 13:
        s = "0" + s[3:]
    elif len(s) == 10 and s[0] in "789":
        s = "0" + s
    if not _DIGITS11.match(s) or s[0] != "0":
        raise InputError("Enter a valid 11-digit phone number.")
    return s


def normalize_dob(value) -> str:
    """Accepts YYYY-MM-DD (the form's date input) or DD-MM-YYYY / DD/MM/YYYY.
    Returns DD-MM-YYYY, the format Techhub expects."""
    s = str(value or "").strip()
    d = None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            d = datetime.strptime(s, fmt).date()
            break
        except ValueError:
            continue
    if d is None:
        raise InputError("Enter a valid date of birth.")
    if d > date.today() or d.year < 1900:
        raise InputError("Enter a valid date of birth.")
    return d.strftime("%d-%m-%Y")


def _name(value, label: str) -> str:
    s = re.sub(r"\s+", " ", str(value or "").strip())
    if not _NAME.match(s):
        raise InputError(f"Enter a valid {label}.")
    return s.upper()


def normalize_inputs(method: str, fields: dict) -> dict:
    """Returns the exact JSON fields to send to Techhub (minus api_key).
    Only the fields belonging to `method` are read; anything else the
    client sent is ignored."""
    if method not in METHODS:
        raise InputError("Unknown verification method.")
    fields = fields or {}
    if method in ("nin", "bvn"):
        v = _digits(fields.get(method))
        if not _DIGITS11.match(v):
            raise InputError(f"Enter a valid 11-digit {method.upper()}.")
        return {method: v}
    if method == "phone":
        return {"phone": normalize_phone(fields.get("phone"))}
    out = {
        "firstname": _name(fields.get("firstname"), "first name"),
        "lastname": _name(fields.get("lastname"), "last name"),
        "dob": normalize_dob(fields.get("dob")),
    }
    g = str(fields.get("gender") or "").strip().upper()
    if g:
        if g not in ("MALE", "FEMALE"):
            raise InputError("Gender must be male or female.")
        out["gender"] = g
    return out


def mask_id(value: str) -> str:
    """12345678901 -> 1234•••8901 style, never the whole number."""
    v = str(value or "")
    if len(v) < 8:
        return "•" * len(v)
    return f"{v[:3]}{'•' * (len(v) - 6)}{v[-3:]}"


def mask_name(value: str) -> str:
    parts = [p for p in str(value or "").split() if p]
    return " ".join(p[0] + "•" * (len(p) - 1) for p in parts)
