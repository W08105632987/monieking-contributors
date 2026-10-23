"""Director-controlled settings for Airtime, Data and Bills, plus the
Nigerian phone-number helpers behind the real number/network validator.

Stored as one JSON blob under system_config key `bills_config`, so the
director can change it live with no deploy. Missing keys fall back to the
defaults below — a fresh install behaves exactly like before."""
import json
import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import get_config_value, set_config_value

CONFIG_KEY = "bills_config"
NETWORKS = ["MTN", "Airtel", "Glo", "9mobile"]

DEFAULTS: dict = {
    "airtime_enabled": True,
    "data_enabled": True,
    "bills_enabled": True,          # electricity + cable TV
    "data_vtu_enabled": True,
    "data_standard_enabled": True,
    "networks": {n: True for n in NETWORKS},
    "min_airtime_naira": 50,
    "max_airtime_naira": 50000,
    "notice": "",                   # optional banner shown above the forms
}

# Best-effort prefix map. Number portability means a prefix is a hint, not proof.
PREFIXES = {
    "MTN": ["0803", "0806", "0703", "0706", "0813", "0816", "0810", "0814", "0903", "0906", "0913", "0916", "0704"],
    "Airtel": ["0802", "0808", "0708", "0812", "0701", "0902", "0907", "0901", "0912", "0904"],
    "Glo": ["0805", "0807", "0705", "0815", "0811", "0905", "0915"],
    "9mobile": ["0809", "0817", "0818", "0909", "0908"],
}


def normalize_phone(raw: str) -> str | None:
    """Returns the 11-digit local form (080…) or None if it can't be a Nigerian mobile number."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("234") and len(digits) == 13:
        digits = "0" + digits[3:]
    if len(digits) == 10 and digits[0] in "789":
        digits = "0" + digits
    if len(digits) != 11 or not re.fullmatch(r"0[789][01]\d{8}", digits):
        return None
    return digits


def detect_network(phone: str) -> str | None:
    for net, pre in PREFIXES.items():
        if phone[:4] in pre:
            return net
    return None


def network_of_biller_name(name: str) -> str | None:
    up = name.upper()
    for n in NETWORKS:
        if n.upper() in up:
            return n
    return None


async def get_bills_config(db: AsyncSession) -> dict:
    raw = await get_config_value(db, CONFIG_KEY)
    cfg = json.loads(json.dumps(DEFAULTS))
    if raw:
        try:
            stored = json.loads(raw)
            nets = stored.pop("networks", {}) or {}
            cfg.update({k: v for k, v in stored.items() if k in DEFAULTS})
            cfg["networks"].update({k: bool(v) for k, v in nets.items() if k in NETWORKS})
        except ValueError:
            pass
    return cfg


async def save_bills_config(db: AsyncSession, patch: dict, actor_id: uuid.UUID) -> dict:
    cfg = await get_bills_config(db)
    nets = patch.get("networks")
    for k, v in patch.items():
        if k == "networks" or k not in DEFAULTS or v is None:
            continue
        cfg[k] = v
    if nets:
        cfg["networks"].update({k: bool(v) for k, v in nets.items() if k in NETWORKS})
    if cfg["min_airtime_naira"] > cfg["max_airtime_naira"]:
        raise ValueError("Minimum airtime cannot be above the maximum.")
    await set_config_value(db, key=CONFIG_KEY, value=json.dumps(cfg), updated_by=actor_id)
    return cfg


def is_vtu_plan(product_name: str, name: str = "") -> bool:
    return "VTU" in f"{name} {product_name}".upper()
