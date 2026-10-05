-- Add the 'ai' title type alongside anime/movie/series.
--
-- Already applied to production on 2026-10-05 by hand. Recorded here for the
-- same reason as 0001. Do not re-run against production.
--
-- SQLite cannot alter a CHECK constraint, so the table has to be rebuilt.
--
-- foreign_keys is off for the duration: seasons and episodes point at titles,
-- and dropping the table while those references are live would either fail or
-- cascade away real rows. Verified after applying that all 10 original titles
-- and the featured flag survived.
PRAGMA foreign_keys = OFF;

CREATE TABLE titles_new (
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
  subtitles_url TEXT,
  featured      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO titles_new
  SELECT id, slug, type, title, synopsis, genres, release_date, runtime, rating,
         poster_url, backdrop_url, video_url, subtitles_url, featured,
         created_at, updated_at
  FROM titles;

DROP TABLE titles;
ALTER TABLE titles_new RENAME TO titles;

CREATE INDEX IF NOT EXISTS idx_titles_type ON titles(type);
CREATE INDEX IF NOT EXISTS idx_titles_featured ON titles(featured);

PRAGMA foreign_keys = ON;