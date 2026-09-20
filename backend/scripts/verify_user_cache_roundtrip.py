"""
Verifies the get_current_user Redis cache round-trip is lossless.

This exists because of two real bugs found in this exact mechanism:
1. Enum columns (role, status) came back as plain strings instead of
   real enum instances after a cache read.
2. UUID columns (id, zone_id, created_by, managing_officer_id) came back
   as plain strings — silently breaking every `card.owner_id !=
   current_user.id`-style check on a cache HIT, since uuid.UUID("x") !=
   "x" is always True in Python, even when the value is identical.
3. Datetime columns (created_at, login_locked_until, etc.) came back as
   ISO strings — two of them are compared with `<`/`>` in lockout-check
   code, so this one would have crashed those requests outright.

Fixed by hand (see _ENUM_COLUMNS / _UUID_COLUMNS / _DATETIME_COLUMNS in
dependencies.py) rather than by any general mechanism, which means a
FOURTH field type added to User later (a Decimal, a list, whatever) could
silently reintroduce the same class of bug. This script catches that: it
fetches a handful of real users straight from the DB, round-trips each
one through the exact same serialize/deserialize functions
dependencies.py uses, and checks that every column BEHAVES the same —
same equality result — as the original. Note this deliberately does NOT
require exact Python class identity: asyncpg appears to hand back its
own native UUID class for values read straight from the DB, which isn't
literally the same class as the stdlib uuid.UUID this script
reconstructs, but the two compare equal correctly — that's flagged as an
informational note, not a failure, since what matters is behavior, not
implementation detail.

Run with:  python -m scripts.verify_user_cache_roundtrip
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.dependencies import _serialize_user, _deserialize_user
from app.models.user import User


async def main() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).limit(10))
        users = list(result.scalars().all())

    if not users:
        print("No users in the database to test against — create at least one and re-run.")
        sys.exit(1)

    print(f"Testing {len(users)} user(s)...\n")

    failures: list[str] = []
    warnings: list[str] = []

    for original in users:
        label = f"user {original.id} ({original.role})"

        serialized = _serialize_user(original)
        rebuilt = _deserialize_user(serialized)

        for column in User.__table__.columns:
            name = column.name
            original_value = getattr(original, name)
            rebuilt_value = getattr(rebuilt, name)

            # Hash/challenge fields are DELIBERATELY excluded from the
            # cache (see _CACHE_EXCLUDE) — the whole point is they come
            # back empty, so skip them here rather than flag a false
            # failure.
            if original_value is not None and rebuilt_value is None and name in (
                "login_password_hash", "withdrawal_password_hash",
                "webauthn_challenge", "webauthn_challenge_expires_at",
            ):
                continue

            # The real check: same VALUE and — critically — the same
            # equality BEHAVIOR, since that's what actually matters to the
            # app (this is literally what broke in cards.py: a comparison
            # silently returning the wrong answer). Strict type() identity
            # is a red herring for at least one real column type: asyncpg
            # appears to hand SQLAlchemy its own native UUID class rather
            # than stdlib uuid.UUID for "original" values read directly
            # from the DB, which prints identically (UUID('...')) but
            # fails a strict type() check even though the two classes
            # compare equal by value. Flagging that as a hard FAILURE
            # would be a false alarm — flag it as a WARNING instead, and
            # only fail on values that don't actually compare equal.
            if original_value != rebuilt_value:
                failures.append(
                    f"[{label}] column '{name}': VALUE mismatch (real bug) — "
                    f"original={original_value!r}, rebuilt={rebuilt_value!r}"
                )
            elif type(original_value) is not type(rebuilt_value):
                warnings.append(
                    f"[{label}] column '{name}': different classes but equal value — "
                    f"original={type(original_value).__module__}.{type(original_value).__name__}, "
                    f"rebuilt={type(rebuilt_value).__module__}.{type(rebuilt_value).__name__} "
                    f"(harmless unless something downstream checks isinstance/type explicitly)"
                )

    print("=" * 70)
    if warnings:
        print(f"{len(warnings)} informational note(s) (not failures):\n")
        for w in warnings:
            print(f"  ⚠ {w}")
        print()
    if failures:
        print(f"FAILED — {len(failures)} mismatch(es) found:\n")
        for f in failures:
            print(f"  ✗ {f}")
        print(
            "\nA cache round-trip bug is present. Check whether the "
            "failing column's type needs adding to _ENUM_COLUMNS, "
            "_UUID_COLUMNS, or _DATETIME_COLUMNS in dependencies.py (or a "
            "new equivalent set, if it's a different type entirely)."
        )
        sys.exit(1)
    else:
        print(f"PASSED — all {len(users)} user(s), every column's cached value behaves identically to the original.")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
