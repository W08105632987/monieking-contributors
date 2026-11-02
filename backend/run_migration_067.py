"""
Migrations 067 and 068:
- 067: Director journal, WhatsApp community gate, marking corrections, food-card conversion reminders
- 068: Drop FK cascade from public.users to auth.users
Additive, idempotent (safe to run more than once).
"""
import sys
import os
import re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.core.database import engine

_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
SQL_FILES = [
    _DIR / "067_journal_community_marking_food_conversion.sql",
    _DIR / "068_users_not_cascaded_from_auth.sql",
]


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
        if not in_dollar:
            # Check if effective code (before any trailing comment) ends with ';'
            code_part = re.sub(r"--.*$", "", line).strip()
            if code_part.endswith(";"):
                stmt = "\n".join(buf).strip()
                if stmt:
                    out.append(stmt)
                buf = []
    if buf:
        stmt = "\n".join(buf).strip()
        if stmt:
            out.append(stmt)
    return out


async def run():
    async with engine.connect() as conn:
        for f in SQL_FILES:
            stmts = _statements(f)
            for i, stmt in enumerate(stmts, 1):
                first_line = stmt.strip().splitlines()[0][:60]
                print(f"[migration {f.name[:3]}] statement {i}/{len(stmts)}: {first_line}...")
                await conn.execute(text(stmt))
                await conn.commit()

        # Proof: any table in `public` that still has Row Level Security OFF (should be none)
        rows = (await conn.execute(text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity ORDER BY 1"
        ))).all()
        print(f"[migration 067-068] tables still WITHOUT row-level security: {len(rows)}" + (" -> " + ", ".join(r[0] for r in rows) if rows else " (good)"))
        print("[migration 067-068] done.")


if __name__ == "__main__":
    asyncio.run(run())
