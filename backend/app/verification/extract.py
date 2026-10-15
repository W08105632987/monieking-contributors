"""Read a person's details out of whatever shape Techhub answers with.

We have never been able to see a live Techhub body, so nothing here assumes
exact key names. Keys are compared after lower-casing and dropping every
non-letter/digit ("First_Name", "firstName", "FIRST NAME" all become
"firstname"), nested objects are flattened, and the slip PDF's own text is a
last-resort source. If after all that no name can be read the caller treats the
lookup as failed (and does not charge).

Pure functions, no I/O, unit tested. Never logs values."""
import io
import re

CANON = ("nin", "bvn", "first_name", "middle_name", "last_name", "gender",
         "date_of_birth", "phone_number", "address")

_EXACT = {
    "first_name": ("firstname", "first", "givenname", "givennames", "forename"),
    "last_name": ("lastname", "surname", "familyname", "last"),
    "middle_name": ("middlename", "middle", "othername", "othernames"),
    "gender": ("gender", "sex"),
    "date_of_birth": ("dateofbirth", "dob", "birthdate", "birthday", "dateofbirthday"),
    "phone_number": ("phonenumber", "phone", "telephoneno", "telephone", "telephonenumber",
                     "mobile", "mobilenumber", "msisdn", "phoneno"),
    "address": ("address", "residenceaddress", "residentialaddress", "residenceaddressline",
                "homeaddress", "residence"),
    "nin": ("nin", "ninnumber", "nationalidentificationnumber", "nationalid", "nationalidnumber"),
    "bvn": ("bvn", "bvnnumber", "bankverificationnumber"),
}
_FULL = ("fullname", "name", "customername", "accountname", "namefull")
_PHOTO_KEYS = ("photo", "image", "picture", "passport", "portrait", "photograph", "avatar", "base64image")


def _norm(k) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k).lower())


def flatten(obj, _depth: int = 0, _out: dict | None = None) -> dict:
    """{normalised key: scalar} for every scalar anywhere in obj. Shallower values win."""
    out = {} if _out is None else _out
    if _depth > 5:
        return out
    if isinstance(obj, dict):
        nested = []
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                nested.append(v)
            elif v is not None and str(v).strip() != "":
                out.setdefault(_norm(k), v)
        for v in nested:
            flatten(v, _depth + 1, out)
    elif isinstance(obj, list):
        for item in obj[:3]:
            flatten(item, _depth + 1, out)
    return out


def _clean(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip()


def key_names(obj) -> list[str]:
    """Key names only (never values) for diagnostics."""
    out: list[str] = []

    def walk(o, prefix, depth):
        if depth > 4 or len(out) > 60:
            return
        if isinstance(o, dict):
            for k, v in o.items():
                name = f"{prefix}{k}"
                if isinstance(v, (dict, list)):
                    walk(v, name + ".", depth + 1)
                else:
                    out.append(name)
        elif isinstance(o, list) and o:
            walk(o[0], prefix + "[].", depth + 1)
    walk(obj, "", 0)
    return out[:60]


def extract_fields(raw) -> dict:
    """Canonical dict from Techhub's person data. Keeps any original top-level
    keys too (harmless, encrypted at rest) so nothing is thrown away."""
    flat = flatten(raw)
    out = dict(raw) if isinstance(raw, dict) else {}
    for canon, names in _EXACT.items():
        val = next((flat[n] for n in names if n in flat), None)
        if val is None:  # loose: "applicantfirstname", "customer_surname", "dateofbirthformatted"
            for k, v in flat.items():
                if canon == "first_name" and "first" in k and "name" in k:
                    val = v
                elif canon == "last_name" and ("surname" in k or ("last" in k and "name" in k)):
                    val = v
                elif canon == "middle_name" and "middle" in k:
                    val = v
                elif canon == "date_of_birth" and ("birth" in k and "place" not in k and "state" not in k
                                                   and "lga" not in k and "country" not in k) or k == "dob":
                    val = v
                elif canon == "gender" and k.endswith(("gender", "sex")):
                    val = v
                elif canon == "phone_number" and ("phone" in k or "mobile" in k):
                    val = v
                elif canon == "nin" and k.endswith("nin"):
                    val = v
                elif canon == "bvn" and k.endswith("bvn"):
                    val = v
                if val is not None:
                    break
        if val is not None and not isinstance(val, (dict, list)):
            out[canon] = _clean(val)
    if not (out.get("first_name") or out.get("last_name")):
        full = next((flat[n] for n in _FULL if n in flat), None)
        if full:
            parts = _clean(full).split(" ")
            out["last_name"] = parts[0]
            if len(parts) > 1:
                out["first_name"] = parts[1]
            if len(parts) > 2:
                out.setdefault("middle_name", " ".join(parts[2:]))
    g = str(out.get("gender") or "").strip().lower()
    if g in ("m", "male"):
        out["gender"] = "Male"
    elif g in ("f", "female"):
        out["gender"] = "Female"
    return out


def photo_from_data(raw) -> bytes:
    """A base64 portrait sent inside the JSON, if any. b'' when none."""
    import base64
    flat = flatten(raw)
    for k, v in flat.items():
        if any(p in k for p in _PHOTO_KEYS) and isinstance(v, str) and len(v) > 400:
            s = v.split("base64,", 1)[1] if "base64," in v[:80] else v
            try:
                b = base64.b64decode("".join(s.split()), validate=False)
            except Exception:
                continue
            if b[:3] == b"\xff\xd8\xff" or b[:8] == b"\x89PNG\r\n\x1a\n":
                return b
    return b""


_LABELS = {
    "last_name": r"(?:sur\s*name|last\s*name)",
    "first_name": r"(?:first\s*name|given\s*name)",
    "middle_name": r"(?:middle\s*name|other\s*names?)",
    "gender": r"(?:gender|sex)",
    "date_of_birth": r"(?:date\s*of\s*birth|d\.?o\.?b)",
    "phone_number": r"(?:phone(?:\s*(?:number|no\.?))?|mobile(?:\s*(?:number|no\.?))?)",
    "nin": r"(?:n\.?i\.?n\.?(?:\s*number)?)",
}


def fields_from_pdf_text(pdf: bytes) -> dict:
    """Best-effort 'Label: value' scrape of the slip PDF's text layer."""
    if not pdf:
        return {}
    try:
        from pypdf import PdfReader
        text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages[:2])
    except Exception:
        return {}
    out = {}
    for canon, label in _LABELS.items():
        m = re.search(rf"(?im)^\s*{label}\s*[:\-]?\s*([^\n]{{1,80}})$", text)
        if not m:
            m = re.search(rf"(?i){label}\s*[:\-]\s*([^\n]{{1,80}})", text)
        if m:
            val = _clean(m.group(1))
            if val and not re.fullmatch(_LABELS_ANY, val, re.I):
                out[canon] = val
    return out


_LABELS_ANY = "|".join(_LABELS.values())


def has_identity(data: dict) -> bool:
    return bool(str(data.get("first_name") or "").strip() or str(data.get("last_name") or "").strip())


def complete(raw_user_data, pdf: bytes, *, id_key: str, requested_id: str) -> dict:
    """Canonical person dict: JSON first, PDF text to fill gaps, requested ID as a last resort
    for the identifier (so a slip can always be bought for a NIN/BVN we were asked about)."""
    data = extract_fields(raw_user_data)
    if not has_identity(data) or not data.get("date_of_birth"):
        for k, v in fields_from_pdf_text(pdf).items():
            if not str(data.get(k) or "").strip():
                data[k] = v
    if not str(data.get(id_key) or "").strip() and requested_id:
        data[id_key] = requested_id
    return data
