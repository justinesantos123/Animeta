-- Email verification, phone numbers, and the support ticket queue.
--
-- Applied to production on 2026-10-05. Recorded here so the schema history lives
-- in one place and a fresh database gets the same shape. Do not re-run.

-- ---------------------------------------------------------------- verification
--
-- The address is the only thing verified. The phone number is collected because
-- staff ask for it, but nothing is sent to it and no code is ever requested, so
-- it must not carry a "verified" column that would imply otherwise.
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN email_verify_token_hash TEXT;
ALTER TABLE users ADD COLUMN email_verify_expires_at TEXT;
ALTER TABLE users ADD COLUMN email_verify_sent_at TEXT;

-- Every account that already exists was signed into before verification existed,
-- including the owner. Backfilling from created_at keeps those accounts working;
-- without this the owner would be locked out of their own site by a deploy.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_verified ON users(email_verified_at);
CREATE INDEX IF NOT EXISTS idx_users_verify_token ON users(email_verify_token_hash);

-- -------------------------------------------------------------------- tickets
--
-- A support request from a member to staff. Two tables rather than one so a
-- conversation is append-only: replies cannot be edited away, and closing a
-- ticket is a status change instead of a deletion.
--
-- ON DELETE CASCADE because a ticket is part of the account it came from. When
-- the account is purged the ticket goes with it, rather than leaving a support
-- history describing a person who no longer exists on the site.
CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  -- Denormalised so the queue does not need a join for "how many are waiting",
  -- which is the number the dashboard leads with.
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  closed_by   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, created_at DESC);

-- One row per message. author_side is stored rather than derived, because a
-- staff reply and a member reply are governed by different rules: only staff
-- may put links in a ticket. Deriving it from the author's role at read time
-- would break the moment somebody's role changes underneath an old message.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_side TEXT NOT NULL CHECK (author_side IN ('member','staff')),
  body        TEXT NOT NULL,
  -- Whether this message was allowed to contain a URL. Kept as a fact about the
  -- message rather than recomputed, so the record says what was actually sent.
  has_link    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);

-- --------------------------------------------------------------- permissions
--
-- Ticket handling is its own grant rather than being folded into `notifications`,
-- so an admin can let somebody answer members without also letting them send
-- site-wide announcements. Admins hold it implicitly, as with every permission.
INSERT OR IGNORE INTO permissions (id, label, description, sort_order) VALUES
  ('tickets', 'Handle support tickets',
   'Read, reply to and close support tickets raised by members.', 60);