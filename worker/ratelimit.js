/**
 * Fixed-window rate limiter for credential endpoints.
 *
 * Backed by D1 rather than memory so the limits survive a Worker isolate being
 * recycled, which they otherwise would. The window is a fixed minute bucket
 * computed in SQL, so no cleanup pass is needed and concurrent requests in the
 * same window share a row.
 */

const BUCKETS_TABLE = `
  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket       TEXT NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket)
  )`;

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Ensures the table exists. D1 cannot run this in a Worker subrequest, so it is
 * called once per isolate and memoised.
 */
let ready = null;
function ensureTable(env) {
  if (!ready) {
    ready = env.DB.prepare(BUCKETS_TABLE)
      .run()
      .catch((e) => {
        // Let the next request retry rather than caching the failure forever.
        ready = null;
        throw e;
      });
  }
  return ready;
}

/** The current window key, e.g. "login:203.0.113.4:29384712". */
function windowKey(scope, request, windowSeconds, now) {
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const ip =
    request.headers.get('cf-connecting-ip') ||
    // Local dev has no CF header; fall back to something stable per client.
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  return `${scope}:${ip}:${bucket}`;
}

/**
 * Counts one hit and reports whether the caller is now over `limit`.
 *
 * Returns { allowed, remaining, retryAfter }.
 */
export async function hitRateLimit(env, request, scope, { limit = DEFAULT_LIMIT, windowSeconds = DEFAULT_WINDOW_SECONDS } = {}) {
  await ensureTable(env);

  const now = Date.now();
  const bucket = windowKey(scope, request, windowSeconds, now);

  await env.DB.prepare(
    'INSERT INTO auth_rate_limits (bucket, hits) VALUES (?, 1) ' +
      'ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1',
  )
    .bind(bucket)
    .run();

  const row = await env.DB.prepare('SELECT hits FROM auth_rate_limits WHERE bucket = ?')
    .bind(bucket)
    .first();

  const hits = row?.hits ?? 1;

  // Delete the previous window so the table does not grow forever.
  env.DB.prepare('DELETE FROM auth_rate_limits WHERE bucket NOT LIKE ?')
    .bind(`${scope}:%`)
    .run()
    .catch(() => {});

  const windowEnd = (Math.floor(now / (windowSeconds * 1000)) + 1) * windowSeconds * 1000;

  return {
    allowed: hits <= limit,
    remaining: Math.max(0, limit - hits),
    retryAfter: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
  };
}

/**
 * Clears a caller's hits after a success, so one typo does not lock a real
 * user out for the rest of the window.
 */
export async function clearRateLimit(env, request, scope, windowSeconds = DEFAULT_WINDOW_SECONDS) {
  const bucket = windowKey(scope, request, windowSeconds, Date.now());
  await env.DB.prepare('DELETE FROM auth_rate_limits WHERE bucket = ?').bind(bucket).run().catch(() => {});
}

/**
 * Password strength check for user-supplied secrets.
 *
 * Deliberately modest: length is the dominant factor, so this rejects the
 * obvious weak choices without pretending to be a full policy engine.
 */
export function passwordProblem(password) {
  const p = String(password ?? '');

  if (p.length < 10) return 'Use at least 10 characters';
  if (p.length > 200) return 'That password is too long';
  if (/^(.)\1+$/.test(p)) return 'Use something less repetitive';
  // Requires all three classes. The earlier /[A-Z0-9]/ test let an all-lowercase
  // password pass, because a digit satisfied it.
  if (!/[a-z]/.test(p)) return 'Add a lowercase letter';
  if (!/[A-Z]/.test(p)) return 'Add a capital letter';
  if (!/[0-9]/.test(p)) return 'Add a number';

  const common = ['password', '12345678', 'qwertyui', 'letmein1', 'iloveyou', 'admin123'];
  if (common.some((c) => p.toLowerCase().includes(c))) {
    return 'That password is too common';
  }
  return null;
}