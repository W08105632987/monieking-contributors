"""Test-account purge: remove marked test users, their data AND their logins.

The engine follows the database's own foreign keys (introspected live, so it
also covers tables created by raw SQL migrations) instead of a hand-written
list that would rot:

  owned rows   = rows that belong to a test user (owner columns) or hang off
                 another owned row (cards -> records, wallets -> transactions...)
  actor links  = real data that merely POINTS at a test user (a test officer
                 who recorded a real customer's payment). Nullable ones become
                 NULL; required ones are re-attributed to the director running
                 the purge. Real history is never deleted.
  conflicts    = an owned row that also depends on real data we are not
                 deleting. These block the purge and are listed in the preview.

Nothing is written until purge() — preview() is read-only.
"""
import uuid
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

# Columns that mean "this row belongs to that user".
OWNER_COLS = {"customer_id", "owner_id", "user_id", "worker_id", "raised_by", "sender_id", "author_id", "director_id"}
# Columns that mean "that user merely did something to this row".
ACTOR_COLS = {
    "initiated_by_id", "officer_id", "assigned_by_director_id", "initiated_by", "contributed_by", "collected_by",
    "claimed_by_director_id", "created_by", "updated_by", "sent_by", "closed_by", "reviewed_by", "decided_by",
    "resolved_by", "prepared_by", "reconciled_by", "recorded_by", "proposed_by", "cancelled_by", "submitted_by",
    "referred_worker_id", "claimed_by_id", "assigned_to", "assigned_worker_id", "added_by", "managing_officer_id",
    "actor_id", "approved_by",
}
# (table, column) pairs that are actor-named but where a test user's rows are test content to delete.
OWNER_OVERRIDES = {
    ("audit_logs", "actor_id"), ("broadcasts", "sent_by"), ("instant_messages", "created_by"),
    ("promo_banners", "created_by"), ("pending_rate_changes", "created_by"), ("job_pool_events", "actor_id"),
}
# Shared set-up data: never owned, never a conflict.
REFERENCE_TABLES = {
    "zones", "billers", "identity_services", "service_templates", "service_template_versions", "food_package_items",
    "food_collection_points", "food_collection_year_archives", "food_collection_year_archive_costs", "system_config",
    "coop_contract_versions", "coop_settings", "coop_setting_changes", "provider_service_config", "offline_import_batches",
    "verification_service_state", "coop_job_runs", "health_alert_state",
}

# Rows that only exist because of something else (a viewer of a banner, a reply inside a dispute). When the parent
# is test content they are simply deleted with it, so a real person appearing in them never blocks a purge.
SOFT_REF_TABLES = {"promo_banner_events", "dispute_messages"}

CONFIRM_PHRASE = "DELETE TEST ACCOUNTS"


@dataclass
class Fk:
    child: str
    col: str
    parent: str
    pcol: str
    notnull: bool
    ondelete: str   # 'c' cascade, 'n' set null, 'a' no action, 'r' restrict


@dataclass
class Plan:
    test_user_ids: list[uuid.UUID]
    owned: dict[str, dict[str, dict]] = field(default_factory=dict)   # table -> ctid -> {col: value}
    counts: dict[str, int] = field(default_factory=dict)
    conflicts: list[dict] = field(default_factory=list)
    value_users: list[dict] = field(default_factory=list)
    reattribute: list[Fk] = field(default_factory=list)
    nullify: list[Fk] = field(default_factory=list)


async def _fks(db: AsyncSession) -> list[Fk]:
    rows = (await db.execute(text("""
        SELECT cc.relname, a.attname, pc.relname, pa.attname, a.attnotnull, c.confdeltype
          FROM pg_constraint c
          JOIN pg_class cc ON cc.oid = c.conrelid
          JOIN pg_class pc ON pc.oid = c.confrelid
          JOIN pg_namespace n ON n.oid = cc.relnamespace
          JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
          JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
         WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND n.nspname = 'public'
    """))).all()
    return [Fk(r[0], r[1], r[2], r[3], bool(r[4]), r[5].decode() if isinstance(r[5], (bytes, bytearray)) else str(r[5])) for r in rows]


def _is_owner(fk: Fk) -> bool:
    if (fk.child, fk.col) in OWNER_OVERRIDES:
        return True
    if fk.col in ACTOR_COLS:
        # A required column whose own foreign key says "delete me with the user" (e.g. a test officer's zone
        # assignment history) belongs to that user. Re-attributing it to the director would pile rows onto the
        # director and break unique rules, so it is removed with the account instead.
        return bool(fk.parent == "users" and fk.notnull and fk.ondelete == "c")
    return fk.col in OWNER_COLS or fk.ondelete == "c"


async def _select_rows(db: AsyncSession, table: str, where: str, params: dict, cols: set[str]) -> dict[str, dict]:
    sel = ", ".join(['ctid::text AS _ct'] + [f'"{c}"' for c in sorted(cols)])
    res = await db.execute(text(f'SELECT {sel} FROM "{table}" WHERE {where}'), params)
    return {r["_ct"]: {c: r[c] for c in cols} for r in res.mappings().all()}


async def build_plan(db: AsyncSession, test_user_ids: list[uuid.UUID]) -> Plan:
    plan = Plan(test_user_ids=list(test_user_ids))
    if not test_user_ids:
        return plan
    fks = await _fks(db)
    referenced: dict[str, set[str]] = defaultdict(set)
    for f in fks:
        referenced[f.parent].add(f.pcol)
    referenced["users"].add("id")

    ids = [str(u) for u in test_user_ids]
    owned: dict[str, dict[str, dict]] = {}
    owned["users"] = await _select_rows(db, "users", "id = ANY(CAST(:ids AS uuid[]))", {"ids": ids}, referenced["users"])

    def vals(table: str, col: str) -> list[str]:
        return [str(r[col]) for r in owned.get(table, {}).values() if r.get(col) is not None]

    changed = True
    while changed:
        changed = False
        for f in fks:
            if f.child in REFERENCE_TABLES or f.child == "users":
                continue
            cols = referenced[f.child] | {f.col}
            if f.parent == "users":
                if not _is_owner(f):
                    continue
                found = await _select_rows(db, f.child, f'"{f.col}" = ANY(CAST(:v AS uuid[]))', {"v": ids}, cols)
            else:
                pv = vals(f.parent, f.pcol)
                if not pv:
                    continue
                found = await _select_rows(db, f.child, f'CAST("{f.col}" AS text) = ANY(:v)', {"v": pv}, cols)
            cur = owned.setdefault(f.child, {})
            new = {k: v for k, v in found.items() if k not in cur}
            if new:
                cur.update(new)
                changed = True
    plan.owned = {t: r for t, r in owned.items() if r}
    plan.counts = {t: len(r) for t, r in plan.owned.items()}

    # ── conflicts: owned rows that depend on real data we are not deleting ──
    for f in fks:
        rows = plan.owned.get(f.child)
        if not rows or f.child in REFERENCE_TABLES:
            continue
        if f.parent == "users":
            if f.child in SOFT_REF_TABLES:
                continue
            if _is_owner(f):
                bad = await db.execute(text(
                    f'SELECT count(*) FROM "{f.child}" WHERE ctid::text = ANY(:cts) AND "{f.col}" IS NOT NULL AND NOT ("{f.col}" = ANY(CAST(:ids AS uuid[])))'),
                    {"cts": list(rows), "ids": ids})
                n = bad.scalar_one()
                if n:
                    plan.conflicts.append({"table": f.child, "column": f.col, "rows": n, "reason": "belongs to a real user as well"})
            continue
        if f.parent in REFERENCE_TABLES:
            continue
        pv = vals(f.parent, f.pcol)
        bad = await db.execute(text(
            f'SELECT count(*) FROM "{f.child}" WHERE ctid::text = ANY(:cts) AND "{f.col}" IS NOT NULL AND NOT (CAST("{f.col}" AS text) = ANY(:pv))'),
            {"cts": list(rows), "pv": pv or [""]})
        n = bad.scalar_one()
        if n:
            plan.conflicts.append({"table": f.child, "column": f.col, "rows": n, "reason": f"depends on real {f.parent} data"})

    # ── real rows pointing INTO what will be deleted ──
    for f in fks:
        if f.child in REFERENCE_TABLES and f.child != "system_config" and f.parent != "users":
            pass
        owned_child = set(plan.owned.get(f.child, {}))
        if f.parent == "users":
            if _is_owner(f):
                continue
            pointing = await db.execute(text(
                f'SELECT ctid::text FROM "{f.child}" WHERE "{f.col}" = ANY(CAST(:ids AS uuid[]))'), {"ids": ids})
            outside = [r[0] for r in pointing.all() if r[0] not in owned_child]
            if outside:
                (plan.nullify if not f.notnull else plan.reattribute).append(f)
            continue
        if f.parent not in plan.owned:
            continue
        pv = vals(f.parent, f.pcol)
        pointing = await db.execute(text(
            f'SELECT ctid::text FROM "{f.child}" WHERE CAST("{f.col}" AS text) = ANY(:pv)'), {"pv": pv or [""]})
        outside = [r[0] for r in pointing.all() if r[0] not in owned_child]
        if outside:
            if f.notnull:
                plan.conflicts.append({"table": f.child, "column": f.col, "rows": len(outside), "reason": f"real rows depend on a test {f.parent} row"})
            else:
                plan.nullify.append(f)

    # ── money guard ──
    plan.value_users = await _value_users(db, ids)
    return plan


async def _value_users(db: AsyncSession, ids: list[str]) -> list[dict]:
    res = await db.execute(text("""
        SELECT u.id::text AS id, u.full_name, u.phone_number, u.role::text AS role,
               COALESCE((SELECT SUM(w.balance_kobo) FROM wallets w WHERE w.owner_id = u.id), 0) AS wallet_kobo,
               COALESCE((SELECT SUM(c.total_contributed_kobo) FROM contribution_cards c WHERE c.owner_id = u.id), 0) AS cards_kobo,
               COALESCE((SELECT COUNT(*) FROM withdrawals x WHERE x.customer_id = u.id AND x.status IN ('pending','claimed')), 0) AS open_withdrawals
          FROM users u WHERE u.id = ANY(CAST(:ids AS uuid[]))
    """), {"ids": ids})
    out = []
    for r in res.mappings().all():
        if r["wallet_kobo"] > 0 or r["cards_kobo"] > 0 or r["open_withdrawals"] > 0:
            out.append({"id": r["id"], "full_name": r["full_name"], "phone_number": r["phone_number"], "role": r["role"],
                        "wallet_kobo": int(r["wallet_kobo"]), "cards_kobo": int(r["cards_kobo"]), "open_withdrawals": int(r["open_withdrawals"])})
    return out


def summarize(plan: Plan) -> dict:
    return {
        "users": plan.counts.get("users", 0),
        "tables": dict(sorted(plan.counts.items(), key=lambda kv: -kv[1])),
        "total_rows": sum(plan.counts.values()),
        "conflicts": plan.conflicts,
        "value_users": plan.value_users,
        "will_nullify": [f"{f.child}.{f.col}" for f in plan.nullify],
        "will_reassign_to_you": [f"{f.child}.{f.col}" for f in plan.reattribute],
        "can_purge": not plan.conflicts,
    }


async def _guard_triggers(db: AsyncSession, tables: set[str]) -> list[tuple[str, str]]:
    """Tables like the cooperative money book are protected by 'immutable' triggers that refuse DELETE/UPDATE.
    A purge of TEST data must be allowed to pass them, so they are switched off inside this one transaction and
    switched back on before it ends (if anything fails, the whole transaction rolls back, triggers included)."""
    if not tables:
        return []
    res = await db.execute(text("""
        SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND c.relname = ANY(:t) AND t.tgname ILIKE '%immutable%'"""), {"t": sorted(tables)})
    found = [(r[0], r[1]) for r in res.all()]
    for table, trig in found:
        await db.execute(text(f'ALTER TABLE "{table}" DISABLE TRIGGER "{trig}"'))
    return found


async def purge(db: AsyncSession, *, test_user_ids: list[uuid.UUID], director_id: uuid.UUID) -> dict:
    """Runs inside the caller's transaction; the caller deletes the Supabase logins and then commits.
    Raises ValueError with a plain-language reason when something cannot be removed (nothing is saved then)."""
    plan = await build_plan(db, test_user_ids)
    touched = set(plan.owned) | {f.child for f in plan.nullify} | {f.child for f in plan.reattribute}
    guarded = await _guard_triggers(db, touched)
    try:
        out = await _purge(db, plan, test_user_ids, director_id)
    except DBAPIError as e:
        raise ValueError(f"The database refused part of the delete: {str(getattr(e, 'orig', e))[:240]}")
    for table, trig in guarded:
        await db.execute(text(f'ALTER TABLE "{table}" ENABLE TRIGGER "{trig}"'))
    return out


async def _purge(db: AsyncSession, plan: "Plan", test_user_ids: list[uuid.UUID], director_id: uuid.UUID) -> dict:
    if plan.conflicts:
        raise ValueError("Conflicts must be resolved before purging")
    ids = [str(u) for u in test_user_ids]
    owned_cts = {t: list(r) for t, r in plan.owned.items()}

    # 1. real rows that point at what is going away
    for f in plan.nullify:
        if f.parent == "users":
            await db.execute(text(f'UPDATE "{f.child}" SET "{f.col}" = NULL WHERE "{f.col}" = ANY(CAST(:ids AS uuid[])) AND NOT (ctid::text = ANY(:own))'),
                             {"ids": ids, "own": owned_cts.get(f.child, [])})
        else:
            pv = [str(r[f.pcol]) for r in plan.owned[f.parent].values() if r.get(f.pcol) is not None]
            await db.execute(text(f'UPDATE "{f.child}" SET "{f.col}" = NULL WHERE CAST("{f.col}" AS text) = ANY(:pv) AND NOT (ctid::text = ANY(:own))'),
                             {"pv": pv, "own": owned_cts.get(f.child, [])})
    for f in plan.reattribute:
        await db.execute(text(f'UPDATE "{f.child}" SET "{f.col}" = :d WHERE "{f.col}" = ANY(CAST(:ids AS uuid[])) AND NOT (ctid::text = ANY(:own))'),
                         {"d": str(director_id), "ids": ids, "own": owned_cts.get(f.child, [])})

    # 2. delete owned rows, children first (retry passes so we never need a hand-made order)
    remaining = {t: set(c) for t, c in owned_cts.items()}
    last_err: dict[str, str] = {}
    for _ in range(len(remaining) + 5):
        progressed = False
        for table in list(remaining):
            if not remaining[table]:
                del remaining[table]
                continue
            try:
                async with db.begin_nested():
                    await db.execute(text(f'DELETE FROM "{table}" WHERE ctid::text = ANY(:cts)'), {"cts": list(remaining[table])})
                del remaining[table]
                progressed = True
            except DBAPIError as e:
                last_err[table] = str(getattr(e, "orig", e))[:200]
                continue
        if not remaining:
            break
        if not progressed:
            first = sorted(remaining)[0]
            raise ValueError(f"Could not delete from {first.replace('_', ' ')}: {last_err.get(first, 'unknown reason')}")
    return {"deleted": plan.counts, "users": plan.counts.get("users", 0)}
