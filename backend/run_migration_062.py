"""
Migration 062: external income table for the Accounting Center.
Additive, idempotent. Source of truth: supabase/migrations/062_external_income.sql
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.core.database import engine

_p = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "062_external_income.sql"
SQL_FILE = _p


def _statements() -> list[str]:
    """Split the .sql file into statements, keeping $$ ... $$ blocks whole."""
    sql = SQL_FILE.read_text(encoding="utf-8")
    out, buf, in_dollar = [], [], False
    for line in sql.splitlines():
        stripped = line.strip()
        if not buf and (not stripped or stripped.startswith("--")):
            continue
        buf.append(line)
        if line.count("$$") % 2 == 1:
            in_dollar = not in_dollar
        if not in_dollar and stripped.endswith(";"):
            out.append("\n".join(buf))
            buf = []
    if buf:
        out.append("\n".join(buf))
    return out


async def run():
    stmts = _statements()
    async with engine.begin() as conn:
        for i, stmt in enumerate(stmts, 1):
            print(f"[migration 062] running statement {i}/{len(stmts)}...")
            await conn.execute(text(stmt))
    # Proof: any table in `public` that still has Row Level Security OFF (should be none)
    async with engine.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity ORDER BY 1"))).all()
    print(f"[migration 062] tables still WITHOUT row-level security: {len(rows)}" + (" -> " + ", ".join(r[0] for r in rows) if rows else " (good)"))
    print("[migration 062] done.")


if __name__ == "__main__":
    asyncio.run(run())

