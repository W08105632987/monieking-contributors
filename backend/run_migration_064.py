"""
Migrations 064, 065, 066: settings registry, bill units/address, affiliated officers.
Additive, idempotent (safe to run more than once). Source of truth: supabase/migrations/064_*.sql, 065_*.sql, 066_*.sql
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.core.database import engine

_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
SQL_FILES = [_DIR / "064_settings_registry.sql", _DIR / "065_bill_units_address.sql", _DIR / "066_affiliated_officers.sql"]


def _statements(SQL_FILE: Path) -> list[str]:
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
    for f in SQL_FILES:
        stmts = _statements(f)
        async with engine.begin() as conn:
            for i, stmt in enumerate(stmts, 1):
                print(f"[migration {f.name[:3]}] running statement {i}/{len(stmts)}...")
                await conn.execute(text(stmt))
    # Proof: any table in `public` that still has Row Level Security OFF (should be none)
    async with engine.connect() as conn:
        rows = (await conn.execute(text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity ORDER BY 1"))).all()
    print(f"[migration 064-066] tables still WITHOUT row-level security: {len(rows)}" + (" -> " + ", ".join(r[0] for r in rows) if rows else " (good)"))
    print("[migration 064-066] done.")


if __name__ == "__main__":
    asyncio.run(run())

