"""Replace the OLD predictable passwords (phone number + MK) that are still in use.   (finding S-14)

Every account that still has `must_change_password` set AND whose password is still phone+MK can be logged into by
anyone who knows the phone number. This finds them, gives each a random one-time password, and writes a CSV for you
to hand out (by SMS/WhatsApp, or through the director's "send password" button).

    python -m scripts.rotate_default_passwords             # DRY RUN: only counts them
    python -m scripts.rotate_default_passwords --apply     # rotate + write rotated_passwords.csv   (KEEP THAT FILE PRIVATE, delete it after use)

People who already chose their own password are never touched. Safe to run again.
"""
import asyncio
import csv
import sys

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password, verify_password
from app.services.default_password import default_password, new_temporary_password
from app.utils.supabase_admin_client import supabase_admin_request


async def main(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT id, full_name, phone_number, role, login_password_hash FROM users "
            "WHERE must_change_password = TRUE AND login_password_hash IS NOT NULL AND deleted_at IS NULL"))).all()
        weak = [r for r in rows if verify_password(default_password(r.phone_number), r.login_password_hash)]
        print(f"{len(rows)} accounts still must change their password; {len(weak)} of them still use phone+MK.")
        if not apply:
            print("(dry run - nothing changed; add --apply to rotate them)")
            return
        out, failed = [], 0
        for r in weak:
            pw = new_temporary_password()
            try:
                await supabase_admin_request("PUT", f"/auth/v1/admin/users/{r.id}", json={"password": pw},
                                             failure_detail="could not update login")
                await db.execute(text("UPDATE users SET login_password_hash = :h WHERE id = :i"), {"h": hash_password(pw), "i": str(r.id)})
                await db.commit()
                out.append((r.full_name, r.phone_number, r.role, pw))
            except Exception as e:  # noqa: BLE001
                failed += 1
                await db.rollback()
                print(f"  FAILED {r.phone_number}: {e}")
        with open("rotated_passwords.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["name", "phone", "role", "one_time_password"])
            w.writerows(out)
        print(f"Rotated {len(out)}, failed {failed}. Wrote rotated_passwords.csv - hand the codes out, then DELETE the file.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
