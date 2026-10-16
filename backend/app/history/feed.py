"""Pure row -> feed-item mappers (no database), unit tested."""
from datetime import datetime, timezone

# Statuses of a bill that never reached payment: not history.
_BILL_UNPAID = {"pending_validation", "validated"}
STATUSES = ("completed", "pending", "failed", "reversed")


def _v(x):
    return x.value if hasattr(x, "value") else str(x)


def _iso(d: datetime | None) -> str:
    return (d or datetime.now(timezone.utc)).isoformat()


def identity_item(req, name: str, category) -> dict:
    status = _v(req.status)
    return {
        "key": f"identity:{req.id}", "source": "identity", "id": str(req.id), "title": name,
        "category": _v(category), "status": status if status in STATUSES else "pending",
        "amount_kobo": req.amount_charged_kobo or 0, "created_at": _iso(req.created_at),
        "detail": req.failure_reason if status == "failed" else None,
    }


def manual_item(req, title: str, refunded_kobo: int = 0) -> dict:
    status = {"successful": "completed", "failed": "failed"}.get(_v(req.status), "pending")
    if status == "failed" and refunded_kobo > 0:
        status = "reversed"      # shown to the customer as "Refunded"
    return {
        "key": f"manual:{req.id}", "source": "manual", "id": str(req.id), "title": title,
        "category": "manual", "status": status, "amount_kobo": req.price_kobo or 0,
        "created_at": _iso(req.created_at),
        "detail": (req.worker_remarks if status in ("failed", "reversed") else None),
        "refunded_kobo": refunded_kobo,
    }


def bill_item(req, title: str) -> dict:
    return {
        "key": f"bill:{req.id}", "source": "bill", "id": str(req.id), "title": title, "category": "bills",
        "status": _v(req.status) if _v(req.status) in STATUSES else "pending",
        "amount_kobo": req.amount_kobo or 0, "created_at": _iso(req.created_at),
        "detail": req.failure_reason if _v(req.status) == "failed" else None,
    }


def verification_item(row: object) -> dict:
    status = {"found": "completed", "not_found": "completed", "failed": "failed"}.get(row.status, "pending")
    name = (row.summary or {}).get("name") if row.status == "found" else None
    title = f"{row.kind.upper()} verification"
    detail = None
    if row.status == "not_found":
        detail = "No record found. You were not charged."
    elif row.status == "failed":
        detail = row.failure_reason or "This check did not complete. You were not charged."
    elif name:
        detail = name
    expired = row.purged_at is not None or (row.expires_at is not None and datetime.now(timezone.utc) >= row.expires_at)
    return {
        "key": f"verification:{row.id}", "source": "verification", "id": str(row.id), "title": title,
        "category": row.kind, "status": status, "amount_kobo": row.fee_kobo or 0,
        "created_at": _iso(row.created_at), "detail": detail,
        "openable": row.status == "found" and not expired,
        "expired": row.status == "found" and expired,
    }


def merge(items: list[dict], limit: int) -> list[dict]:
    return sorted(items, key=lambda i: i["created_at"], reverse=True)[:limit]




def _manual_title(req) -> str:
    def nice(s: str) -> str:
        return str(s or "").replace("_", " ").strip().title()
    return f"{nice(req.service_type)}" if req.service_type else nice(req.service_category)
