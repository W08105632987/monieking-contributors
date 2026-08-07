"""
check_directors.py

Read-only diagnostic: lists every user with role='director' from your
Postgres `users` table, then cross-checks each one against Supabase Auth
(via the Admin API + service role key) to show whether a matching login
actually exists.

IMPORTANT: this CANNOT show you the password. Passwords are stored as
salted hashes in Supabase Auth and are not retrievable by anyone,
including you with the service role key. It will tell you whether an
auth account exists, its email alias, whether it's confirmed, and when
it last signed in. If you need access, use reset_director_password.py
(ask me for it) to set a new known password.

Usage:
    cd backend
    python check_directors.py

Requires your existing backend/.env (DATABASE_URL_SYNC, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY) to already be populated.
"""
import os
import sys
import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL_SYNC = os.environ["DATABASE_URL_SYNC"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def get_directors_from_db():
    conn = psycopg2.connect(DATABASE_URL_SYNC)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT id, full_name, phone_number, status, created_at
        FROM users
        WHERE role = 'director'
        ORDER BY created_at ASC
        """
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def lookup_auth_user_by_email(email: str):
    """Look up a Supabase Auth user by email via the Admin API."""
    resp = httpx.get(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        },
        params={"email": email},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    users = data.get("users", [])
    return users[0] if users else None


def main():
    directors = get_directors_from_db()

    if not directors:
        print("No users with role='director' found in the users table.")
        sys.exit(0)

    print(f"Found {len(directors)} director record(s) in the database:\n")

    for d in directors:
        phone = d["phone_number"]
        email_alias = f"{phone}@monieking.app"

        print("─" * 60)
        print(f"Name:          {d['full_name']}")
        print(f"Phone number:  {phone}")
        print(f"User ID:       {d['id']}")
        print(f"Status:        {d['status']}")
        print(f"Created at:    {d['created_at']}")
        print(f"Login email:   {email_alias}  (this is what Supabase Auth uses)")

        try:
            auth_user = lookup_auth_user_by_email(email_alias)
        except httpx.HTTPStatusError as e:
            print(f"Auth lookup failed: {e.response.status_code} {e.response.text}")
            continue

        if auth_user:
            print("Auth account:  EXISTS")
            print(f"  confirmed_at:    {auth_user.get('email_confirmed_at')}")
            print(f"  last_sign_in_at: {auth_user.get('last_sign_in_at')}")
            print(f"  auth user id:    {auth_user.get('id')}")
            if auth_user.get("id") != str(d["id"]):
                print("  ⚠ MISMATCH: auth user id does not match users.id — "
                      "this account is broken and login will fail with "
                      "USER_NOT_IN_PLATFORM or similar.")
        else:
            print("Auth account:  MISSING — no Supabase Auth user for this "
                  "email. This director row exists in your table but has "
                  "no way to log in at all.")

    print("─" * 60)
    print("\nPassword cannot be displayed (hashed, not retrievable). "
          "If you need to get into one of these accounts, use a password "
          "reset script instead of trying to 'find' the password.")


if __name__ == "__main__":
    main()