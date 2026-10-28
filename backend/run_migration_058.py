"""
Migration 058: Accounts flagged to change a MonieKing-set password.
Additive, idempotent. Source of truth: supabase/migrations/058_must_change_password.sql
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.core.database import engine

SQL_FILE = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "058_must_change_password.sql"


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
            print(f"[migration 058] running statement {i}/{len(stmts)}...")
            await conn.execute(text(stmt))
    print("[migration 058] done.")


if __name__ == "__main__":
    asyncio.run(run())
