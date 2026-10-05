-- Reopen requests on closed tickets.
--
-- Applied to production on 2026-10-05. Recorded here so the schema history lives
-- in one place and a fresh database gets the same shape. Do not re-run.

-- A member cannot reopen their own ticket, but they can ask. These columns
-- record that they did, and what they said, so the request is visible in the
-- queue rather than only having fired a notification that has since scrolled
-- away.
--
-- SET NULL on the requester, like accepted_by: losing the request is correct if
-- that account goes, and it is part of their own conversation anyway.
ALTER TABLE tickets ADD COLUMN reopen_requested_at TEXT;
ALTER TABLE tickets ADD COLUMN reopen_requested_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN reopen_note TEXT;

-- The queue needs to surface a waiting reopen request without scanning messages.
CREATE INDEX IF NOT EXISTS idx_tickets_reopen ON tickets(status, reopen_requested_at);