-- Fixed-window rate limit counters for login, signup and password-reset.
--
-- In flight as of the auth-hardening work. Not yet applied to production: the
-- Worker creates this table itself on first use (see worker/ratelimit.js), so
-- it appears automatically on the next login attempt. It is declared here so a
-- fresh database has the full shape before any request arrives.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket       TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket)
);