-- Granular staff permissions.
--
-- Roles stay coarse (user / moderator / admin) because they also decide what
-- the UI shows. Permissions answer a different question: what a moderator is
-- actually allowed to do. They are additive rows rather than a role change, so
-- granting "catalog" does not make someone an admin, and removing it does not
-- demote them.
--
-- The catalogue lives in worker/permissions.js. It is seeded here so the staff
-- console can list permissions by id and label without hardcoding them, and so
-- an unknown id in user_permissions can never be granted by accident.
CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Permission ids are part of the API contract, so they are not renamable
  -- once seeded.
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by TEXT,
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

INSERT OR IGNORE INTO permissions (id, label, description, sort_order) VALUES
  ('catalog', 'Manage the catalog',
   'Add, edit and delete titles, and resolve their video sources.', 10),
  ('announcements', 'Post announcements',
   'Write announcements and edit or delete the ones they wrote.', 20),
  ('notifications', 'Send notifications',
   'Send a notification to individual users or to a whole group.', 30),
  ('users', 'Manage users',
   'View the user list and reset someone''s password.', 40);

-- ------------------------------------------------------------ account deletion
--
-- Deletion is a soft delete with a recovery window: the row stays, the account
-- simply stops being usable. deleted_at is when deletion was requested, and
-- purge_after is when the row becomes eligible to be destroyed for good. The
-- window is stored as an absolute timestamp rather than recomputed from a
-- constant, so a change to the policy cannot retroactively shorten or extend a
-- window somebody is currently inside.
--
-- deleted_by is null for a self-delete and the acting staff id otherwise, which
-- is what makes "who removed this account" answerable in the audit log.
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN purge_after TEXT;
ALTER TABLE users ADD COLUMN deleted_by TEXT;

-- Partial index: the user table is small, but the purge query and the staff
-- listing both filter on this, and listing deleted accounts is the common case
-- rather than the exception once the feature exists.
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);