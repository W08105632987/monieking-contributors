"""Director journal: automatic record of EVERYTHING a director or admin does.

Pure ASGI middleware, so it cannot be forgotten by a new endpoint. It watches every state-changing request
(POST/PUT/PATCH/DELETE). `get_current_user` marks the request as a director/admin one (scope["state"]["journal_actor"]);
when the response is finished a row is written to `director_activity` in its own session, so a journal failure can
never break the action itself. Secrets (passwords, PINs, OTPs, tokens) are redacted before anything is stored.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
MAX_BODY = 64 * 1024
# Never journal these (the journal itself, heartbeats, push registration, read-only POSTs).
SKIP = ("/director-journal", "/push", "/auth/refresh", "/auth/logout", "/notifications/read", "/users/me/heartbeat")
SECRET = re.compile(r"(pass|pin|otp|secret|token|code|cvv|bvn|nin|signature|assertion|authorization|image|photo|base64)", re.I)
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")

# Friendly names for the actions people care about most. Anything else is humanised from the URL automatically.
LABELS: list[tuple[str, str, str]] = [
    ("/food-conversion/remind",      "Sent food-card completion reminders", "food"),
    ("/food-conversion/convert-now", "Converted overdue food cards now", "food"),
    ("/food-conversion/deadline",    "Changed the food-card deadline", "food"),
    ("/food-conversion/template",    "Edited the food-card reminder message", "food"),
    ("/marking/correct",             "Corrected a wrong card marking", "cards"),
    ("/disputes/marking",            "Reported a wrong marking", "disputes"),
    ("/customers/move",              "Moved customers between zones", "zones"),
    ("/community/admin",             "Changed the WhatsApp pop-up / support contact", "settings"),
    ("fund-wallet",            "Funded a customer's wallet manually", "wallet"),
    ("debit-wallet",           "Debited a customer's wallet manually", "wallet"),
    ("change-phone",           "Changed a person's phone number", "accounts"),
    ("correct-name",           "Corrected a person's name", "accounts"),
    ("reset-password",         "Reset a customer's login password", "security"),
    ("send-password",          "Sent a customer a new password", "security"),
    ("reset-payment-pin",      "Reset a customer's payment PIN", "security"),
    ("reset-withdrawal-password", "Reset a customer's withdrawal password", "security"),
    ("/convert",               "Converted a food card to a regular card", "cards"),
    ("/close",                 "Closed a card", "cards"),
    ("/resolve",               "Resolved a dispute", "disputes"),
    ("/escalate",              "Escalated a dispute", "disputes"),
    ("/claim",                 "Claimed an item to work on", "disputes"),
    ("/assign",                "Assigned a customer to a zone", "zones"),
    ("/unassign",              "Removed a customer from a zone", "zones"),
    ("/reassign",              "Moved a customer to another zone", "zones"),
    ("/approve",               "Approved a request", "approvals"),
    ("/reject",                "Rejected a request", "approvals"),
    ("/suspend",               "Suspended an account", "accounts"),
    ("/activate",              "Activated an account", "accounts"),
    ("/broadcast",             "Sent a broadcast", "messages"),
    ("/message",               "Sent a message to a customer", "messages"),
    ("/settings",              "Changed a business setting", "settings"),
    ("/payout",                "Handled a payout", "payments"),
]
SENSITIVE_HINT = ("password", "pin", "wallet", "fund", "debit", "withdraw", "payout", "approve", "reverse", "convert",
                  "delete", "suspend", "correction", "settings", "reassign", "unassign", "close", "role")


def _redact(v, depth=0):
    if depth > 4:
        return "…"
    if isinstance(v, dict):
        return {k: ("[hidden]" if SECRET.search(str(k)) else _redact(x, depth + 1)) for k, x in list(v.items())[:40]}
    if isinstance(v, list):
        return [_redact(x, depth + 1) for x in v[:20]]
    if isinstance(v, str):
        return v if len(v) <= 300 else v[:300] + "…"
    return v


def describe(method: str, path: str, route: str | None) -> tuple[str, str, bool]:
    """-> (label, category, sensitive)"""
    p = (route or path).lower()
    for needle, label, cat in LABELS:
        if needle in p:
            return label, cat, True if cat in ("wallet", "security", "approvals", "accounts", "cards", "zones", "settings") else any(h in p for h in SENSITIVE_HINT)
    parts = [s for s in re.split(r"/", p) if s and not s.startswith("{") and not UUID_RE.match(s) and not s.isdigit()]
    parts = [s for s in parts if s not in ("api", "v1")]
    resource = parts[0] if parts else "item"
    last = parts[-1] if parts else "item"
    verb = {"POST": "Created / ran", "PUT": "Updated", "PATCH": "Updated", "DELETE": "Deleted"}[method]
    human = last.replace("-", " ").replace("_", " ")
    label = f"{human.capitalize()}" if last != resource else f"{verb} {human}"
    if last != resource:
        label = f"{label} ({resource.replace('-', ' ')})"
    return label[:160], resource.replace("-", "_")[:40], any(h in p for h in SENSITIVE_HINT) or method == "DELETE"


class JournalMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] not in MUTATING or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        if any(s in scope["path"] for s in SKIP):
            return await self.app(scope, receive, send)

        scope.setdefault("state", {})
        body_chunks: list[bytes] = []
        size = 0

        async def spy_receive() -> Message:
            nonlocal size
            msg = await receive()
            if msg["type"] == "http.request" and size < MAX_BODY:
                chunk = msg.get("body", b"")
                body_chunks.append(chunk)
                size += len(chunk)
            return msg

        status = {"code": 500}

        async def spy_send(msg: Message):
            if msg["type"] == "http.response.start":
                status["code"] = msg["status"]
            await send(msg)

        try:
            await self.app(scope, spy_receive, spy_send)
        finally:
            actor = scope["state"].get("journal_actor")
            if actor:
                try:
                    await self._write(scope, actor, b"".join(body_chunks), status["code"])
                except Exception:  # the journal must never break the real action
                    log.exception("director journal write failed")

    async def _write(self, scope: Scope, actor: dict, raw: bytes, code: int):
        from sqlalchemy import select
        from app.core.database import AsyncSessionLocal
        from app.models.director_activity import DirectorActivity
        from app.models.user import User

        method = scope["method"]
        path = scope["path"]
        route_obj = scope.get("route")
        route = getattr(route_obj, "path", None)
        label, category, sensitive = describe(method, path, route)

        details: dict = {}
        try:
            if raw and raw.lstrip()[:1] in (b"{", b"["):
                details["body"] = _redact(json.loads(raw))
        except Exception:
            pass
        q = scope.get("query_string", b"").decode()[:300]
        if q:
            details["query"] = q

        target_id = None
        number_ref = None
        for k, v in (scope.get("path_params") or {}).items():
            if UUID_RE.match(str(v)):
                try:
                    target_id = uuid.UUID(str(v))
                    break
                except ValueError:
                    pass
            elif str(v).isdigit() and k in ("user_id", "customer_id", "user_ref") and number_ref is None:
                number_ref = int(v)   # the short public customer number used in URLs
        client = scope.get("client")
        headers = dict(scope.get("headers") or [])
        async with AsyncSessionLocal() as db:
            target_name = None
            if target_id is None and number_ref is not None:
                row = (await db.execute(select(User.id, User.full_name).where(User.customer_number == number_ref))).first()
                if row:
                    target_id, target_name = row
            if target_id and target_name is None:
                target_name = (await db.execute(select(User.full_name).where(User.id == target_id))).scalar_one_or_none()
            db.add(DirectorActivity(
                actor_id=uuid.UUID(actor["id"]), actor_name=actor["name"], method=method, path=path[:500], route=route,
                label=label + ("" if code < 400 else " (FAILED)"), category=category, sensitive=sensitive,
                target_id=target_id, target_name=target_name, details=details or None, status_code=code,
                ip_address=(client[0] if client else None), user_agent=(headers.get(b"user-agent", b"").decode()[:300] or None),
                created_at=datetime.now(timezone.utc),
            ))
            await db.commit()

            if sensitive and code < 400:
                await self._tell_other_directors(db, actor, label, target_name)

    async def _tell_other_directors(self, db, actor: dict, label: str, target_name: str | None):
        from sqlalchemy import select
        from app.models.user import User, UserRole
        from app.models.notification import NotificationType
        from app.services.notification_service import send_notification
        ids = (await db.execute(select(User.id).where(User.role == UserRole.DIRECTOR, User.id != uuid.UUID(actor["id"])))).scalars().all()
        for uid in ids:
            await send_notification(db, user_id=uid, title="Director Journal",
                                    body=f"{actor['name']}: {label}" + (f" — {target_name}" if target_name else ""),
                                    type=NotificationType.INFO, related_entity_id=uuid.UUID(actor["id"]),
                                    deep_link_url=f"/director/journal/{actor['id']}")
        await db.commit()
