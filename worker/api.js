import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  randomSalt,
  randomHex,
  generatePassword,
  generateResetToken,
  hashResetToken,
  passwordFingerprint,
  sessionCookie,
  clearSessionCookie,
  COOKIE_NAME,
} from './crypto.js';
import { sendPasswordResetEmail, mailConfigured } from './mailer.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Throttle so an active session does not write on every single request.
const LAST_SEEN_THROTTLE_MINUTES = 5;

/** A visit counts as a "return" after this many days of absence. */
const RETURN_AFTER_DAYS = 30;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Records today as an active day, and reports whether this visit follows a
 * long gap. Called before last_seen_at is overwritten, while the previous
 * value is still readable.
 */
async function touchActivity(env, userId, previousLastSeen) {
  const day = utcDay();
  const already = await env.DB.prepare(
    'SELECT 1 AS x FROM user_activity_days WHERE user_id = ? AND day = ?',
  )
    .bind(userId, day)
    .first();

  if (!already) {
    await env.DB.prepare('INSERT OR IGNORE INTO user_activity_days (user_id, day) VALUES (?, ?)').bind(
      userId,
      day,
    ).run();
  }

  const gap = daysSince(previousLastSeen);
  // Never-seen users are new signups, not returnees.
  if (gap === null || gap < RETURN_AFTER_DAYS) return null;

  // Already welcomed for this gap? Avoid re-notifying on every later request.
  const prior = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = ?',
  )
    .bind(userId, 'return_welcome')
    .first();
  if ((prior?.n ?? 0) > 0) return null;

  return { gapDays: gap };
}

async function getUser(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (!payload?.sub) return null;

  const row = await env.DB.prepare(
    'SELECT id, email, role, display_name, last_seen_at FROM users WHERE id = ?',
  )
    .bind(payload.sub)
    .first();
  if (!row) return null;

  // Any authenticated request counts as being present. This is what the
  // dashboard's active/offline figures are derived from.
  const previous = row.last_seen_at;
  const stale =
    !previous ||
    Date.now() - new Date(previous.includes('T') ? previous : `${previous.replace(' ', 'T')}Z`).getTime() >
      LAST_SEEN_THROTTLE_MINUTES * 60 * 1000;

  if (stale) {
    await env.DB.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?")
      .bind(row.id)
      .run();
  }

  // Daily ledger + return detection, also throttled to once a day.
  if (await isNewDayFor(env, row.id)) {
    const returned = await touchActivity(env, row.id, previous);
    if (returned && (await settingOn(env, 'auto_return_notifications'))) {
      await notify(env, {
        userIds: [row.id],
        kind: 'return_welcome',
        title: `Welcome back after ${returned.gapDays} days`,
        body: 'We saved your place. Pick up where you left off.',
        link: '/',
        actor: 'Animeta',
      });
      await env.DB.prepare(
        'INSERT INTO admin_action_log (id, admin_id, action, target_id, detail) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(randomHex(16), row.id, 'user.returned', row.id, `${returned.gapDays}d`)
        .run();
    }
  }

  return row;
}

/** True when the user has no ledger row for today. */
async function isNewDayFor(env, userId) {
  const row = await env.DB.prepare(
    'SELECT 1 AS x FROM user_activity_days WHERE user_id = ? AND day = ?',
  )
    .bind(userId, utcDay())
    .first();
  return !row;
}

export async function settingOn(env, key, fallback = true) {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(key)
    .first();
  if (!row) return fallback;
  return row.value === 'on' || row.value === 'true' || row.value === '1';
}

/** Days since an account was last seen. null means it has never been seen. */
function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// Presence buckets. ONLINE is a live-session signal; the rest are recency bands.
const ACTIVE_DAYS = 7;
const IDLE_DAYS = 30;

function presenceOf(daysOffline) {
  if (daysOffline === null) return 'never';
  if (daysOffline === 0) return 'online';
  if (daysOffline <= ACTIVE_DAYS) return 'active';
  if (daysOffline <= IDLE_DAYS) return 'idle';
  return 'offline';
}

function parseGenres(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shapeTitle(row) {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    synopsis: row.synopsis,
    genres: parseGenres(row.genres),
    releaseDate: row.release_date,
    runtime: row.runtime,
    rating: row.rating,
    posterUrl: row.poster_url,
    backdropUrl: row.backdrop_url,
    videoUrl: row.video_url,
    subtitlesUrl: row.subtitles_url,
    featured: Boolean(row.featured),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}

// ---------------------------------------------------------------- routes

async function handleSignup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address' }, 400);
  if (!validPassword(password)) return json({ error: 'Password must be at least 8 characters' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'An account with that email already exists' }, 409);

  const id = randomHex(16);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  // Admin is granted by OWNER_EMAIL or by an explicit promotion. Never by
  // registration order -- otherwise whoever signs up first becomes owner.
  const role = ownerEmails(env).includes(email) ? 'admin' : 'user';

  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, salt, role, password_fingerprint) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, email, hash, salt, role, await passwordFingerprint(password))
    .run();

  const token = await signToken({ sub: id, role }, env.SESSION_SECRET);
  return json({ user: { id, email, role } }, 201, { 'set-cookie': sessionCookie(token) });
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const row = await env.DB.prepare(
    'SELECT id, email, password_hash, salt, role, display_name FROM users WHERE email = ?',
  )
    .bind(email)
    .first();

  // Same message either way so the endpoint can't enumerate registered emails.
  if (!row) return json({ error: 'Invalid email or password' }, 401);
  if (!(await verifyPassword(password, row.salt, row.password_hash))) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const token = await signToken({ sub: row.id, role: row.role }, env.SESSION_SECRET);
  return json(
    { user: { id: row.id, email: row.email, role: row.role, displayName: row.display_name } },
    200,
    { 'set-cookie': sessionCookie(token) },
  );
}

function handleLogout() {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

async function handleMe(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ user: null }, 200);
  return json({
    user: { id: user.id, email: user.email, role: user.role, displayName: user.display_name },
  });
}

async function handleListTitles(request, env, url) {
  const type = url.searchParams.get('type');
  const genre = url.searchParams.get('genre');
  const q = url.searchParams.get('q');
  const featuredOnly = url.searchParams.get('featured') === '1';

  const where = [];
  const binds = [];

  if (type && ['anime', 'movie', 'series'].includes(type)) {
    where.push('type = ?');
    binds.push(type);
  }
  if (featuredOnly) where.push('featured = 1');
  if (genre) {
    where.push('genres LIKE ?');
    binds.push(`%${genre}%`);
  }
  if (q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(synopsis) LIKE ? OR LOWER(genres) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    binds.push(like, like, like);
  }

  const sql = `SELECT * FROM titles ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY featured DESC, rating DESC, title ASC`;

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ titles: results.map(shapeTitle) });
}

async function handleGetTitle(request, env, url, slug) {
  const row = await env.DB.prepare('SELECT * FROM titles WHERE slug = ?').bind(slug).first();
  if (!row) return json({ error: 'Title not found' }, 404);

  const seasons = await env.DB.prepare(
    'SELECT id, season_number, description FROM seasons WHERE title_id = ? ORDER BY season_number',
  )
    .bind(row.id)
    .all();

  const episodes = await env.DB.prepare(
    `SELECT e.id, e.episode_number, e.title, e.video_manifest_url, e.subtitles_url, e.runtime, e.season_id
     FROM episodes e JOIN seasons s ON s.id = e.season_id
     WHERE s.title_id = ? ORDER BY s.season_number, e.episode_number`,
  )
    .bind(row.id)
    .all();

  return json({
    title: shapeTitle(row),
    seasons: seasons.results,
    episodes: episodes.results,
  });
}

const STAFF_ROLES = ['admin', 'moderator'];

/** True when the signed-in account is staff (any tier below owner). */
async function requireStaff(request, env) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: 'Authentication required' }, 401) };
  if (!STAFF_ROLES.includes(user.role)) {
    return { error: json({ error: 'Staff access required' }, 403) };
  }
  return { user };
}

async function requireAdmin(request, env) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: 'Authentication required' }, 401) };
  if (user.role !== 'admin') return { error: json({ error: 'Admin access required' }, 403) };
  return { user };
}

/**
 * Owner-only tier. OWNER_EMAIL is a config var so promoting the owner does not
 * depend on who happened to register first.
 */
function ownerEmails(env) {
  return String(env.OWNER_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function requireOwner(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth;
  const owners = ownerEmails(env);
  // With no OWNER_EMAIL configured the owner tier cannot be enforced, so refuse
  // rather than silently letting any admin through.
  if (owners.length === 0) {
    return { error: json({ error: 'OWNER_EMAIL is not configured on this Worker' }, 500) };
  }
  if (!owners.includes(auth.user.email.toLowerCase())) {
    return { error: json({ error: 'Only the site owner can do this' }, 403) };
  }
  return auth;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function handleCreateTitle(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const type = String(body.type ?? '');
  const name = String(body.title ?? '').trim();
  if (!name) return json({ error: 'Title is required' }, 400);
  if (!['anime', 'movie', 'series'].includes(type)) {
    return json({ error: 'type must be anime, movie or series' }, 400);
  }

  let slug = slugify(body.slug || name);
  if (!slug) return json({ error: 'Could not derive a slug from that title' }, 400);

  const clash = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?').bind(slug).first();
  if (clash) return json({ error: 'A title with that slug already exists' }, 409);

  const id = randomHex(16);
  const genres = JSON.stringify(Array.isArray(body.genres) ? body.genres : []);

  await env.DB.prepare(
    `INSERT INTO titles (id, slug, type, title, synopsis, genres, release_date, runtime, rating,
       poster_url, backdrop_url, video_url, subtitles_url, featured)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      slug,
      type,
      name,
      String(body.synopsis ?? ''),
      genres,
      body.releaseDate ?? null,
      body.runtime ?? null,
      Number(body.rating ?? 0),
      body.posterUrl ?? null,
      body.backdropUrl ?? null,
      body.videoUrl ?? null,
      body.subtitlesUrl ?? null,
      body.featured ? 1 : 0,
    )
    .run();

  await env.DB.prepare(
    'INSERT INTO admin_action_log (id, admin_id, action, target_id, detail) VALUES (?,?,?,?,?)',
  )
    .bind(randomHex(16), auth.user.id, 'title.create', id, slug)
    .run();

  const row = await env.DB.prepare('SELECT * FROM titles WHERE id = ?').bind(id).first();
  return json({ title: shapeTitle(row) }, 201);
}

async function handleUpdateTitle(request, env, slug) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const existing = await env.DB.prepare('SELECT * FROM titles WHERE slug = ?').bind(slug).first();
  if (!existing) return json({ error: 'Title not found' }, 404);

  const next = {
    title: body.title ?? existing.title,
    synopsis: body.synopsis ?? existing.synopsis,
    genres: body.genres ? JSON.stringify(body.genres) : existing.genres,
    release_date: body.releaseDate ?? existing.release_date,
    runtime: body.runtime ?? existing.runtime,
    rating: body.rating ?? existing.rating,
    poster_url: body.posterUrl ?? existing.poster_url,
    backdrop_url: body.backdropUrl ?? existing.backdrop_url,
    video_url: body.videoUrl ?? existing.video_url,
    subtitles_url: body.subtitlesUrl ?? existing.subtitles_url,
    featured: body.featured === undefined ? existing.featured : body.featured ? 1 : 0,
    type: body.type ?? existing.type,
  };

  await env.DB.prepare(
    `UPDATE titles SET title=?, synopsis=?, genres=?, release_date=?, runtime=?, rating=?,
       poster_url=?, backdrop_url=?, video_url=?, subtitles_url=?, featured=?, type=?,
       updated_at=datetime('now')
     WHERE id=?`,
  )
    .bind(
      next.title,
      next.synopsis,
      next.genres,
      next.release_date,
      next.runtime,
      next.rating,
      next.poster_url,
      next.backdrop_url,
      next.video_url,
      next.subtitles_url,
      next.featured,
      next.type,
      existing.id,
    )
    .run();

  await env.DB.prepare(
    'INSERT INTO admin_action_log (id, admin_id, action, target_id, detail) VALUES (?,?,?,?,?)',
  )
    .bind(randomHex(16), auth.user.id, 'title.update', existing.id, slug)
    .run();

  const row = await env.DB.prepare('SELECT * FROM titles WHERE id = ?').bind(existing.id).first();
  return json({ title: shapeTitle(row) });
}

async function handleDeleteTitle(request, env, slug) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const existing = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?').bind(slug).first();
  if (!existing) return json({ error: 'Title not found' }, 404);

  await env.DB.prepare('DELETE FROM titles WHERE id = ?').bind(existing.id).run();
  await env.DB.prepare(
    'INSERT INTO admin_action_log (id, admin_id, action, target_id, detail) VALUES (?,?,?,?,?)',
  )
    .bind(randomHex(16), auth.user.id, 'title.delete', existing.id, slug)
    .run();

  return json({ ok: true });
}

async function handleGetWatchlist(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT t.*, w.created_at AS saved_at FROM watchlist w
     JOIN titles t ON t.id = w.title_id
     WHERE w.user_id = ? ORDER BY w.created_at DESC`,
  )
    .bind(user.id)
    .all();

  return json({ titles: results.map(shapeTitle) });
}

async function handleAddWatchlist(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const title = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?')
    .bind(String(body.slug ?? ''))
    .first();
  if (!title) return json({ error: 'Title not found' }, 404);

  await env.DB.prepare(
    'INSERT INTO watchlist (user_id, title_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
  )
    .bind(user.id, title.id)
    .run();

  return json({ ok: true }, 201);
}

async function handleRemoveWatchlist(request, env, slug) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const title = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?').bind(slug).first();
  if (!title) return json({ error: 'Title not found' }, 404);

  await env.DB.prepare('DELETE FROM watchlist WHERE user_id = ? AND title_id = ?')
    .bind(user.id, title.id)
    .run();

  return json({ ok: true });
}

async function handlePlaybackStart(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const title = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?')
    .bind(String(body.slug ?? ''))
    .first();
  if (!title) return json({ error: 'Title not found' }, 404);

  const position = Number(body.position ?? 0);
  if (!Number.isFinite(position) || position < 0) return json({ error: 'Invalid position' }, 400);

  await env.DB.prepare(
    `INSERT INTO playback_records (user_id, title_id, position, device)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, title_id) DO UPDATE SET
       position = excluded.position,
       device = excluded.device,
       last_played_at = datetime('now')`,
  )
    .bind(user.id, title.id, position, String(body.device ?? 'web').slice(0, 40))
    .run();

  return json({ ok: true });
}

async function handleContinueWatching(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT t.*, p.position, p.last_played_at FROM playback_records p
     JOIN titles t ON t.id = p.title_id
     WHERE p.user_id = ? ORDER BY p.last_played_at DESC LIMIT 10`,
  )
    .bind(user.id)
    .all();

  return json({
    titles: results.map((r) => ({ ...shapeTitle(r), position: r.position })),
  });
}

// ------------------------------------------------- user management (admin)

const RESET_TTL_MINUTES = 60;

/**
 * Issues a reset token and returns the link.
 *
 * Only SHA-256(token) is stored. Any previous live token for the user is
 * cleared first so only one link is ever valid.
 */
async function issueResetLink(env, user, request) {
  const token = generateResetToken();
  const tokenHash = await hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000).toISOString();

  await env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(randomHex(16), user.id, tokenHash, expiresAt)
    .run();

  const appUrl = String(env.APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const mail = await sendPasswordResetEmail(env, {
    to: user.email,
    resetUrl,
    expiresMinutes: RESET_TTL_MINUTES,
  });

  return { resetUrl, emailed: mail.sent, reason: mail.reason, expiresMinutes: RESET_TTL_MINUTES };
}

/**
 * Admin generates a reset link for a user and hands it over directly.
 *
 * This is the path that keeps working with no mail provider configured, which
 * is the situation while the site is on a test subdomain.
 */
async function handleAdminSendResetLink(request, env, targetId) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!user) return json({ error: 'User not found' }, 404);

  const result = await issueResetLink(env, user, request);
  await logAdminAction(env, auth.user.id, 'user.resetlink', user.id, user.email);

  return json({
    ok: true,
    email: user.email,
    resetUrl: result.resetUrl,
    emailed: result.emailed,
    deliveryReason: result.reason,
    expiresMinutes: result.expiresMinutes,
  });
}

async function handleListUsers(request, env) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.display_name, u.created_at, u.password_fingerprint, u.last_seen_at,
            (SELECT COUNT(*) FROM watchlist w WHERE w.user_id = u.id) AS watchlist_count,
            (SELECT MAX(last_played_at) FROM playback_records p WHERE p.user_id = u.id) AS last_active
     FROM users u
     ORDER BY u.created_at ASC`,
  ).all();

  const owners = ownerEmails(env);

  // Reset history per user, so staff can see who last changed a credential and when.
  const history = {};
  const { results: logs } = await env.DB.prepare(
    `SELECT target_id, action, detail, created_at FROM admin_action_log
     WHERE action IN ('user.password.reset','user.role.admin','user.role.moderator','user.role.user')
     ORDER BY created_at DESC LIMIT 200`,
  ).all();
  for (const l of logs) {
    if (!l.target_id) continue;
    (history[l.target_id] ||= []).push({
      action: l.action,
      detail: l.detail,
      at: l.created_at,
    });
  }

  // NOTE: password_hash and salt are deliberately never selected here.
  return json({
    users: results.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      displayName: u.display_name,
      createdAt: u.created_at,
      watchlistCount: u.watchlist_count,
      lastActive: u.last_active,
      isOwner: owners.includes(u.email.toLowerCase()),
      lastSeenAt: u.last_seen_at,
      daysOffline: daysSince(u.last_seen_at),
      presence: presenceOf(daysSince(u.last_seen_at)),
      // Non-reversible 8-char code. Identifies a credential without revealing it.
      passwordFingerprint: u.password_fingerprint,
      passwordHistory: (history[u.id] || []).slice(0, 5),
    })),
    // The frontend treats a truthy ownerEmail as "the signed-in user is the
    // owner", so only report it when that is actually true.
    ownerEmail: owners.includes(auth.user.email.toLowerCase()) ? auth.user.email : null,
    ownerEmails: owners,
    mailConfigured: mailConfigured(env),
  });
}

/** Owner-created account with a known password. Useful for early-access logins. */
async function handleCreateUser(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'An account with that email already exists' }, 409);

  // Generate a strong password unless the admin supplied one.
  const supplied = typeof body.password === 'string' && body.password.length > 0;
  const password = supplied ? String(body.password) : generatePassword(16);
  if (!validPassword(password)) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const roles = ['user', 'moderator', 'admin'];
  const requestedRole = roles.includes(body.role) ? body.role : 'user';
  // Only the owner may mint admins; admins may create moderators.
  const isOwner = ownerEmails(env).includes(auth.user.email.toLowerCase());
  const role = requestedRole === 'admin' && !isOwner ? 'user' : requestedRole;

  const id = randomHex(16);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);

  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, salt, role, display_name, password_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, email, hash, salt, role, body.displayName ?? null, await passwordFingerprint(password))
    .run();

  await logAdminAction(env, auth.user.id, 'user.create', id, email);

  return json(
    {
      user: { id, email, role },
      // Returned exactly once so the admin can hand it over. Never stored readable.
      password: supplied ? null : password,
    },
    201,
  );
}

/** Owner only: promote or demote an admin. */
async function handleSetRole(request, env, targetId) {
  const auth = await requireOwner(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const role = body.role;
  if (!['user', 'moderator', 'admin'].includes(role)) {
    return json({ error: 'role must be admin, moderator or user' }, 400);
  }

  const owners = ownerEmails(env);
  const target = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  // Guard against the owner locking themselves out of the admin tier.
  if (owners.includes(target.email.toLowerCase()) && role !== 'admin') {
    return json({ error: 'The owner cannot be demoted' }, 400);
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, target.id).run();
  await logAdminAction(env, auth.user.id, `user.role.${role}`, target.id, target.email);

  return json({ ok: true, role });
}

/**
 * Admin resets a user's password. The new value is generated, hashed with a
 * fresh salt, and returned once in this response. It is never persisted in
 * readable form, so it cannot be displayed again later.
 */
async function handleAdminResetPassword(request, env, targetId) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  const target = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  const password = generatePassword(16);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);

  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, password_fingerprint = ? WHERE id = ?',
  )
    .bind(hash, salt, await passwordFingerprint(password), target.id)
    .run();

  // Existing sessions keep working; force re-login with the new password.
  await env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(target.id).run();
  await logAdminAction(env, auth.user.id, 'user.password.reset', target.id, target.email);

  return json({
    ok: true,
    email: target.email,
    password,
    notice: 'Shown once. Copy it now - it cannot be retrieved later.',
  });
}

/** Owner only: delete an account. */
async function handleDeleteUser(request, env, targetId) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const target = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  const owners = ownerEmails(env);
  if (owners.includes(target.email.toLowerCase())) {
    return json({ error: 'The owner cannot be deleted' }, 400);
  }
  if (target.id === auth.user.id) return json({ error: 'You cannot delete your own account' }, 400);

  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
  await logAdminAction(env, auth.user.id, 'user.delete', target.id, target.email);

  return json({ ok: true });
}

async function logAdminAction(env, adminId, action, targetId, detail) {
  await env.DB.prepare(
    'INSERT INTO admin_action_log (id, admin_id, action, target_id, detail) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(randomHex(16), adminId, action, targetId ?? null, detail ?? null)
    .run();
}

// ----------------------------------------------- self-service password reset

async function handleRequestReset(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address' }, 400);

  // Always the same response so this cannot be used to discover accounts.
  const accepted = { ok: true, message: 'If that account exists, a reset link is on its way.' };

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
  if (!user) return json(accepted);

  const result = await issueResetLink(env, user, request);

  // Tell staff someone is locked out. The address is included because staff
  // need to know who to help; this inbox is only visible to staff accounts.
  await notify(env, {
    userIds: await staffIds(env),
    kind: 'password_reset_request',
    title: 'Password reset requested',
    body: `${user.email} requested a password reset link.`,
    link: '/kaedeentrans',
    actor: user.email,
  });

  return json({
    ...accepted,
    delivery: result.emailed ? 'email' : 'unavailable',
    deliveryReason: result.emailed ? undefined : result.reason,
    ...(result.emailed ? {} : { resetUrl: result.resetUrl }),
  });
}

async function handleResetPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const token = String(body.token ?? '');
  const password = String(body.password ?? '');
  if (!token) return json({ error: 'Missing reset token' }, 400);
  if (!validPassword(password)) return json({ error: 'Password must be at least 8 characters' }, 400);

  const tokenHash = await hashResetToken(token);
  const row = await env.DB.prepare(
    'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first();

  if (!row) return json({ error: 'This reset link is not valid' }, 400);
  if (row.used_at) return json({ error: 'This reset link has already been used' }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: 'This reset link has expired. Request a new one.' }, 400);
  }

  const salt = randomSalt();
  const hash = await hashPassword(password, salt);

  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, password_fingerprint = ? WHERE id = ?',
  )
    .bind(hash, salt, await passwordFingerprint(password), row.user_id)
    .run();

  // Burn the token so a leaked link cannot be replayed.
  await env.DB.prepare(
    "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?",
  )
    .bind(row.id)
    .run();

  return json({ ok: true });
}

// ------------------------------------------------------ announcements & inbox

async function notify(env, { userIds, kind, title, body, link, actor }) {
  if (!userIds.length) return 0;
  const stmt = env.DB.prepare(
    'INSERT INTO notifications (id, user_id, kind, title, body, link, actor) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const batch = userIds.map((uid) =>
    stmt.bind(randomHex(16), uid, kind, title, body ?? null, link ?? null, actor ?? null),
  );
  await env.DB.batch(batch);
  return userIds.length;
}

async function staffIds(env) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('admin','moderator')",
  ).all();
  return results.map((r) => r.id);
}

async function allUserIds(env) {
  const { results } = await env.DB.prepare('SELECT id FROM users').all();
  return results.map((r) => r.id);
}

function shapeAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    authorEmail: row.author_email,
    audience: row.audience,
    pinned: Boolean(row.pinned),
    edited: Boolean(row.edited),
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

/** Staff-only (admins and moderators) can post. */
async function handleListAnnouncements(request, env) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    'SELECT * FROM announcements ORDER BY pinned DESC, published_at DESC LIMIT 100',
  ).all();

  return json({ announcements: results.map(shapeAnnouncement) });
}

async function handleCreateAnnouncement(request, env) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const title = String(body.title ?? '').trim();
  const text = String(body.body ?? '').trim();
  if (!title) return json({ error: 'A title is required' }, 400);
  if (!text) return json({ error: 'Write something in the body' }, 400);
  if (title.length > 140) return json({ error: 'Title is too long' }, 400);
  if (text.length > 5000) return json({ error: 'Body is too long' }, 400);

  // 'staff' posts only notify staff; 'all' also notifies regular users.
  const audience = body.audience === 'staff' ? 'staff' : 'all';
  const id = randomHex(16);

  await env.DB.prepare(
    `INSERT INTO announcements (id, title, body, author_id, author_email, audience, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      title,
      text,
      auth.user.id,
      auth.user.email,
      audience,
      body.pinned ? 1 : 0,
    )
    .run();

  await logAdminAction(env, auth.user.id, 'announcement.create', id, title);

  const targets = audience === 'staff' ? await staffIds(env) : await allUserIds(env);
  await notify(env, {
    userIds: targets,
    kind: 'announcement',
    title,
    body: text.slice(0, 140),
    link: '/announcements',
    actor: auth.user.email,
  });

  const row = await env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(id).first();
  return json({ announcement: shapeAnnouncement(row), notified: targets.length }, 201);
}

/** Author or admin can edit. Mirrors the delete rule. */
async function handleUpdateAnnouncement(request, env, id) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  const row = await env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Announcement not found' }, 404);

  const isAuthor = row.author_id === auth.user.id;
  if (!isAuthor && auth.user.role !== 'admin') {
    return json({ error: 'You can only edit your own announcements' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const title = body.title === undefined ? row.title : String(body.title).trim();
  const text = body.body === undefined ? row.body : String(body.body).trim();
  const audience = body.audience === undefined ? row.audience : body.audience === 'staff' ? 'staff' : 'all';
  const pinned = body.pinned === undefined ? row.pinned : body.pinned ? 1 : 0;

  if (!title) return json({ error: 'A title is required' }, 400);
  if (!text) return json({ error: 'Write something in the body' }, 400);
  if (title.length > 140) return json({ error: 'Title is too long' }, 400);
  if (text.length > 5000) return json({ error: 'Body is too long' }, 400);

  await env.DB.prepare(
    `UPDATE announcements SET title = ?, body = ?, audience = ?, pinned = ?,
     edited = 1, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(title, text, audience, pinned, id)
    .run();

  await logAdminAction(env, auth.user.id, 'announcement.update', id, title);

  const updated = await env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(id).first();
  return json({ announcement: shapeAnnouncement(updated) });
}

async function handleDeleteAnnouncement(request, env, id) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  const row = await env.DB.prepare('SELECT * FROM announcements WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Announcement not found' }, 404);

  // Authors may remove their own; only admins can remove anyone's.
  const isAuthor = row.author_id === auth.user.id;
  if (!isAuthor && auth.user.role !== 'admin') {
    return json({ error: 'You can only delete your own announcements' }, 403);
  }

  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  await logAdminAction(env, auth.user.id, 'announcement.delete', id, row.title);

  return json({ ok: true });
}

/** Any signed-in user can read the announcements aimed at them. */
async function handleListPublicAnnouncements(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const isStaff = STAFF_ROLES.includes(user.role);
  const { results } = await env.DB.prepare(
    `SELECT * FROM announcements
     WHERE audience = 'all' ${isStaff ? "OR audience = 'staff'" : ''}
     ORDER BY pinned DESC, published_at DESC LIMIT 50`,
  ).all();

  return json({ announcements: results.map(shapeAnnouncement) });
}

async function handleListNotifications(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
  )
    .bind(user.id)
    .all();

  return json({
    notifications: results.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      actor: n.actor,
      readAt: n.read_at,
      createdAt: n.created_at,
    })),
    unread: results.filter((n) => !n.read_at).length,
  });
}

async function handleMarkRead(request, env, id) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  await env.DB.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL",
  )
    .bind(id, user.id)
    .run();

  return json({ ok: true });
}

async function handleMarkAllRead(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  await env.DB.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL",
  )
    .bind(user.id)
    .run();

  return json({ ok: true });
}

/**
 * Admin-only activity dashboard. Moderators are intentionally excluded: this
 * aggregates every account, not just the ones they help with.
 */
async function handleDashboard(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    'SELECT id, email, role, created_at, last_seen_at FROM users ORDER BY created_at ASC',
  ).all();

  const counts = { total: 0, online: 0, active: 0, idle: 0, offline: 0, never: 0 };
  const enriched = results.map((u) => {
    const days = daysSince(u.last_seen_at);
    const presence = presenceOf(days);
    counts.total += 1;
    counts[presence] += 1;
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      daysOffline: days,
      presence,
      isOwner: ownerEmails(env).includes(u.email.toLowerCase()),
    };
  });

  const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const since7 = dayAgo(ACTIVE_DAYS);
  const since30 = dayAgo(IDLE_DAYS);

    // Returns: a gap of RETURN_AFTER_DAYS or more between consecutive active
    // days, with activity in the recent window.
  const { results: activityRows } = await env.DB.prepare(
    `SELECT user_id, day FROM user_activity_days
     WHERE user_id IN (SELECT id FROM users)
     ORDER BY user_id, day`,
  ).all();

  const byUser = new Map();
  for (const row of activityRows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row.day);
  }

  const dayMs = 86400000;
  const todayUtc = Date.now();
  const returning = [];

  for (const u of enriched) {
    const days = byUser.get(u.id);
    if (!days || days.length < 2) continue;

    for (let i = days.length - 1; i > 0; i--) {
      const prev = Date.parse(`${days[i - 1]}T00:00:00Z`);
      const curr = Date.parse(`${days[i]}T00:00:00Z`);
      if (Number.isNaN(prev) || Number.isNaN(curr)) continue;
      const gap = Math.round((curr - prev) / dayMs);
      if (gap < RETURN_AFTER_DAYS) continue;

      // Only "current" returns: the reappearance must itself be recent.
      const returnedMs = Date.parse(`${days[i]}T00:00:00Z`);
      const daysSinceReturn = Math.floor((todayUtc - returnedMs) / dayMs);
      if (daysSinceReturn > ACTIVE_DAYS) continue;

      returning.push({
        id: u.id,
        email: u.email,
        role: u.role,
        gapDays: gap,
        returnedOn: days[i],
        daysSinceReturn,
      });
      break; // most recent qualifying gap
    }
  }
  returning.sort((a, b) => b.gapDays - a.gapDays);

  const library = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM titles) AS titles,
            (SELECT COUNT(*) FROM watchlist) AS watchlist,
            (SELECT COUNT(*) FROM playback_records) AS playback,
            (SELECT COUNT(*) FROM announcements) AS announcements,
            (SELECT COUNT(*) FROM notifications WHERE read_at IS NULL) AS unread`,
  ).first();

  const newThisWeek = enriched.filter((u) => (u.createdAt || '') >= since7).length;
  const newThisMonth = enriched.filter((u) => (u.createdAt || '') >= since30).length;

  return json({
    generatedAt: new Date().toISOString(),
    counts,
    totals: {
      newThisWeek,
      newThisMonth,
      titles: library?.titles ?? 0,
      watchlist: library?.watchlist ?? 0,
      playback: library?.playback ?? 0,
      announcements: library?.announcements ?? 0,
      unreadNotifications: library?.unread ?? 0,
    },
    // Most-recently-active first: this is what you act on.
    mostActive: [...enriched]
      .filter((u) => u.lastSeenAt)
      .sort((a, b) => new Date(a.lastSeenAt) - new Date(b.lastSeenAt))
      .slice(0, 8),
    needsAttention: enriched
      .filter((u) => u.presence === 'offline' || u.presence === 'never')
      .sort((a, b) => (b.daysOffline ?? 99999) - (a.daysOffline ?? 99999))
      .slice(0, 10),
    recentSignups: [...enriched].reverse().slice(0, 8),
    returning,
    autoReturnNotifications: await settingOn(env, 'auto_return_notifications', true),
    thresholds: { activeDays: ACTIVE_DAYS, idleDays: IDLE_DAYS, returnAfterDays: RETURN_AFTER_DAYS },
  });
}

/**
 * Manual targeted notification. Staff pick specific accounts by id or email;
 * duplicates are collapsed and unknown targets are reported back rather than
 * silently dropped.
 */
async function handleSendNotification(request, env) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const title = String(body.title ?? '').trim();
  const text = String(body.body ?? '').trim();
  const link = typeof body.link === 'string' ? body.link.slice(0, 200) : null;
  const target = body.target || 'all'; // all | staff | users | ids

  if (!title) return json({ error: 'A title is required' }, 400);
  if (title.length > 140) return json({ error: 'Title is too long' }, 400);
  if (!text) return json({ error: 'Write a message' }, 400);
  if (text.length > 2000) return json({ error: 'Message is too long' }, 400);
  if (link && !link.startsWith('/')) return json({ error: 'Link must be a path like /announcements' }, 400);

  let targets = [];
  if (target === 'ids') {
    const raw = Array.isArray(body.userIds) ? body.userIds : [];
    const emails = Array.isArray(body.emails) ? body.emails : [];
    if (!raw.length && !emails.length) {
      return json({ error: 'Pick at least one recipient' }, 400);
    }

    const conditions = [];
    const binds = [];
    for (const id of raw.map(String).slice(0, 500)) {
      conditions.push('id = ?');
      binds.push(id);
    }
    for (const em of emails.map((e) => String(e).trim().toLowerCase()).slice(0, 500)) {
      conditions.push('email = ?');
      binds.push(em);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, email FROM users WHERE ${conditions.join(' OR ')}`,
    )
      .bind(...binds)
      .all();
    targets = results;

    const found = new Set(results.map((r) => r.email));
    const missing = emails.map((e) => String(e).trim().toLowerCase()).filter((e) => !found.has(e));
    if (missing.length) {
      return json({ error: `No account for: ${missing.slice(0, 5).join(', ')}` }, 400);
    }
  } else if (target === 'staff') {
    targets = await staffRows(env);
  } else if (target === 'users') {
    targets = await userRows(env, "role = 'user'");
  } else {
    targets = await userRows(env, '1=1');
  }

  if (!targets.length) return json({ error: 'That audience has no accounts' }, 400);

  const count = await notify(env, {
    userIds: targets.map((t) => t.id),
    kind: 'direct',
    title,
    body: text,
    link,
    actor: auth.user.email,
  });

  await logAdminAction(
    env,
    auth.user.id,
    'notification.send',
    null,
    `${target}:${count}`,
  );

  return json({
    ok: true,
    notified: count,
    audience: target,
    recipients: targets.slice(0, 50).map((t) => t.email),
  });
}

async function staffRows(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, email FROM users WHERE role IN ('admin','moderator')",
  ).all();
  return results;
}

async function userRows(env, where) {
  const { results } = await env.DB.prepare(`SELECT id, email FROM users WHERE ${where}`).all();
  return results;
}

async function handleGetSettings(request, env) {
  const auth = await requireStaff(request, env);
  if (auth.error) return auth.error;
  return json({
    autoReturnNotifications: await settingOn(env, 'auto_return_notifications', true),
    returnAfterDays: RETURN_AFTER_DAYS,
  });
}

async function handleUpdateSettings(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.autoReturnNotifications === 'boolean') {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind('auto_return_notifications', body.autoReturnNotifications ? 'on' : 'off')
      .run();
  }

  return handleGetSettings(request, env);
}

// ---------------------------------------------------------------- router

export async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const seg = path.split('/').filter(Boolean); // ['api', ...]

  try {
    if (seg[1] === 'auth') {
      if (seg[2] === 'signup' && method === 'POST') return handleSignup(request, env);
      if (seg[2] === 'login' && method === 'POST') return handleLogin(request, env);
      if (seg[2] === 'logout' && method === 'POST') return handleLogout(request, env);
      if (seg[2] === 'me' && method === 'GET') return handleMe(request, env);
      if (seg[2] === 'request-reset' && method === 'POST') return handleRequestReset(request, env);
      if (seg[2] === 'reset-password' && method === 'POST') return handleResetPassword(request, env);
    }

    if (seg[1] === 'admin') {
      if (seg[2] === 'dashboard' && seg.length === 3 && method === 'GET') {
        return handleDashboard(request, env);
      }
      // /api/admin/users                      GET  | POST
      // /api/admin/users/:id                   DELETE
      // /api/admin/users/:id/role              POST
      // /api/admin/users/:id/password          POST
      if (seg[2] === 'users' && seg.length === 3 && method === 'GET') {
        return handleListUsers(request, env);
      }
      if (seg[2] === 'users' && seg.length === 3 && method === 'POST') {
        return handleCreateUser(request, env);
      }
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'role' && method === 'POST') {
        return handleSetRole(request, env, seg[3]);
      }
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'password' && method === 'POST') {
        return handleAdminResetPassword(request, env, seg[3]);
      }
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'reset-link' && method === 'POST') {
        return handleAdminSendResetLink(request, env, seg[3]);
      }
      if (seg[2] === 'users' && seg.length === 4 && method === 'DELETE') {
        return handleDeleteUser(request, env, seg[3]);
      }
    }

    if (seg[1] === 'titles') {
      if (seg.length === 2 && method === 'GET') return handleListTitles(request, env, url);
      if (seg.length === 3 && method === 'GET') return handleGetTitle(request, env, url, seg[2]);
      if (seg.length === 2 && method === 'POST') return handleCreateTitle(request, env);
      if (seg.length === 3 && method === 'PUT') return handleUpdateTitle(request, env, seg[2]);
      if (seg.length === 3 && method === 'DELETE') return handleDeleteTitle(request, env, seg[2]);
    }

    if (seg[1] === 'watchlist') {
      if (seg.length === 2 && method === 'GET') return handleGetWatchlist(request, env);
      if (seg.length === 2 && method === 'POST') return handleAddWatchlist(request, env);
      if (seg.length === 3 && method === 'DELETE') return handleRemoveWatchlist(request, env, seg[2]);
    }

    if (seg[1] === 'playback') {
      if (seg[2] === 'start' && method === 'POST') return handlePlaybackStart(request, env);
      if (seg[2] === 'continue' && method === 'GET') return handleContinueWatching(request, env);
    }

    if (seg[1] === 'settings') {
      if (seg.length === 2 && method === 'GET') return handleGetSettings(request, env);
      if (seg.length === 2 && method === 'PUT') return handleUpdateSettings(request, env);
    }

    if (seg[1] === 'notifications') {
      if (seg.length === 2 && method === 'GET') return handleListNotifications(request, env);
      if (seg.length === 2 && method === 'POST') return handleMarkAllRead(request, env);
      if (seg.length === 3 && method === 'POST') return handleMarkRead(request, env, seg[2]);
    }

    if (seg[1] === 'admin' && seg[2] === 'send') {
      if (seg.length === 3 && method === 'POST') return handleSendNotification(request, env);
    }

    if (seg[1] === 'announcements') {
      if (seg.length === 2 && method === 'GET') return handleListPublicAnnouncements(request, env);
      if (seg.length === 3 && seg[2] === 'staff' && method === 'GET') {
        return handleListAnnouncements(request, env);
      }
      if (seg.length === 3 && seg[2] === 'staff' && method === 'POST') {
        return handleCreateAnnouncement(request, env);
      }
      if (seg.length === 3 && method === 'DELETE') {
        return handleDeleteAnnouncement(request, env, seg[2]);
      }
      if (seg.length === 3 && (method === 'PUT' || method === 'PATCH')) {
        return handleUpdateAnnouncement(request, env, seg[2]);
      }
    }

    if (seg[1] === 'health' && method === 'GET') return json({ ok: true, ts: Date.now() });

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500);
  }
}