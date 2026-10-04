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
  last_seen_at  TEXT,
  -- Short non-reversible code derived from the password. Lets an owner confirm
  -- "is this still the password I set?" without ever storing or revealing it.
  password_fingerprint TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);

CREATE TABLE IF NOT EXISTS titles (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('anime','movie','series')),
  title         TEXT NOT NULL,
  synopsis      TEXT NOT NULL DEFAULT '',
  genres        TEXT NOT NULL DEFAULT '[]',
  release_date  TEXT,
  runtime       TEXT,
  rating        REAL NOT NULL DEFAULT 0,
  poster_url    TEXT,
  backdrop_url  TEXT,
  video_url     TEXT,
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