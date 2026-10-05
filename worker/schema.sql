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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
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
  -- Where the video came from: 'archive' for a public-domain file resolved
  -- from the Internet Archive, NULL for a hand-pasted URL. Lets the UI label
  -- provenance instead of implying one source.
  video_source  TEXT,
  -- Which TMDB record this title was posted from, kept so availability can be
  -- refreshed later without staff retyping the id. external_source is the TMDB
  -- namespace ('movie' or 'tv') and is stored rather than inferred from `type`,
  -- because staff can retype a title after posting.
  external_id      TEXT,
  external_source  TEXT,
  -- Where the title can legally be watched, as a snapshot of TMDB's
  -- JustWatch-backed availability at the time staff last ran a lookup.
  -- Stored rather than fetched per view so a public catalog page never spends
  -- TMDB quota, and because availability changes slowly enough that staff can
  -- refresh it deliberately. NULL means "not looked up yet".
  watch_providers TEXT,
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