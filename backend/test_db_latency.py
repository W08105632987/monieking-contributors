"""
Isolates network round-trip latency to your Supabase Postgres instance from
actual query execution time — tells us whether "everything is slow" is a
distance/network problem or a query problem.

Run from inside backend/:
    python test_db_latency.py
"""
import asyncio
import time
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings


async def main():
    print(f"Connecting to: {settings.DATABASE_URL.split('@')[1] if '@' in settings.DATABASE_URL else '(hidden)'}\n")

    engine = create_async_engine(
        settings.DATABASE_URL, echo=False,
        connect_args={"statement_cache_size": 0},
    )

    print("── Test 1: raw round-trip latency (SELECT 1, x10) ──")
    print("This isolates pure network distance — no real query work at all.\n")
    times = []
    async with engine.connect() as conn:
        for i in range(10):
            start = time.perf_counter()
            await conn.execute(text("SELECT 1"))
            elapsed = (time.perf_counter() - start) * 1000
            times.append(elapsed)
            print(f"  Round {i+1}: {elapsed:.1f}ms")

    avg = sum(times) / len(times)
    print(f"\n  Average: {avg:.1f}ms   Min: {min(times):.1f}ms   Max: {max(times):.1f}ms")
    if avg > 100:
        print("  ⚠️  High baseline latency — this is likely a geographic distance issue,")
        print("      not something fixable by optimizing queries.")
    else:
        print("  ✅ Latency looks normal for this connection.")

    print("\n── Test 2: a realistic query under load ──")
    print("Fetching up to 100 users, same as your officer pages currently do.\n")
    start = time.perf_counter()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT * FROM users LIMIT 100"))
        rows = result.fetchall()
    elapsed = (time.perf_counter() - start) * 1000
    print(f"  Fetched {len(rows)} rows in {elapsed:.1f}ms")
    print(f"  (Compare to Test 1's average of {avg:.1f}ms — the difference is real query+transfer cost)")

    print("\n── Test 3: does the officer customer-list query use an index? ──")
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "EXPLAIN ANALYZE SELECT * FROM users WHERE managing_officer_id = "
            "(SELECT id FROM users WHERE role = 'officer' LIMIT 1) LIMIT 20"
        ))
        plan = result.fetchall()
    for row in plan:
        print(f"  {row[0]}")
    plan_text = " ".join(str(row[0]) for row in plan)
    if "Seq Scan" in plan_text:
        print("\n  ⚠️  Confirms a full table scan — missing index on managing_officer_id.")
    elif "Index" in plan_text:
        print("\n  ✅ Using an index correctly.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())