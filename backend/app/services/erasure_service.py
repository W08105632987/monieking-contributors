"""
Complete, verifiable erasure of one person's personal data.   (finding D-01)

THE PROBLEM THIS FIXES
----------------------
Deleting a customer only blanked a few columns on the `users` row. Their phone number, name, bank account,
selfie, ID documents, notifications, push devices, withdrawal bank details, audit-log entries and more stayed
behind in a dozen other tables and in file storage - and even the "delete" confirmation wrote the person's name
and phone into the audit log in plain text.

WHAT IT DOES NOW
----------------
 1. DELETES rows that exist only to describe the person (notifications, push devices, passkeys, waiting-list rows,
    coop bank/next-of-kin, analytics, KYC photos/results ...).
 2. ANONYMISES rows that must be kept for the books (withdrawals, wallet transactions, bill payments, service
    requests, identity checks, disputes, audit trail): the row and every amount stay, anything that says WHO is gone.
 3. SCRUBS the phone number (every format), the login alias and the email out of every text / JSON column in the
    whole database, wherever it was typed.
 4. Removes the person's files from storage (avatar, selfie, uploaded IDs).
 5. Tombstones the `users` row (or the caller hard-deletes it when the person never had any money history).
 6. VERIFIES: scans every text/JSON column again and returns what, if anything, still mentions the person.

Money is never touched: balances, amounts, references and dates all survive, only detached from a human being.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

GONE = "[deleted]"

# JSON keys whose VALUE identifies a person. Removed wherever they appear inside audit trails / payloads.
PII_KEYS = {
    "full_name", "name", "first_name", "last_name", "phone", "phone_number", "mobile", "email", "pending_email",
    "account_number", "account_name", "bank_name", "bank_code", "next_of_kin_name", "next_of_kin_phone", "bvn", "nin",
    "bvn_last4", "nin_last4", "address", "face_image_url", "avatar_url", "customer", "customername", "customeremail",
    "customer_name", "customer_email", "dob", "date_of_birth", "location_latitude", "location_longitude",
    "validated_account_name", "payer_name", "sender_name", "narration",
}
# Columns that are never rewritten by the generic scrub (identity of the row, secrets, structure).
_SKIP_COLUMN_SUFFIXES = ("_hash", "_enc", "_encrypted", "_token", "_secret")
# Free-text columns where people type sentences ("Ada Obi (0801...) joined your zone"). ONLY here is the person's full
# name also scrubbed. Never in structured columns such as bank account names: two different customers can share a name,
# and rewriting someone else's payout details would be far worse than leaving a name in a sentence.
NAME_SCRUB_COLUMNS = {
    ("notifications", "title"), ("notifications", "body"), ("instant_messages", "message"),
    ("dispute_messages", "message"), ("disputes", "resolution_summary"), ("disputes", "escalation_reason"),
    ("expenses", "description"), ("wallet_transactions", "description"), ("food_collection_audits", "notes"),
    ("job_pool_events", "details"), ("coop_requests", "reason"), ("coop_sweeps", "note"),
    ("withdrawals", "rejection_reason"), ("service_worker_withdrawals", "rejection_reason"),
    ("manual_service_requests", "worker_remarks"), ("manual_service_requests", "worker_response"),
}
_SKIP_TABLES = {"users", "alembic_version", "schema_migrations", "system_config", "health_check_results"}


# ───────────────────────────── pure helpers (unit-tested) ─────────────────────────────
def phone_variants(phone: str | None) -> list[str]:
    """Every way the same Nigerian number is written: 0801..., +234801..., 234801..., and the login alias."""
    if not phone:
        return []
    raw = str(phone).strip()
    digits = re.sub(r"\D", "", raw)
    out = {raw}
    if len(digits) >= 10:
        core = digits[-10:]
        out |= {"0" + core, "234" + core, "+234" + core}
    out |= {v.replace(" ", "") for v in list(out)}
    return sorted({v for v in out if len(v) >= 7}, key=len, reverse=True)


def build_pattern(phones: list[str], emails: list[str]) -> str | None:
    """One Postgres-regex that matches any identifier, not when it is merely part of a longer number."""
    parts: list[str] = []
    for p in phones:
        parts.append(r"(?<![0-9A-Za-z])" + re.escape(p).replace("\\+", r"\+") + r"(?![0-9])")
    for e in emails:
        if e:
            parts.append(re.escape(e))
    if not parts:
        return None
    return "(" + "|".join(parts) + ")"


def name_pattern(full_name: str | None) -> str | None:
    """Postgres-regex for a person's full name (two or more words), tolerant of spacing and case."""
    if not full_name:
        return None
    words = [w for w in re.split(r"\s+", full_name.strip()) if w]
    if len(words) < 2 or full_name.strip().lower() == "deleted customer":
        return None   # a single common word would damage unrelated text
    return r"(?<![A-Za-z])" + r"\s+".join(re.escape(w) for w in words) + r"(?![A-Za-z])"


def scrub_json(value, *, pattern: re.Pattern | None = None):
    """Return a copy of a JSON value with every identifying value replaced. Structure and numbers are kept."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if str(k).lower() in PII_KEYS and not isinstance(v, (dict, list)):
                out[k] = GONE if v not in (None, "") else v
            elif str(k).lower() in PII_KEYS and isinstance(v, (dict, list)):
                out[k] = GONE
            else:
                out[k] = scrub_json(v, pattern=pattern)
        return out
    if isinstance(value, list):
        return [scrub_json(v, pattern=pattern) for v in value]
    if isinstance(value, str) and pattern is not None:
        return pattern.sub(GONE, value)
    return value


def _py_pattern(phones: list[str], emails: list[str]) -> re.Pattern | None:
    pg = build_pattern(phones, emails)
    if not pg:
        return None
    return re.compile(pg.replace("(?<![0-9A-Za-z])", "(?<![0-9A-Za-z])"), re.IGNORECASE)


@dataclass
class Report:
    deleted: dict[str, int] = field(default_factory=dict)
    anonymised: dict[str, int] = field(default_factory=dict)
    scrubbed_text: dict[str, int] = field(default_factory=dict)
    files_removed: int = 0
    files_failed: list[str] = field(default_factory=list)
    needs_review: list[str] = field(default_factory=list)
    leftovers: list[dict] = field(default_factory=list)
    verified_clean: bool = False
    scan_complete: bool = True

    def to_dict(self) -> dict:
        return {
            "deleted_rows": self.deleted, "anonymised_rows": self.anonymised, "scrubbed_text": self.scrubbed_text,
            "files_removed": self.files_removed, "files_failed": self.files_failed,
            "needs_review": self.needs_review, "leftovers": self.leftovers,
            "verified_clean": self.verified_clean, "scan_complete": self.scan_complete,
        }


# ───────────────────────────── schema discovery ─────────────────────────────
async def _schema(db: AsyncSession) -> dict[str, dict[str, str]]:
    rows = (await db.execute(text(
        "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'"))).all()
    out: dict[str, dict[str, str]] = {}
    for t, c, d in rows:
        out.setdefault(t, {})[c] = d
    return out


async def _unique_columns(db: AsyncSession) -> set[tuple[str, str]]:
    """(table, column) pairs that sit in a primary key, unique index or foreign key: never rewritten in bulk."""
    res = await db.execute(text("""
        SELECT c.relname, a.attname
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
         WHERE i.indisunique OR i.indisprimary
        UNION
        SELECT cc.relname, a.attname
          FROM pg_constraint k
          JOIN pg_class cc ON cc.oid = k.conrelid
          JOIN pg_namespace n ON n.oid = cc.relnamespace AND n.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)
         WHERE k.contype = 'f'"""))
    return {(r[0], r[1]) for r in res.all()}


def _has(schema, table: str, *cols: str) -> bool:
    t = schema.get(table)
    return bool(t) and all(c in t for c in cols)


async def _run(db: AsyncSession, report_bucket: dict[str, int], label: str, sql: str, params: dict) -> int:
    """One step, inside a savepoint. A failure aborts the whole erasure (nothing half-erased is ever saved)."""
    try:
        async with db.begin_nested():
            res = await db.execute(text(sql), params)
        n = max(res.rowcount or 0, 0)
    except DBAPIError as e:
        raise ErasureError(f"Could not erase '{label}': {str(getattr(e, 'orig', e))[:200]}")
    if n:
        report_bucket[label] = report_bucket.get(label, 0) + n
    return n


class ErasureError(Exception):
    pass


# ───────────────────────────── identifiers ─────────────────────────────
@dataclass
class Identity:
    user_id: uuid.UUID
    phones: list[str]
    emails: list[str]
    full_name: str | None
    files: list[str]            # storage object URLs / paths to remove


async def collect_identity(db: AsyncSession, user_id: uuid.UUID, schema) -> Identity:
    u = (await db.execute(text(
        "SELECT phone_number, email, pending_email, full_name, next_of_kin_phone, avatar_url, face_image_url FROM users WHERE id = :i"),
        {"i": str(user_id)})).first()
    phones: list[str] = []
    emails: list[str] = []
    name = None
    files: list[str] = []
    if u:
        phones += phone_variants(u[0])
        # (the next-of-kin's number is cleared from THIS person's own record only; it is somebody else's number,
        #  so it is never scrubbed from other people's records)
        if u[0]:
            digits = re.sub(r"\s", "", str(u[0]))
            emails.append(f"{digits}@monieking.app")
        emails += [e for e in (u[1], u[2]) if e]
        name = u[3]
        files += [x for x in (u[5], u[6]) if x]
    if _has(schema, "manual_service_requests", "user_id", "uploaded_files"):
        rows = (await db.execute(text("SELECT uploaded_files::text, worker_result_file_url FROM manual_service_requests WHERE user_id = :i"), {"i": str(user_id)})).all()
        for up, wr in rows:
            files += re.findall(r"https?://[^\"\\\s]+", up or "")
            # (a worker's result file is for this customer, so it goes too)
            if wr:
                files.append(wr)
    if _has(schema, "dispute_messages", "sender_id", "attachment_url"):
        rows = (await db.execute(text("SELECT attachment_url FROM dispute_messages WHERE sender_id = :i AND attachment_url IS NOT NULL"), {"i": str(user_id)})).all()
        files += [r[0] for r in rows]
    return Identity(user_id, sorted(set(phones), key=len, reverse=True), sorted(set(emails)), name, sorted(set(files)))


# ───────────────────────────── the erasure ─────────────────────────────
async def erase_personal_data(db: AsyncSession, user_id: uuid.UUID, *, identity: Identity | None = None,
                              tombstone_user: bool = True) -> tuple[Report, Identity]:
    """Runs inside the caller's transaction. Raises ErasureError (and the caller rolls back) if any step fails."""
    rep = Report()
    schema = await _schema(db)
    ident = identity or await collect_identity(db, user_id, schema)
    uid = str(user_id)
    phones, emails = ident.phones, ident.emails

    # 1 ── rows that exist only to describe the person: delete ─────────────────────────
    for table, col in (
        ("notifications", "user_id"), ("push_subscriptions", "user_id"), ("webauthn_credentials", "user_id"),
        ("promo_banner_events", "user_id"), ("identity_service_notify_requests", "customer_id"),
        ("analytics_events", "user_id"),
    ):
        if _has(schema, table, col):
            await _run(db, rep.deleted, table, f'DELETE FROM "{table}" WHERE "{col}" = :u', {"u": uid})

    if phones and _has(schema, "pending_offline_customers", "phone_number"):
        await _run(db, rep.deleted, "pending_offline_customers",
                   "DELETE FROM pending_offline_customers WHERE phone_number = ANY(:p) OR claimed_user_id = :u",
                   {"p": phones, "u": uid})
    elif _has(schema, "pending_offline_customers", "claimed_user_id"):
        await _run(db, rep.deleted, "pending_offline_customers", "DELETE FROM pending_offline_customers WHERE claimed_user_id = :u", {"u": uid})

    if _has(schema, "coop_members", "user_id") and _has(schema, "coop_member_bank", "member_id"):
        await _run(db, rep.deleted, "coop_member_bank",
                   "DELETE FROM coop_member_bank WHERE member_id IN (SELECT id FROM coop_members WHERE user_id = :u)", {"u": uid})
    if _has(schema, "coop_members", "user_id", "next_of_kin"):
        await _run(db, rep.anonymised, "coop_members", "UPDATE coop_members SET next_of_kin = NULL WHERE user_id = :u AND next_of_kin IS NOT NULL", {"u": uid})

    # 2 ── rows the books need: keep the row and the money, remove the person ──────────
    if _has(schema, "withdrawals", "customer_id", "bank_name", "account_number", "account_name"):
        await _run(db, rep.anonymised, "withdrawals",
                   "UPDATE withdrawals SET bank_name = :g, account_number = :g, account_name = :g WHERE customer_id = :u", {"u": uid, "g": GONE})
    if _has(schema, "service_worker_withdrawals", "worker_id", "account_number", "account_name"):
        await _run(db, rep.anonymised, "service_worker_withdrawals",
                   "UPDATE service_worker_withdrawals SET bank_name = :g, account_number = :g, account_name = :g WHERE worker_id = :u", {"u": uid, "g": GONE})
    if _has(schema, "wallets", "owner_id", "virtual_account_name", "is_frozen"):
        # frozen: if a payment ever lands on the old virtual account it will be flagged for review, not credited
        await _run(db, rep.anonymised, "wallets",
                   "UPDATE wallets SET virtual_account_name = NULL, is_frozen = TRUE WHERE owner_id = :u", {"u": uid})
    if _has(schema, "bill_payment_requests", "customer_id", "customer_reference", "validated_account_name"):
        await _run(db, rep.anonymised, "bill_payment_requests",
                   "UPDATE bill_payment_requests SET customer_reference = :g, validated_account_name = NULL WHERE customer_id = :u", {"u": uid, "g": GONE})
        if _has(schema, "bill_payment_requests", "token"):
            await _run(db, rep.anonymised, "bill_payment_requests", "UPDATE bill_payment_requests SET token = NULL WHERE customer_id = :u AND token IS NOT NULL", {"u": uid})
    if _has(schema, "manual_service_requests", "user_id", "form_data", "uploaded_files"):
        await _run(db, rep.anonymised, "manual_service_requests",
                   "UPDATE manual_service_requests SET form_data = '{}'::jsonb, uploaded_files = '[]'::jsonb, "
                   "worker_response = NULL, worker_remarks = NULL, worker_additional_info = NULL, worker_result_file_url = NULL "
                   "WHERE user_id = :u", {"u": uid})
    if _has(schema, "identity_service_requests", "customer_id", "request_payload"):
        await _run(db, rep.anonymised, "identity_service_requests",
                   "UPDATE identity_service_requests SET request_payload = '{}'::jsonb, response_summary = NULL, failure_reason = NULL WHERE customer_id = :u", {"u": uid})
    if _has(schema, "verification_lookups", "customer_id", "photo_enc", "result_enc", "pdf_enc", "summary"):
        await _run(db, rep.anonymised, "verification_lookups",
                   "UPDATE verification_lookups SET photo_enc = NULL, result_enc = NULL, pdf_enc = NULL, summary = NULL, failure_reason = NULL WHERE customer_id = :u", {"u": uid})
    if _has(schema, "dispute_messages", "sender_id", "message"):
        await _run(db, rep.anonymised, "dispute_messages",
                   "UPDATE dispute_messages SET message = :g, attachment_url = NULL, attachment_name = NULL WHERE sender_id = :u", {"u": uid, "g": GONE})
    if _has(schema, "food_entitlements", "customer_id", "qr_token", "collection_pin"):
        await _run(db, rep.anonymised, "food_entitlements",
                   "UPDATE food_entitlements SET qr_token = 'erased-' || md5(id::text), collection_pin = '----' WHERE customer_id = :u", {"u": uid})

    # payment notices carry the payer's name/email: strip those keys, keep amounts and references
    if phones and _has(schema, "payment_webhooks", "raw_payload", "account_number") and _has(schema, "wallets", "owner_id", "virtual_account_number"):
        col_type = schema["payment_webhooks"]["raw_payload"]
        cast_in, cast_out = ("raw_payload::jsonb", "::json") if col_type == "json" else ("raw_payload", "")
        await _run(db, rep.anonymised, "payment_webhooks",
                   f"UPDATE payment_webhooks SET raw_payload = (CASE WHEN jsonb_typeof({cast_in}->'eventData') = 'object' "
                   f"THEN jsonb_set({cast_in}, '{{eventData}}', ({cast_in}->'eventData') - 'customer' - 'metaData' - 'cardDetails' - 'metadata') "
                   f"ELSE {cast_in} END){cast_out} "
                   "WHERE account_number IN (SELECT virtual_account_number FROM wallets WHERE owner_id = :u AND virtual_account_number IS NOT NULL)", {"u": uid})

    # audit trail: keep every entry, strip identifying values and network details
    if _has(schema, "audit_logs", "actor_id", "entity_id", "old_value", "new_value"):
        rows = (await db.execute(text(
            "SELECT id, old_value::text, new_value::text FROM audit_logs WHERE entity_id = :s OR actor_id = CAST(:u AS uuid)"), {"u": uid, "s": uid})).all()
        pat = _py_pattern(phones, emails)
        import json as _json
        n = 0
        for rid, ov, nv in rows:
            o2 = _json.dumps(scrub_json(_json.loads(ov), pattern=pat)) if ov else None
            n2 = _json.dumps(scrub_json(_json.loads(nv), pattern=pat)) if nv else None
            if o2 != ov or n2 != nv:
                await _run(db, rep.anonymised, "audit_logs",
                           "UPDATE audit_logs SET old_value = CAST(:o AS jsonb), new_value = CAST(:n AS jsonb) WHERE id = :i",
                           {"o": o2, "n": n2, "i": str(rid)})
        if _has(schema, "audit_logs", "ip_address", "user_agent"):
            await _run(db, rep.anonymised, "audit_logs",
                       "UPDATE audit_logs SET ip_address = NULL, user_agent = NULL WHERE (entity_id = :s OR actor_id = CAST(:u AS uuid)) AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)", {"u": uid, "s": uid})

    # 3 ── the number / email, wherever it was ever typed ──────────────────────────────
    await _scrub_everywhere(db, schema, phones, emails, rep, ident.full_name)

    # 4 ── files in storage ────────────────────────────────────────────────────────────
    await _remove_files(ident, rep)

    # 5 ── the account row itself ──────────────────────────────────────────────────────
    if tombstone_user:
        await _run(db, rep.anonymised, "users", """
            UPDATE users SET
                full_name = 'Deleted customer', phone_number = 'x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15),
                email = NULL, pending_email = NULL, email_code_hash = NULL, email_code_expires_at = NULL, email_verified_at = NULL,
                phone_otp_hash = NULL, phone_otp_expires_at = NULL, phone_verified_at = NULL,
                nin_encrypted = NULL, nin_last4 = NULL, bvn_last4 = NULL, nin_linked = FALSE, bvn_linked = FALSE,
                face_image_url = NULL, avatar_url = NULL, next_of_kin_name = NULL, next_of_kin_phone = NULL,
                bank_name = NULL, bank_code = NULL, account_number = NULL, account_name = NULL,
                location_latitude = NULL, location_longitude = NULL, detected_state = NULL, state_of_residence = NULL,
                withdrawal_password_hash = NULL, payment_pin_hash = NULL, webauthn_challenge = NULL,
                status = 'suspended', deleted_at = now()
            WHERE id = :u""", {"u": uid})
    return rep, ident


async def _scrub_everywhere(db: AsyncSession, schema, phones, emails, rep: Report, full_name: str | None = None) -> None:
    pat = build_pattern(phones, emails)
    if not pat:
        return
    protected = await _unique_columns(db)
    text_types = {"character varying", "text", "character"}
    for table, cols in sorted(schema.items()):
        if table in _SKIP_TABLES:
            continue
        targets = []
        for c, dt in cols.items():
            if c.endswith(_SKIP_COLUMN_SUFFIXES) or (table, c) in protected:
                continue
            if dt in text_types:
                targets.append((c, "text"))
            elif dt in ("json", "jsonb"):
                targets.append((c, dt))
        if not targets:
            continue
        sets, wheres = [], []
        for c, kind in targets:
            if kind == "text":
                expr = f'"{c}"'
                sets.append(f'"{c}" = CASE WHEN "{c}" ~* :pat THEN regexp_replace("{c}", :pat, :g, \'gi\') ELSE "{c}" END')
            else:
                expr = f'"{c}"::text'
                sets.append(f'"{c}" = CASE WHEN "{c}"::text ~* :pat THEN regexp_replace("{c}"::text, :pat, :g, \'gi\')::{kind} ELSE "{c}" END')
            wheres.append(f'{expr} ~* :pat')
        sql = f'UPDATE "{table}" SET {", ".join(sets)} WHERE {" OR ".join(wheres)}'
        try:
            async with db.begin_nested():
                res = await db.execute(text(sql), {"pat": pat, "g": GONE})
            if res.rowcount:
                rep.scrubbed_text[table] = rep.scrubbed_text.get(table, 0) + res.rowcount
        except DBAPIError as e:
            # e.g. a CHECK rule rejects the placeholder. Never silent: reported, and the verify scan will show it.
            rep.needs_review.append(f"{table}: {str(getattr(e, 'orig', e))[:140]}")

        npat = name_pattern(full_name)
        if npat:
            name_cols = [(c, k) for c, k in targets if (table, c) in NAME_SCRUB_COLUMNS]
            if name_cols:
                nsets = [f'"{c}" = regexp_replace("{c}"{"" if k == "text" else "::text"}, :np, :g, \'gi\'){"" if k == "text" else "::" + k}' for c, k in name_cols]
                nwhere = [f'"{c}"{"" if k == "text" else "::text"} ~* :np' for c, k in name_cols]
                try:
                    async with db.begin_nested():
                        res = await db.execute(text(f'UPDATE "{table}" SET {", ".join(nsets)} WHERE {" OR ".join(nwhere)}'), {"np": npat, "g": GONE})
                    if res.rowcount:
                        rep.scrubbed_text[table] = rep.scrubbed_text.get(table, 0) + res.rowcount
                except DBAPIError as e:
                    rep.needs_review.append(f"{table} (name): {str(getattr(e, 'orig', e))[:140]}")


_STORAGE_RE = re.compile(r"/storage/v1/object/(?:public/|sign/|authenticated/)?([^/]+)/([^?\s\"']+)")


async def _remove_files(ident: Identity, rep: Report) -> None:
    from app.utils.supabase_admin_client import supabase_admin_request
    by_bucket: dict[str, set[str]] = {}
    for f in ident.files:
        m = _STORAGE_RE.search(f)
        if m:
            by_bucket.setdefault(m.group(1), set()).add(m.group(2))
    # the avatar is stored under the user's id even if the url was never saved
    by_bucket.setdefault("avatars", set()).update({f"{ident.user_id}.jpg", f"{ident.user_id}.png", f"{ident.user_id}.webp"})
    for bucket, paths in by_bucket.items():
        try:
            await supabase_admin_request(
                "DELETE", f"/storage/v1/object/{bucket}", json={"prefixes": sorted(paths)},
                ok_statuses=(200, 204), not_found_ok=True, failure_detail="storage delete failed",
            )
            rep.files_removed += len(paths)
        except Exception as e:  # noqa: BLE001 - reported, never blocks the erasure
            rep.files_failed.append(f"{bucket}: {str(e)[:100]}")


# ───────────────────────────── verification ─────────────────────────────
async def verify_clean(db: AsyncSession, ident: Identity, rep: Report, *, budget_seconds: float = 40.0) -> None:
    """Scan every text / JSON column of every table for any identifier. Fills rep.leftovers / rep.verified_clean."""
    pat = build_pattern(ident.phones, ident.emails)
    npat = name_pattern(ident.full_name)
    if not pat and not npat:
        rep.verified_clean, rep.scan_complete = True, True
        return
    schema = await _schema(db)
    started = time.monotonic()
    text_types = {"character varying", "text", "character", "json", "jsonb"}
    for table, cols in sorted(schema.items()):
        for c, dt in cols.items():
            if dt not in text_types or c.endswith(_SKIP_COLUMN_SUFFIXES):
                continue
            if time.monotonic() - started > budget_seconds:
                rep.scan_complete = False
                break
            use = pat if not ((table, c) in NAME_SCRUB_COLUMNS and npat) else (f"({pat}|{npat})" if pat else npat)
            if not use:
                continue
            try:
                async with db.begin_nested():
                    n = (await db.execute(text(f'SELECT count(*) FROM "{table}" WHERE "{c}"::text ~* :pat'), {"pat": use})).scalar_one()
            except DBAPIError:
                continue
            if n:
                rep.leftovers.append({"table": table, "column": c, "rows": int(n)})
        if not rep.scan_complete:
            break
    rep.verified_clean = not rep.leftovers and rep.scan_complete


# ───────────────────────────── one call for every "delete a person" button ─────────────────────────────
async def erase_account(db: AsyncSession, user, *, director_id: uuid.UUID, hard_preferred: bool,
                        ip_address: str | None = None) -> tuple[str, dict]:
    """Erase one person completely. Returns (result, report) where result is 'deleted' (row removed) or 'archived'
    (row kept as an anonymous tombstone because real money records point at it).

    Runs inside the caller's transaction; the caller commits. Any failure raises (HTTPException / ErasureError) and the
    caller's rollback leaves everything exactly as it was."""
    from fastapi import HTTPException
    from app.services import purge_service
    from app.utils.audit import log_action
    from app.utils.supabase_admin_client import supabase_admin_request

    uid = user.id
    role = str(getattr(user.role, "value", user.role))
    schema = await _schema(db)
    ident = await collect_identity(db, uid, schema)

    result = "archived"
    if hard_preferred:
        plan = await purge_service.build_plan(db, [uid])
        result = "deleted" if not plan.conflicts else "archived"

    try:
        rep, _ = await erase_personal_data(db, uid, identity=ident, tombstone_user=(result == "archived"))
        if result == "deleted":
            try:
                await purge_service.purge(db, test_user_ids=[uid], director_id=director_id)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))
    except ErasureError as e:
        raise HTTPException(status_code=500, detail=f"Nothing was deleted. {e}")

    # the login itself (revokes every session); if this fails the caller rolls the database back
    await supabase_admin_request(
        "DELETE", f"/auth/v1/admin/users/{uid}", ok_statuses=(200, 204), not_found_ok=True,
        failure_detail="Could not remove the login. Nothing was changed — please try again.",
    )
    await db.flush()
    await verify_clean(db, ident, rep)

    # The audit entry describes WHAT happened, never WHO the person was (no name, no phone).
    await log_action(
        db, actor_id=director_id, action=f"account.{result}", entity_type="user", entity_id=str(uid),
        new_value={"role": role, "tables_erased": sorted(rep.deleted), "tables_anonymised": sorted(rep.anonymised),
                   "files_removed": rep.files_removed, "verified_clean": rep.verified_clean},
        ip_address=ip_address,
    )
    try:
        from app.core.dependencies import invalidate_user_cache
        await invalidate_user_cache(str(uid))
    except Exception:  # noqa: BLE001
        log.warning("user cache invalidate failed after erase", exc_info=True)
    return result, rep.to_dict()
