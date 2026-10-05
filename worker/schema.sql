-- Animeta schema
-- Phase 1: auth, catalog, watchlist, playback history.
-- Billing/subscriptions deliberately omitted for now.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  display_name  TEXT,
  -- Public handle, chosen at signup and shown in the UI. NOT NULL: every account
  -- has one. Uniqueness is case-insensitive via idx_users_username on
  -- lower(username), since SQLite's UNIQUE is case-sensitive.
  username      TEXT NOT NULL,
  last_seen_at  TEXT,
  -- Short non-reversible code derived from the password. Lets an owner confirm
  -- "is this still the password I set?" without ever storing or revealing it.
  password_fingerprint TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Soft delete with a recovery window. The row survives so the account stays
-- restorable until purge_after; deleted_at being non-null is what makes it
-- unusable. deleted_by is null for a self-delete, the staff id otherwise.
-- Every read of an account that matters filters on deleted_at IS NULL.
deleted_at   TEXT,
purge_after  TEXT,
deleted_by   TEXT,

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);
-- Case-insensitive uniqueness, which a plain UNIQUE on the column would not give.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(lower(username));

CREATE TABLE IF NOT EXISTS titles (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('anime','movie','series','ai')),
  title         TEXT NOT NULL,
  synopsis      TEXT NOT NULL DEFAULT '',
  genres        TEXT NOT NULL DEFAULT '[]',
  release_date  TEXT,
  runtime       TEXT,
  rating        REAL NOT NULL DEFAULT 0,
  poster_url    TEXT,
  backdrop_url  TEXT,
  video_url     TEXT,
  -- Where the video came from: 'upload' for a file the uploader sent, NULL for
  -- a hand-pasted URL. Lets the UI label provenance instead of implying one source.
  video_source  TEXT,
  -- How the video is played. NULL is treated as 'file' so a row written before
  -- this column keeps working.
  --   'file'   a progressive mp4 served directly
  --   'hls'    an m3u8 manifest, played by hls.js
  --   'embed'  an external player rendered as an iframe
  video_kind     TEXT,
  -- For video_kind = 'embed': the provider and its validated id. The player URL
  -- is rebuilt from these two values at render time and the pasted snippet is
  -- never stored, so a paste cannot become stored XSS.
  embed_provider TEXT,
  embed_id       TEXT,
  -- The upload this title plays from, when a user supplied the file rather than
  -- a link. ON DELETE SET NULL: removing an upload must not delete the catalog
  -- row, only leave it without a video.
  upload_id      TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  subtitles_url TEXT,
  featured      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_titles_type ON titles(type);
CREATE INDEX IF NOT EXISTS idx_titles_featured ON titles(featured);

CREATE TABLE IF NOT EXISTS seasons (
  id            TEXT PRIMARY KEY,
  title_id      TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  description   TEXT,
  UNIQUE (title_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_seasons_title ON seasons(title_id);

CREATE TABLE IF NOT EXISTS episodes (
  id                 TEXT PRIMARY KEY,
  season_id          TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number     INTEGER NOT NULL,
  title              TEXT,
  video_manifest_url TEXT,
  subtitles_url      TEXT,
  runtime            TEXT,
  -- Same playback kinds and same embed columns as titles, for the same reason.
  video_kind         TEXT,
  embed_provider     TEXT,
  embed_id           TEXT,
  UNIQUE (season_id, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id   TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

CREATE TABLE IF NOT EXISTS playback_records (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id       TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  position       REAL NOT NULL DEFAULT 0,
  device         TEXT,
  last_played_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
);

CREATE INDEX IF NOT EXISTS idx_playback_user ON playback_records(user_id);
CREATE INDEX IF NOT EXISTS idx_playback_title ON playback_records(title_id);

-- Per the spec's admin audit trail.
CREATE TABLE IF NOT EXISTS admin_action_log (
  id         TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adminlog_admin ON admin_action_log(admin_id, created_at);

-- Password reset links.
-- Only the SHA-256 hash of the token is stored: if this table ever leaked, the
-- tokens would be useless because the plaintext only ever exists in the
-- recipient's email (or in the admin's screen, once).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_expiry ON password_reset_tokens(expires_at);

-- Staff announcements, surfaced to users as notifications.
CREATE TABLE IF NOT EXISTS announcements (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  author_id    TEXT,
  author_email TEXT,
  audience     TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','staff')),
  edited         INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ann_published ON announcements(published_at DESC);

-- In-app notifications. Fan-out on write, which is fine at early-access scale
-- and keeps unread counts exact.
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  actor      TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id, read_at);

-- One row per user per UTC day they were active. Lets us measure gaps between
-- visits, which is what identifies someone returning after a long absence.
-- A current-state column like last_seen_at cannot show a gap once it is gone.
-- Fixed-window counters for credential endpoints. Also created lazily by the
-- Worker; declared here so a fresh database matches migrations/0003.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket       TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket)
);

CREATE TABLE IF NOT EXISTS user_activity_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_activity_day ON user_activity_days(day);

-- Small key/value store for admin-togglable behaviour.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------------ uploads
--
-- User-supplied video. The file itself lives in R2, because a D1 row is capped
-- far below what a video needs; this table holds metadata and a pointer to the
-- object key.
--
-- The key is generated, never derived from the filename: a key built from the
-- name would let anyone who guessed it fetch the file directly from R2 and skip
-- both the access rules and the download accounting.
--
-- The object key is the only place the file path exists, so it is never returned
-- to a client.
CREATE TABLE IF NOT EXISTS uploads (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key     TEXT NOT NULL UNIQUE,
  original_name  TEXT,
  bytes          INTEGER,
  content_type   TEXT,
  duration_secs  INTEGER,
  width          INTEGER,
  height         INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status, created_at);

-- ---------------------------------------------------------------- permissions
--
-- Roles stay coarse because they decide which tabs the console offers.
-- Permissions decide what a moderator may actually do, and are additive rows so
-- granting one does not change anybody's role.
--
-- Ids are part of the API contract and must not be renamed once seeded. The
-- catalogue matches PERMISSION_IDS in worker/permissions.js, which is the
-- source of truth for the code.

CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT NOT NULL,
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
   'View the user list and reset someone''s password.', 40),
  ('upload', 'Upload video',
   'Send a video file to the site and publish it to the catalog.', 50);