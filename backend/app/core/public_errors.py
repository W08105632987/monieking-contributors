"""
Customer-safe error text.

Customers must never see provider / backend / technical wording such as
"Payment provider login failed (HTTP 503)", tracebacks, SQL or URLs. Every
message that can originate from a third party or an exception goes through
`public_message` before reaching a response body. Full detail is still logged
server-side by the callers.
"""
import re

GENERIC_MESSAGE = "Something went wrong on our side. Please try again in a moment."
UNAVAILABLE_MESSAGE = "This service is temporarily unavailable. Please try again in a few minutes."

_TECHNICAL_PATTERNS = [
    r"\bhttp\s*[1-5]\d\d\b",
    r"\bhttp/\d",
    r"\bstatus(?:\s*code)?\s*[:=]?\s*[1-5]\d\d\b",
    r"\b[1-5]\d\d\s+(?:bad gateway|service unavailable|gateway time-?out|internal server error|not found|unauthorized|forbidden)\b",
    r"\bprovider\b",
    r"\bvendor\b",
    r"\bupstream\b",
    r"\bgateway\b",
    r"\bmonnify\b|\btechhub\b|\byouverify\b|\btermii\b|\bsupabase\b|\bpaystack\b|\bflutterwave\b",
    r"login failed",
    r"\bcredentials?\b",
    r"\bapi[\s_-]?key\b|\bsecret\b|\baccess[\s_-]?token\b|\bbearer\b",
    r"\btraceback\b|most recent call last|\bfile \"",
    r"\binternal server error\b",
    r"\b(?:select|insert|update|delete)\b.{0,80}\b(?:from|into|set|where)\b",
    r"\bsql\w*\b|\bpsycopg\w*|\basyncpg\b|\bsqlalchemy\b|\bintegrityerror\b|\bviolates\b|\bconstraint\b",
    r"https?://|\bwww\.",
    r"\b\w+(?:Error|Exception)\b",
    r"\bnon-json\b|\bjson\b|\bunexpected (?:login )?response\b|\braw body\b",
    r"\btimed? ?out\b|\btimeout\b|\bconnection\b|\bconnect\b|\bsocket\b|\bssl\b|\bdns\b",
    r"\b(?:none|null|undefined|nan)\b",
    r"\bkeyerror\b|\battributeerror\b|\btypeerror\b|\bvalueerror\b",
    r"\bnot found:\s*\{",
    r"[{}\[\]]{2,}|\{['\"]",
    r"\bat 0x[0-9a-f]+|\b0x[0-9a-f]{4,}\b",
    r"[A-Za-z]:\\|/(?:usr|app|home|var|etc)/",
    r"\bdetail\b\s*[:=]",
    r"\bMONNIFY_|\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b",
]
_TECHNICAL_RE = re.compile("|".join(f"(?:{p})" for p in _TECHNICAL_PATTERNS), re.IGNORECASE)

_MAX_LEN = 240


def looks_technical(msg) -> bool:
    """True when `msg` is empty, too long, or contains provider/backend wording."""
    if msg is None:
        return True
    if not isinstance(msg, str):
        return True
    text = msg.strip()
    if not text or len(text) > _MAX_LEN or "\n" in text:
        return True
    return _TECHNICAL_RE.search(text) is not None


def public_message(msg, fallback: str = GENERIC_MESSAGE) -> str:
    """Return `msg` if it is safe to show a customer, else `fallback`."""
    if looks_technical(msg):
        return fallback
    return msg.strip()
