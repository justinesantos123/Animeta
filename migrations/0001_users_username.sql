-- Public handles on accounts.
--
-- Already applied to production on 2026-10-05 by hand, together with the
-- backfill below. Recorded here so the schema history is in one place and a
-- fresh database gets the same shape. Do not re-run against production.
ALTER TABLE users ADD COLUMN username TEXT;

-- Backfill from the email local-part, which is what the app derived anyway.
UPDATE users SET username = lower(substr(email, 1, instr(email, '@') - 1))
  WHERE username IS NULL;

-- Case-insensitive: "Kaede" and "kaede" must not both be taken.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(lower(username));