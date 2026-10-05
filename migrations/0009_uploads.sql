-- Uploads: video files submitted by users.
--
-- The file itself lives in R2, not D1. D1 rows are capped well below what a
-- video needs, so the row here holds only metadata and a pointer to the object
-- key. That separation is also what lets a re-upload replace a file without
-- touching the catalog row.
--
-- Keyed by an unguessable id rather than the filename. If the object key
-- contained the title, anyone who guessed it could fetch the file directly and
-- bypass both the access rules and the download accounting.
CREATE TABLE IF NOT EXISTS uploads (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- R2 object key. The only place the file path exists.
  object_key     TEXT NOT NULL UNIQUE,
  -- What the uploader called it, kept for display only.
  original_name  TEXT,
  -- Declared by the client and re-checked against the stored object size where
  -- R2 reports one. bytes is the authoritative figure once finalised.
  bytes          INTEGER,
  content_type   TEXT,
  duration_secs  INTEGER,
  width          INTEGER,
  height         INTEGER,
  -- 'pending'  row written, object not yet confirmed
  -- 'ready'    object exists and is playable
  -- 'failed'   upload did not complete; the object is cleaned up
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);
-- The sweeper looks for abandoned pending rows, so that index is on status.
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status, created_at);

-- Which upload a title plays. NULL means the title has no video yet.
--
-- ON DELETE SET NULL rather than CASCADE: deleting an upload must not silently
-- delete the catalog row that points at it, since the row is what staff
-- curated. The title becomes video-less and is labelled as such instead.
ALTER TABLE titles ADD COLUMN upload_id TEXT REFERENCES uploads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_titles_upload ON titles(upload_id);
