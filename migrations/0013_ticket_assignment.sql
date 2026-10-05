-- Assigning a ticket to a member of staff.
--
-- Applied to production on 2026-10-05. Recorded here so the schema history lives
-- in one place and a fresh database gets the same shape. Do not re-run.

-- Who picked it up, so two staff do not answer the same person at once and so the
-- member can be told which person they are talking to.
--
-- ON DELETE SET NULL rather than CASCADE: if that staff account is purged, the
-- conversation must survive. Losing the assignment is correct -- nobody is
-- working on it any more -- but losing the whole support history because the
-- person who happened to be typing went away is not.
ALTER TABLE tickets ADD COLUMN accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tickets_accepted ON tickets(accepted_by);

-- The queue is ordered by what needs attention first, which is unclaimed before
-- claimed and then by most recent activity.
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, accepted_by, last_message_at DESC);