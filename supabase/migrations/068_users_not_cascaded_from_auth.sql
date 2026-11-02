-- 068: Deleting a customer failed with "login could not be removed".
-- users.id referenced auth.users(id) ON DELETE CASCADE, so removing the login tried to delete the public user row
-- too. When that person has money records the row is kept (archived), the cascade is refused and Supabase answers
-- "Database error deleting user". The API owns the users table, so the link to auth.users is dropped.
-- Idempotent.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'f' AND confrelid = 'auth.users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
