-- Make users.username NOT NULL.
--
-- The column was added nullable so the backfill in 0001 could run against rows
-- that predated it. Every row now carries a value, so the constraint can be
-- enforced and the app no longer has to trust its own validation alone.
--
-- Same reasoning as 0002: SQLite cannot alter a column in place, and users is
-- referenced by watchlist, playback_records, notifications and several others,
-- so foreign_keys is off for the rebuild. All of those tables reference users(id),
-- which is copied verbatim, so no row is disturbed.
--
-- Not yet applied to production. Run:
--   npx wrangler d1 migrations apply animeta --remote
PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  display_name  TEXT,
  -- Public handle, chosen at signup and shown in the UI.
  -- NOT NULL: every account has one. Uniqueness is case-insensitive, enforced by
  -- idx_users_username on lower(username) rather than by a column constraint,
  -- since SQLite's UNIQUE is case-sensitive.
  username      TEXT NOT NULL,
  last_seen_at  TEXT,
  -- Short non-reversible code derived from the password. Lets an owner confirm
  -- "is this still the password I set?" without ever storing or revealing it.
  password_fingerprint TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new
  SELECT id, email, password_hash, salt, role, display_name, username,
         last_seen_at, password_fingerprint, created_at
  FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(lower(username));

PRAGMA foreign_keys = ON;