-- Adds the 'ads' title type, and a poster key for uploads.
--
-- Two unrelated changes in one migration because both are schema-level and
-- there is no reason to rebuild the table twice.
--
-- SQLite cannot ALTER a CHECK constraint, so titles has to be rebuilt to accept
-- a fifth type. This is the same procedure as 0002, which added 'ai'.
--
-- 'ads' is a real catalog category rather than a flag: an advertiser posts a
-- video, it gets its own page, and it is always labelled Sponsored. It is not
-- interleaved with organic results anywhere on the site.

-- Poster frame captured in the browser at upload time. Keyed, like the video,
-- because the object key must never be returned to a client.
ALTER TABLE uploads ADD COLUMN poster_key TEXT;

PRAGMA foreign_keys = OFF;

-- Column list taken from the live table rather than written from memory, so this
-- migration cannot silently drop a column added by 0007 or 0008. Missing
-- video_kind, embed_provider, embed_id or upload_id here would quietly discard
-- every uploaded video.
CREATE TABLE titles_new (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('anime','movie','series','ai','ads')),
  title         TEXT NOT NULL,
  synopsis      TEXT NOT NULL DEFAULT '',
  genres        TEXT NOT NULL DEFAULT '[]',
  release_date  TEXT,
  runtime       TEXT,
  rating        REAL NOT NULL DEFAULT 0,
  poster_url    TEXT,
  backdrop_url  TEXT,
  video_url     TEXT,
  video_source  TEXT,
  video_kind    TEXT,
  embed_provider TEXT,
  embed_id      TEXT,
  upload_id     TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  watch_providers TEXT,
  external_id   TEXT,
  external_source TEXT,
  subtitles_url TEXT,
  featured      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO titles_new
  SELECT id, slug, type, title, synopsis, genres, release_date, runtime, rating,
         poster_url, backdrop_url, video_url, video_source, video_kind,
         embed_provider, embed_id, upload_id, watch_providers, external_id,
         external_source, subtitles_url, featured, created_at, updated_at
  FROM titles;

DROP TABLE titles;
ALTER TABLE titles_new RENAME TO titles;

CREATE INDEX IF NOT EXISTS idx_titles_type ON titles(type);
CREATE INDEX IF NOT EXISTS idx_titles_featured ON titles(featured);
CREATE INDEX IF NOT EXISTS idx_titles_upload ON titles(upload_id);

PRAGMA foreign_keys = ON;
