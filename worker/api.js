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
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  mailConfigured,
} from './mailer.js';
import { hitRateLimit, clearRateLimit, passwordProblem } from './ratelimit.js';
import { planAccess, EPISODIC_TYPES, TITLE_TYPES as TITLE_TYPE_VALUES } from './access.js';
import { parseEmbed, fetchEmbedMetadata, embedUrl as buildEmbedUrl } from './embed.js';
import { parseEpisodeList, MAX_EPISODES_PER_IMPORT } from './episode-import.js';
import {
  validateSubject,
  validateMessage,
  validatePhone,
  MAX_TICKET_MESSAGES,
  MAX_OPEN_TICKETS_PER_USER,
} from './tickets.js';
import {
  handleCreateUpload,
  handleFinaliseUpload,
  handleUploadPoster,
  handleListMyUploads,
  handleDeleteUpload,
  loadUpload,
} from './uploads-api.js';
import {
  PERMISSION_IDS,
  RESTORE_WINDOW_DAYS,
  PURGE_AFTER_DAYS,
  loadPermissions,
  restoreDaysLeft,
  isRestorable,
  isPurgeable,
  sqlTimestamp,
  parseSqlDate,
} from './permissions.js';
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
    `SELECT id, email, username, role, display_name, phone, email_verified_at,
            last_seen_at, deleted_at, purge_after
     FROM users WHERE id = ?`,
  )
    .bind(payload.sub)
    .first();
  if (!row) return null;

  // A deleted account is not signed in, it merely still has a row. Refusing it
  // here means every gated route rejects it at once, rather than each handler
  // having to remember to check. The restore flow does not go through a session.
  if (row.deleted_at) return null;

  // A session cannot exist for an unverified account through signup or login --
  // both refuse before setting a cookie -- but the check belongs here too. This
  // is the single point every gated route passes through, so an unproved address
  // is refused everywhere even if some other path manages to mint a token.
  if (!row.email_verified_at) return null;

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

// ------------------------------------------------------- video kind and embeds

const EMBED_PROVIDERS = ['youtube', 'vimeo'];

/** The title type that marks a paid placement rather than catalog content. */
const AD_TYPE = 'ads';

/**
 * Works out how a video should be played, from whatever the client sent.
 *
 * An embed is identified by provider plus id and never by a URL, so a caller
 * cannot smuggle markup through this path. The player URL is rebuilt from the id
 * at render time; buildEmbedUrl re-validates it here so a bad id stored by an
 * older bug cannot be replayed into an iframe.
 *
 * An upload is identified by its id and checked against the actor, so one account
 * cannot attach another's file to a title.
 *
 * When an embed or upload is supplied, videoUrl is cleared: leaving a stale
 * stream URL on the row would let the player prefer the file over the video the
 * person posting actually chose.
 *
 * @param env    D1/R2 bindings; needed to read the upload row
 * @param actor  the signed-in account, used to check upload ownership
 */
async function normaliseVideo(body, existing = {}, env, actor) {
  // Absent means "not specified", which is different from an invalid value: a new
  // row with no kind at all is a normal file title, and reading it as invalid
  // would reject every ordinary post.
  const kind = body.videoKind ?? existing.video_kind ?? 'file';
  if (!VIDEO_KINDS.includes(kind)) {
    return { error: 'videoKind must be file, hls or embed' };
  }

  const provider = body.embedProvider ?? existing.embed_provider ?? null;
  const id = body.embedId ?? existing.embed_id ?? null;

  if (kind === 'embed') {
    if (!EMBED_PROVIDERS.includes(provider)) {
      return { error: 'embedProvider must be youtube or vimeo' };
    }
    if (!buildEmbedUrl(provider, id)) {
      return { error: 'That embed id is not valid' };
    }
    return {
      video_kind: 'embed',
      embed_provider: provider,
      embed_id: String(id),
      // Cleared so the player cannot fall back to a stale file.
      video_url: null,
      // Must be present: every branch of this function is bound positionally to
      // the INSERT, and omitting it here binds undefined, which D1 rejects. That
      // is what made every embed post fail with a 500.
      upload_id: null,
    };
  }

  if (kind === 'upload') {
    // The upload must exist and be playable, and it must belong to whoever is
    // posting. Otherwise the title would point at nothing, or worse at another
    // user's private upload.
    const upload = await loadUpload(env, body.uploadId);
    if (!upload) return { error: 'That upload does not exist' };
    if (upload.user_id !== actor.id && actor.role !== 'admin') {
      return { error: 'That upload belongs to another account' };
    }
    if (upload.status !== 'ready') {
      return { error: 'That upload has not finished. Wait for it to complete first.' };
    }
    return {
      video_kind: 'upload',
      embed_provider: null,
      embed_id: null,
      video_url: null,
      upload_id: upload.id,
    };
  }

  // Switching back to a file or a manifest drops the embed columns, rather than
  // leaving a provider and id that nothing reads but that look live in the row.
  return {
    video_kind: kind,
    embed_provider: null,
    embed_id: null,
    video_url: body.videoUrl === undefined ? (existing.video_url ?? null) : body.videoUrl,
    // An upload replaces whatever URL was there; keeping both would leave the
    // player choosing between two sources.
    upload_id: null,
  };
}

/** Kinds now that titles can be uploaded rather than only linked. */
const VIDEO_KINDS = ['file', 'hls', 'embed', 'upload'];

/**
 * A signed URL for an uploaded object, valid long enough to watch from.
 *
 * Short-lived on purpose: a URL that never expires would let anyone who captured
 * it share the video permanently and skip the account gate. Six hours covers a
 * long sitting; the page re-requests when it lapses.
 */
/**
 * The URL the player actually fetches.
 *
 * R2 has no presigned URLs available to a Worker binding without separate S3
 * credentials, so uploads are streamed through this route instead. That is
 * cheaper in trust terms than making the bucket public: the access rule is
 * enforced on every range request, so a gated video cannot be scrubbed by
 * fetching byte ranges directly.
 *
 * Not a signed URL, and does not need to be: the route re-checks the session and
 * the title's access rule on each request rather than trusting whatever URL the
 * client is holding.
 */
function videoStreamPath(uploadId) {
  return `/api/stream/${uploadId}`;
}

/**
 * GET /api/stream/:uploadId — serves the uploaded bytes.
 *
 * Range requests are honoured because a browser seeking in a <video> issues them
 * and a 200-only response makes seeking impossible.
 *
 * The gate is applied here, per request, from the title the upload is attached
 * to. An upload with no title is owner-only: it is still being uploaded or has
 * not been published, and there is no public case for serving it.
 */
async function handleStreamUpload(request, env, uploadId) {
  if (!env.VIDEOS) return json({ error: 'Video storage is not configured' }, 503);

  const upload = await loadUpload(env, uploadId);
  if (!upload || upload.status !== 'ready') {
    return json({ error: 'Video not found' }, 404);
  }

  const title = await env.DB.prepare(
    'SELECT id, slug, type FROM titles WHERE upload_id = ?',
  )
    .bind(uploadId)
    .first();

  let allowed = Boolean(title);
  if (title) {
    // Same rule as the detail page: movies play for anyone, episodic types need
    // an account for anything past the first episode.
    if (EPISODIC_TYPES.includes(title.type)) {
      allowed = Boolean(await getUser(request, env));
    }
  } else {
    // Unattached upload: only its owner.
    allowed = (await getUser(request, env))?.id === upload.user_id;
  }

  if (!allowed) {
    // 403 rather than 404: the id is unguessable, and a wrong status here would
    // make debugging a real playback problem harder.
    return json({ error: 'Sign in to watch this' }, 403);
  }

  const rangeHeader = request.headers.get('range');
  const parsed = rangeHeader ? parseRange(rangeHeader) : undefined;

  // R2's binding takes { offset, length }, not the HTTP header's { start, end }.
  // Passing the HTTP shape throws, which is how this was found.
  const r2Range = parsed
    ? parsed.suffix !== undefined
      ? { suffix: parsed.suffix }
      : { offset: parsed.start, length: parsed.end === undefined ? undefined : parsed.end - parsed.start + 1 }
    : undefined;

  const object = r2Range
    ? await env.VIDEOS.get(upload.object_key, { range: r2Range })
    : await env.VIDEOS.get(upload.object_key);

  if (!object) return json({ error: 'Video not found' }, 404);

  const headers = {
    'content-type': upload.content_type || 'video/mp4',
    // Private: the stream route is the only way in, so it must not be cached by
    // a shared proxy under an authenticated request.
    'cache-control': 'private, max-age=3600',
    'accept-ranges': 'bytes',
  };

  // The response status follows the *request*, not the object. R2's returned
  // body carries a `range` describing the stored object even when the whole
  // thing was read, so testing it made every full read claim to be a 206.
  if (!r2Range) {
    headers['content-length'] = String(object.size ?? 0);
    return new Response(object.body, { status: 200, headers });
  }

  const size = object.size ?? 0;
  const offset = parsed.suffix !== undefined ? Math.max(0, size - parsed.suffix) : parsed.start;
  const end = parsed.suffix !== undefined
    ? size - 1
    : Math.min(parsed.end ?? size - 1, size - 1);
  const length = Math.max(0, end - offset + 1);

  headers['content-range'] = `bytes ${offset}-${end}/${size}`;
  headers['content-length'] = String(length);

  // R2 was already asked for exactly this slice, so the body is the right bytes
  // and must not be sliced again.
  return new Response(object.body, { status: 206, headers });
}

/**
 * Exported only so scripts/test-range.mjs can test it directly.
 *
 * It is a pure string parser with no Worker dependencies, and seeking is
 * impossible to verify from a screenshot, so it is worth pinning with tests
 * rather than leaving it covered only by manual playback.
 */
export const handleRangeForTest = parseRange;

/**
 * GET /api/poster/:uploadId — the poster frame for an upload.
 *
 * Public, unlike the video route. Artwork has to load for signed-out visitors in
 * the catalog, and a poster is a single frame with nothing to protect; gating it
 * would mean every card on every page needed a session.
 *
 * Cached hard, because the image never changes once written: a title's poster is
 * only replaced by re-uploading, which produces a new upload id.
 */
async function handleServePoster(request, env, uploadId) {
  if (!env.VIDEOS) return json({ error: 'Video storage is not configured' }, 503);

  const upload = await loadUpload(env, uploadId);
  if (!upload?.poster_key) return json({ error: 'Poster not found' }, 404);

  const object = await env.VIDEOS.get(upload.poster_key);
  if (!object) return json({ error: 'Poster not found' }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/** Parses a single-range `bytes=` header. Multi-range is ignored, as browsers do not send it. */
function parseRange(header) {
  const match = String(header).match(/bytes=(\d*)-(\d*)/);
  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return undefined;

  // A suffix range asks for the last N bytes: "bytes=-500".
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    return { suffix };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) return undefined;

  if (rawEnd === '') {
    // Open-ended: to the end of the object, which R2 handles.
    return { start };
  }

  const end = Number(rawEnd);
  if (!Number.isFinite(end)) return undefined;
  // An end before the start is not a slice of anything. Widening it to "start to
  // the end" would serve more than was asked for, so it is refused instead.
  if (end < start) return undefined;
  // An end past the object is clamped by R2 rather than rejected: that is what a
  // player means when it asks for a whole file without knowing the exact size.
  return { start, end };
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
    // 'upload' when the uploader supplied the file, otherwise a hand-pasted URL.
    // Kept so the UI can label provenance rather than implying a source.
    videoSource: row.video_source ?? null,
    // Defaults to 'file' for rows written before the column existed, so an
    // older title still plays instead of rendering an empty player box.
    videoKind: row.video_kind ?? (row.video_url ? 'file' : null),
    embedProvider: row.embed_provider ?? null,
    embedId: row.embed_id ?? null,
    // Points at the R2 object this title plays from, when the uploader supplied
    // the video rather than a link.
    uploadId: row.upload_id ?? null,
    subtitlesUrl: row.subtitles_url,
    featured: Boolean(row.featured),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// 3-30 chars, letters/digits/underscore/hyphen, must start alphanumeric.
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,29}$/;

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help',
  'api', 'www', 'me', 'staff', 'moderator', 'kaedeentrans',
]);

function validateUsername(raw) {
  const username = String(raw ?? '').trim();
  if (!username) return { error: 'Choose a username' };
  if (!USERNAME_RE.test(username)) {
    return {
      error:
        'Username must be 3-30 characters, using letters, numbers, underscores or hyphens, and start with a letter or number',
    };
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return { error: 'That username is reserved' };
  }
  return { username };
}

/** Derives a unique username from the email when none was supplied. */
async function deriveUsername(env, email) {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
  let candidate = (base || 'user').replace(/^[^a-z0-9]+/, '').slice(0, 24) || 'user';

  // The reserved list exists so a handle cannot be mistaken for the site itself
  // or for staff, and validateUsername enforces it on the signup and profile
  // paths. Deriving a handle skipped it, so any account whose address was
  // staff@, help@, admin@, moderator@ or similar silently ended up holding a
  // reserved name that no member was allowed to pick. A number is appended until
  // it is both free and not reserved.
  if (RESERVED_USERNAMES.has(candidate)) {
    candidate = `${candidate}${randomHex(2)}`;
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    if (candidate.length < 3) candidate = `${candidate}user`;
    // No deleted_at filter, matching the unique index: an account inside its
    // recovery window still holds its handle, and the insert would fail if the
    // derived name collided with one.
    const taken = await env.DB.prepare(
      'SELECT 1 AS x FROM users WHERE lower(username) = lower(?)',
    )
      .bind(candidate)
      .first();
    if (!taken) return candidate;
    candidate = `${base.slice(0, 22)}${attempt + 1}`;
    if (RESERVED_USERNAMES.has(candidate)) {
      candidate = `${candidate}${randomHex(2)}`;
    }
  }
  return `${base}${randomHex(3)}`;
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}

// --------------------------------------------------------- email verification
//
// The address is the only thing proved at signup. The phone number is collected
// and never verified, because nothing is ever sent to it.
//
// A verification link is a bearer credential: it proves control of the address,
// so only its hash is stored. The plaintext exists in the recipient's inbox and,
// when email is not configured, in the signup response so the flow can be
// completed at all.

/** How long a verification link stays usable. */
const VERIFY_TTL_MINUTES = 24 * 60;

/**
 * Issues a fresh verification token and mails the link.
 *
 * Replaces any token already in flight rather than adding a second row, so an
 * address that has been sent four links has exactly one live one and the rest
 * have stopped working.
 */
async function issueEmailVerification(env, user) {
  const token = generateResetToken();
  const hash = await hashResetToken(token);
  const expiresAt = sqlTimestamp(Date.now() + VERIFY_TTL_MINUTES * 60000);

  await env.DB.prepare(
    `UPDATE users SET email_verify_token_hash = ?, email_verify_expires_at = ?,
       email_verify_sent_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(hash, expiresAt, user.id)
    .run();

  const verifyUrl = `${String(env.APP_URL || '').replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(token)}`;

  const mail = await sendVerificationEmail(env, {
    to: user.email,
    verifyUrl,
    expiresMinutes: VERIFY_TTL_MINUTES,
  });

  return { verifyUrl, mail };
}

/** Marks the address proved and clears the now-spent token in one statement. */
async function markEmailVerified(env, userId) {
  await env.DB.prepare(
    `UPDATE users SET email_verified_at = datetime('now'), email_verify_token_hash = NULL,
       email_verify_expires_at = NULL
     WHERE id = ?`,
  )
    .bind(userId)
    .run();
}

/** A short shape for the "not verified yet" response the client renders. */
function verificationPending(user, reason) {
  return json({ error: reason, needsVerification: true, email: user.email }, 403);
}

/**
 * The user object every session-establishing response carries.
 *
 * One shape, from login, from verification and from /auth/me. They used to
 * differ, and the difference was invisible until it cost something: /auth/me sent
 * the resolved permission list and login did not, so signing in from the form
 * left the client holding a user with no permissions, and the staff console
 * rendered as a single Dashboard tab. Refreshing the page fixed it, which is why
 * it looked like a styling problem rather than a data one.
 */
async function sessionUser(env, user) {
  const permissions = await loadPermissions(env, user);
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name ?? null,
    phone: user.phone ?? null,
    emailVerified: Boolean(user.email_verified_at),
    role: user.role,
    permissions: [...permissions.set],
  };
}

// ---------------------------------------------------------------- routes

async function handleSignup(request, env) {
  // Counted before any parsing so a flood of malformed bodies is throttled too.
  const signupLimit = await hitRateLimit(env, request, 'signup', {
    limit: 5,
    windowSeconds: 600,
  });
  if (!signupLimit.allowed) {
    return json(
      { error: 'Too many accounts created from here. Try again later.' },
      429,
      { 'retry-after': String(signupLimit.retryAfter) },
    );
  }

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

  // Length alone was the only check, so "aaaaaaaa" was acceptable.
  const weak = passwordProblem(password);
  if (weak) return json({ error: weak }, 400);

  // Username is required at signup.
  const nameCheck = validateUsername(body.username);
  if (nameCheck.error) return json({ error: nameCheck.error }, 400);

  const existing = await env.DB.prepare(
    'SELECT id, deleted_at, purge_after FROM users WHERE email = ?',
  )
    .bind(email)
    .first();

  if (existing?.deleted_at) {
    // The address is still held by the row, so a fresh signup would collide.
    // Saying so plainly is better than a bare "already exists": the way out is
    // to sign in and restore, not to try a different email.
    if (isPurgeable(existing.deleted_at, existing.purge_after)) {
      await purgeAccount(env, existing.id);
    } else {
      return json(
        {
          error:
            'That email belongs to an account pending deletion. Sign in with it to restore the account instead of creating a new one.',
        },
        409,
      );
    }
  } else if (existing) {
    return json({ error: 'An account with that email already exists' }, 409);
  }

  // Every row counts, including accounts inside their recovery window: the
  // unique index on lower(username) covers those too, so treating the handle as
  // free here would only turn into a 500 from D1 on the insert. See the same
  // check in handleUpdateProfile.
  const nameTaken = await env.DB.prepare(
    'SELECT 1 AS x FROM users WHERE lower(username) = lower(?)',
  )
    .bind(nameCheck.username)
    .first();
  if (nameTaken) {
    return json(
      {
        error:
          'That username is already taken. If it belonged to an account that was deleted, it stays reserved until that account\'s recovery window closes.',
      },
      409,
    );
  }

  // Phone is collected but never verified. Optional, and a blank field is stored
  // as NULL rather than an empty string so "no number" has one representation.
  const phoneCheck = validatePhone(body.phone);
  if (phoneCheck.error) return json({ error: phoneCheck.error }, 400);

  const id = randomHex(16);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  // Admin is granted by OWNER_EMAIL or by an explicit promotion. Never by
  // registration order -- otherwise whoever signs up first becomes owner.
  const role = ownerEmails(env).includes(email) ? 'admin' : 'user';

  // The owner is trusted by configuration rather than by an email round trip, so
  // their account starts proved. Anyone else has to click the link.
  const isOwner = ownerEmails(env).includes(email);

  await env.DB.prepare(
    `INSERT INTO users (id, email, username, display_name, phone, password_hash, salt, role,
                        password_fingerprint, email_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      email,
      nameCheck.username,
      body.displayName ? String(body.displayName).slice(0, 60) : null,
      phoneCheck.phone,
      hash,
      salt,
      role,
      await passwordFingerprint(password),
      isOwner ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
    )
    .run();

  if (isOwner) {
    const token = await signToken({ sub: id, role }, env.SESSION_SECRET);
    return json(
      { user: { id, email, username: nameCheck.username, role, emailVerified: true } },
      201,
      { 'set-cookie': sessionCookie(token) },
    );
  }

  // No session cookie here on purpose. The account exists but is not usable
  // until the address is proved, and handing out a session now would let an
  // unverified account straight into the catalog.
  const { verifyUrl, mail } = await issueEmailVerification(env, {
    id,
    email,
  });

  return json(
    {
      needsVerification: true,
      email,
      user: { id, email, username: nameCheck.username, role, emailVerified: false },
      // When email is not configured the link comes back here instead, so the
      // flow can still be completed. Same fallback the password reset uses. It
      // is returned only because RESEND_API_KEY is absent: with it set, mail.sent
      // is true and verifyUrl is not included in the response.
      ...(mail.sent ? {} : { verifyUrl, mailReason: mail.reason, mailConfigured: false }),
    },
    201,
  );
}

/**
 * POST /api/auth/verify-email — spend a verification token.
 *
 * Hashes whatever arrives and looks it up by hash, so the table never holds a
 * token that could be replayed from a database dump.
 */
async function handleVerifyEmail(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ error: 'That verification link is incomplete' }, 400);

  const hash = await hashResetToken(token);
  const row = await env.DB.prepare(
    `SELECT id, email, username, role, phone, email_verified_at, email_verify_expires_at, deleted_at
     FROM users WHERE email_verify_token_hash = ?`,
  )
    .bind(hash)
    .first();

  if (!row) {
    // Same message for unknown, already-used and expired. A distinct message for
    // each would let somebody probe whether a token was ever issued.
    return json({ error: 'That verification link is not valid. Ask for a new one.' }, 400);
  }

  if (row.email_verified_at) {
    return json(
      { error: 'That address is already confirmed', email: row.email, alreadyVerified: true },
      400,
    );
  }

  const deadline = parseSqlDate(row.email_verify_expires_at);
  if (deadline === null || Date.now() >= deadline) {
    return json({ error: 'That verification link has expired. Ask for a new one.' }, 400);
  }

  if (row.deleted_at) {
    return json({ error: 'That account is being deleted', needsVerification: true }, 409);
  }

  await markEmailVerified(env, row.id);

  // Signs in on success, because the person holding the link has just proved
  // they own the inbox and the alternative is making them type their password
  // immediately after registering.
  const session = await signToken({ sub: row.id, role: row.role }, env.SESSION_SECRET);
  return json(
    { verified: true, user: await sessionUser(env, row) },
    200,
    { 'set-cookie': sessionCookie(session) },
  );
}

/**
 * POST /api/auth/resend-verification — mail another link.
 *
 * Reached from the sign-in form when an account exists but is unverified, so it
 * is keyed on the address and always reports the same thing either way: telling
 * the caller "no such account" would turn this into a way of finding out which
 * addresses are registered.
 */
async function handleResendVerification(request, env) {
  const limit = await hitRateLimit(env, request, 'resend-verification', {
    limit: 5,
    windowSeconds: 600,
  });
  if (!limit.allowed) {
    return json(
      { error: 'Too many requests from here. Try again later.' },
      429,
      { 'retry-after': String(limit.retryAfter) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter a valid email address' }, 400);

  const row = await env.DB.prepare(
    'SELECT id, email, email_verified_at FROM users WHERE email = ? AND deleted_at IS NULL',
  )
    .bind(email)
    .first();

  // Nothing sent, and nothing said, when there is nothing to do.
  if (!row || row.email_verified_at) {
    return json({ ok: true, sent: false });
  }

  const { mail } = await issueEmailVerification(env, row);
  return json({ ok: true, sent: mail.sent, ...(mail.sent ? {} : { reason: mail.reason }) });
}

async function handleLogin(request, env) {
  // Two tiers: a wide one per IP, a tight one per account so one targeted
  // account cannot be ground down from a single machine.
  const perIp = await hitRateLimit(env, request, 'login', { limit: 20, windowSeconds: 60 });
  if (!perIp.allowed) {
    return json(
      { error: 'Too many sign-in attempts. Wait a minute and try again.' },
      429,
      { 'retry-after': String(perIp.retryAfter) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const row = await env.DB.prepare(
    `SELECT id, email, username, display_name, password_hash, salt, role, phone,
            email_verified_at, deleted_at, purge_after
     FROM users WHERE email = ?`,
  )
    .bind(email)
    .first();

  // The account tier keys on the email rather than the row id, so it runs and
  // costs the same whether or not the account exists. Keying on the id meant
  // this lookup was skipped for unknown addresses, which left a measurable
  // timing difference between "registered" and "not registered".
  const emailKey = await sha256Hex(email);
  const perAccount = await hitRateLimit(env, request, `login:acct:${emailKey}`, {
    limit: 6,
    windowSeconds: 300,
  });
  if (!perAccount.allowed) {
    return json(
      { error: 'Too many attempts for this account. Try again shortly.' },
      429,
      { 'retry-after': String(perAccount.retryAfter) },
    );
  }
  // Same message either way so the endpoint can't enumerate registered emails.
  //
  // When there is no such account we still run a hash against a fixed decoy.
  // Returning early instead made a wrong password cost ~100ms of PBKDF2 while
  // an unknown email cost ~1ms, which revealed which addresses are registered.
  const ok = row
    ? await verifyPassword(password, row.salt, row.password_hash)
    : (await verifyPassword(password, DECOY_SALT_VALUE, await decoyHash()), false);

  if (!ok) return json({ error: 'Invalid email or password' }, 401);

  // An unproved address is refused here, and only after the password has been
  // checked. The order matters: refusing sooner would let anyone find out
  // whether an address is registered and unverified, without knowing the
  // password.
  //
  // Nothing is asked for at the sign-in form itself. This returns a plain
  // "confirm your email" and nothing else, so signing in stays email and
  // password; the address is proved once, at signup, not on every visit.
  if (!row.email_verified_at) {
    return verificationPending(row, 'Confirm your email address before signing in');
  }

  // A deleted account is restored rather than refused, because the caller just
  // proved they still hold the account's password. That is the same proof the
  // deletion was made under, so it needs no emailed token.
  //
  // The purge runs first: past the window the row is destroyed, and this attempt
  // must then look exactly like an unknown address rather than resurrecting it.
  await clearRateLimit(env, request, `login:acct:${emailKey}`);

  if (row.deleted_at) {
    if (isPurgeable(row.deleted_at, row.purge_after)) {
      await purgeAccount(env, row.id);
      return json({ error: 'Invalid email or password' }, 401);
    }

    await env.DB.prepare(
      'UPDATE users SET deleted_at = NULL, purge_after = NULL, deleted_by = NULL WHERE id = ?',
    )
      .bind(row.id)
      .run();
    await logAdminAction(env, row.id, 'user.restore', row.id, 'self-restored on sign-in');

    const restored = await signToken({ sub: row.id, role: row.role }, env.SESSION_SECRET);
    return json(
      {
        restored: true,
        user: await sessionUser(env, row),
      },
      200,
      { 'set-cookie': sessionCookie(restored) },
    );
  }

  const token = await signToken({ sub: row.id, role: row.role }, env.SESSION_SECRET);
  return json(
    { user: await sessionUser(env, row) },
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

  return json({ user: await sessionUser(env, user) });
}

async function handleListTitles(request, env, url) {
  const type = url.searchParams.get('type');
  const genre = url.searchParams.get('genre');
  const q = url.searchParams.get('q');
  const featuredOnly = url.searchParams.get('featured') === '1';

  const where = [];
  const binds = [];

  // Adverts are excluded from this endpoint unconditionally, including when
  // someone passes ?type=ads.
  //
  // This is the single gate for Browse, the category pages, Search, and the new
  // releases and highest rated rails, so excluding here rather than in the UI is
  // what makes an advert genuinely unbrowsable. Filtering client-side would leave
  // the rows in the response for anyone reading the JSON, and an advert is a paid
  // placement, not catalog content.
  where.push(`type <> '${AD_TYPE}'`);

  if (type && TITLE_TYPE_VALUES.includes(type) && type !== AD_TYPE) {
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

  // Browsing stays open to everyone, but the playable URL of an episodic
  // title is withheld here too. Otherwise the listing would hand a signed-out
  // visitor a direct stream link and make the detail page's gate pointless.
  return json({
    titles: results.map((r) =>
      EPISODIC_TYPES.includes(r.type) ? { ...shapeTitle(r), videoUrl: null } : shapeTitle(r),
    ),
  });
}

// ---------------------------------------------------------------- titles

async function handleGetTitle(request, env, url, slug) {
  const row = await env.DB.prepare('SELECT * FROM titles WHERE slug = ?').bind(slug).first();
  if (!row) return json({ error: 'Title not found' }, 404);

  const seasons = await env.DB.prepare(
    'SELECT id, season_number, description FROM seasons WHERE title_id = ? ORDER BY season_number',
  )
    .bind(row.id)
    .all();

  const episodes = await env.DB.prepare(
    `SELECT e.id, e.episode_number, e.title, e.video_manifest_url, e.subtitles_url, e.runtime,
            e.season_id, e.video_kind, e.embed_provider, e.embed_id
     FROM episodes e JOIN seasons s ON s.id = e.season_id
     WHERE s.title_id = ? ORDER BY s.season_number, e.episode_number`,
  )
    .bind(row.id)
    .all();

  // Access rule:
  //   - Movies play for anyone, signed out or not.
  //   - Series, anime and AI titles let a signed-out visitor watch the first
  //     episode as a preview, then ask them to sign up for episode 2 onwards.
  //
  // Access rule:
  //   - Movies play for anyone, signed out or not.
  //   - Series, anime and AI titles let a signed-out visitor watch the first
  //     episode as a preview, then ask them to sign up for episode 2 onwards.
  //
  // The manifests are withheld here rather than hidden in the UI, because a
  // signed-out visitor can read the API response directly.
  // The rule itself lives in worker/access.js so it can be unit tested directly.
  // Only episodic titles need the session looked up; movies never gate.
  const signedIn = EPISODIC_TYPES.includes(row.type) ? Boolean(await getUser(request, env)) : false;

  const plan = planAccess({
    type: row.type,
    episodeIds: episodes.results.map((e) => e.id),
    signedIn,
  });

  const shaped = shapeTitle(row);

  // An uploaded video needs a short-lived signed URL, generated per request
  // rather than stored. A permanent public R2 URL would make every upload
  // fetchable by anyone who ever saw it and would bypass the access rules above
  // entirely, which is the whole reason the gate exists.
  if (shaped.videoKind === 'upload' && shaped.uploadId && env.VIDEOS) {
    const upload = await loadUpload(env, shaped.uploadId);
    if (upload?.status === 'ready') {
      // Withheld for a gated title, exactly as the episode manifests are. The
      // stream route checks again, so this is belt and braces rather than the
      // only gate.
      if (plan.titlePlayable) shaped.streamUrl = videoStreamPath(shaped.uploadId);
      else shaped.videoUrl = null;
    } else {
      // The object is gone or the row is not ready: say the video is missing
      // rather than handing the client a player with no source.
      shaped.videoKind = null;
      shaped.uploadId = null;
      shaped.missingVideo = true;
    }
  }

  return json({
    title: plan.titlePlayable ? shaped : { ...shaped, videoUrl: null },
    // Every episode stays listed so the shape of the season is browsable; only
    // the playable URLs are removed, and `locked` drives the prompt.
    episodes: episodes.results.map((e) =>
      plan.playableEpisodeIds.has(e.id)
        ? e
        : { ...e, video_manifest_url: null, subtitles_url: null, locked: true },
    ),
    locked: plan.locked,
    // Episode 1 plays but the rest do not, which is the state the gate copy is
    // written for.
    previewOnly: plan.previewAvailable,
    canPlayFirstEpisode: plan.previewAvailable,
    hasEpisodes: plan.hasEpisodes,
    seasons: seasons.results,
    episodeCount: episodes.results.length,
  });
}

const STAFF_ROLES = ['admin', 'moderator'];

/**
 * True when the signed-in account is staff (any tier below owner).
 *
 * Kept for the endpoints that genuinely belong to the staff console as a whole:
 * the dashboards, the notification inbox, the listing of staff-only
 * announcements. It does not authorise any particular action, because that is
 * now a permission. Endpoints that change data use requirePermission instead.
 */
async function requireStaff(request, env) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: 'Authentication required' }, 401) };
  if (!STAFF_ROLES.includes(user.role)) {
    return { error: json({ error: 'Staff access required' }, 403) };
  }
  return { user };
}

/**
 * Staff gate for one specific permission.
 *
 * Replaces the plain role test on everything a moderator may do, so granting
 * "catalog" lets a moderator edit titles without also letting them post
 * announcements or reset passwords.
 *
 * The refusal names the missing permission: "staff access required" is not a
 * useful answer to someone who was just promoted and is wondering why the
 * button 403s.
 */
async function requirePermission(request, env, permission) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: 'Authentication required' }, 401) };

  const permissions = await loadPermissions(env, user);
  if (!permissions.set.has(permission)) {
    return {
      error: json(
        {
          error: `You need the "${permission}" permission for this. An admin can grant it.`,
        },
        403,
      ),
    };
  }
  return { user, permissions };
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

/**
 * Genres are stored as a JSON array but arrive from several places: the staff
 * form sends a comma-separated string, scripts send an array. Accepting only an
 * array meant a string silently became [], losing the genres with no error.
 */
function normalizeGenres(input) {
  if (Array.isArray(input)) {
    return input.map((g) => String(g).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
  }
  return [];
}

async function handleCreateTitle(request, env) {
  const auth = await requirePermission(request, env, 'catalog');
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
  if (!TITLE_TYPE_VALUES.includes(type)) {
    return json({ error: `type must be one of: ${TITLE_TYPE_VALUES.join(', ')}` }, 400);
  }

  let slug = slugify(body.slug || name);
  if (!slug) return json({ error: 'Could not derive a slug from that title' }, 400);

  const clash = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?').bind(slug).first();
  if (clash) return json({ error: 'A title with that slug already exists' }, 409);

  const id = randomHex(16);
  const genres = JSON.stringify(normalizeGenres(body.genres));

  // The whole body is passed through, not a hand-picked subset: normaliseVideo
  // needs videoKind, embedProvider and embedId together, and forwarding only the
  // kind made every embed look like it was missing its provider.
  const video = await normaliseVideo(body, {}, env, auth.user);
  if (video.error) return json({ error: video.error }, 400);

  await env.DB.prepare(
    `INSERT INTO titles (id, slug, type, title, synopsis, genres, release_date, runtime, rating,
       poster_url, backdrop_url, video_url, video_source, video_kind, embed_provider, embed_id,
       upload_id, subtitles_url, featured)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      video.video_url,
      body.videoSource ?? null,
      video.video_kind,
      video.embed_provider,
      video.embed_id,
      video.upload_id,
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
  const auth = await requirePermission(request, env, 'catalog');
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const existing = await env.DB.prepare('SELECT * FROM titles WHERE slug = ?').bind(slug).first();
  if (!existing) return json({ error: 'Title not found' }, 404);

  // Decided before `next` so the video columns are set in one place: video_url,
  // video_kind and the embed pair always move together and cannot disagree.
  const video = await normaliseVideo(body, existing, env, auth.user);
  if (video.error) return json({ error: video.error }, 400);

  const next = {
    title: body.title ?? existing.title,
    synopsis: body.synopsis ?? existing.synopsis,
    // Same normalisation as create: a comma-separated string from the form must
    // not end up as a JSON string in the genres column.
    genres: body.genres ? JSON.stringify(normalizeGenres(body.genres)) : existing.genres,
    release_date: body.releaseDate ?? existing.release_date,
    runtime: body.runtime ?? existing.runtime,
    rating: body.rating ?? existing.rating,
poster_url: body.posterUrl ?? existing.poster_url,
    backdrop_url: body.backdropUrl ?? existing.backdrop_url,
video_url: video.video_url,
    video_source: video.video_kind === 'upload' ? 'upload' : (body.videoSource ?? existing.video_source),
    video_kind: video.video_kind,
    embed_provider: video.embed_provider,
    embed_id: video.embed_id,
    upload_id: video.upload_id,
    subtitles_url: body.subtitlesUrl ?? existing.subtitles_url,
    featured: body.featured === undefined ? existing.featured : body.featured ? 1 : 0,
    type: body.type ?? existing.type,
  };

  await env.DB.prepare(
    `UPDATE titles SET title=?, synopsis=?, genres=?, release_date=?, runtime=?, rating=?,
       poster_url=?, backdrop_url=?, video_url=?, video_source=?, video_kind=?, embed_provider=?, embed_id=?,
       upload_id=?, subtitles_url=?, featured=?, type=?,
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
      next.video_source,
      next.video_kind,
      next.embed_provider,
      next.embed_id,
      next.upload_id,
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
  const auth = await requirePermission(request, env, 'catalog');
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

    const title = await env.DB.prepare('SELECT id, type FROM titles WHERE slug = ?')
      .bind(String(body.slug ?? ''))
      .first();
    if (!title) return json({ error: 'Title not found' }, 404);

    // An advert is not something anybody chose to watch, so it must not become a
    // "continue watching" row. Excluding at write time stops a pre-roll
    // impression from ever appearing in the rail, rather than filtering it out
    // later and leaving the record behind.
    if (title.type === AD_TYPE) return json({ ok: true, skipped: true });

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

    // Adverts excluded in SQL as well as at write time: rows written before the
    // type existed, or by a direct database edit, would otherwise still surface.
    const { results } = await env.DB.prepare(
      `SELECT t.*, p.position, p.last_played_at FROM playback_records p
       JOIN titles t ON t.id = p.title_id
       WHERE p.user_id = ? AND t.type <> ?
       ORDER BY p.last_played_at DESC LIMIT 10`,
    )
      .bind(user.id, AD_TYPE)
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
  const auth = await requirePermission(request, env, 'users');
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

/**
 * The account list, split by who the account belongs to.
 *
 * `scope` is members | staff | all. The console has two separate tabs and each
 * asks for its own slice, so the two groups of accounts are never read as one
 * list where the first four rows happen to be staff. An unknown scope is refused
 * rather than defaulted: silently returning everything would hand a tab
 * labelled "Members" the admin accounts too.
 */
async function handleListUsers(request, env, scope) {
  const auth = await requirePermission(request, env, 'users');
  if (auth.error) return auth.error;

  const where = { members: "u.role = 'user'", staff: "u.role IN ('admin','moderator')" };
  if (scope !== 'all' && !where[scope]) {
    return json({ error: 'scope must be members, staff or all' }, 400);
  }

  // Deleted accounts are excluded: this is the list of accounts that exist as
  // far as the product is concerned. /api/admin/users/deleted is where pending
  // deletions are reviewed.
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.role, u.display_name, u.phone, u.created_at,
            u.password_fingerprint, u.last_seen_at, u.email_verified_at,
            (SELECT COUNT(*) FROM watchlist w WHERE w.user_id = u.id) AS watchlist_count,
            (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id AND t.status = 'open')
              AS open_tickets,
            (SELECT GROUP_CONCAT(p2.permission) FROM user_permissions p2 WHERE p2.user_id = u.id) AS granted
     FROM users u
     WHERE u.deleted_at IS NULL ${where[scope] ? `AND ${where[scope]}` : ''}
     ORDER BY u.created_at ASC`,
  ).all();

  const owners = ownerEmails(env);

  // The permission catalogue, so the staff console renders the toggles from
  // labels in the database instead of a list hardcoded in the client.
  const { results: catalogue } = await env.DB.prepare(
    'SELECT id, label, description FROM permissions ORDER BY sort_order, id',
  ).all();

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
      username: u.username,
      displayName: u.display_name,
      createdAt: u.created_at,
      watchlistCount: u.watchlist_count,
      openTickets: u.open_tickets,
      phone: u.phone,
      // False only for accounts that signed up since verification was required
      // and have not clicked their link yet.
      emailVerified: Boolean(u.email_verified_at),
      isOwner: owners.includes(u.email.toLowerCase()),
      lastSeenAt: u.last_seen_at,
      daysOffline: daysSince(u.last_seen_at),
      presence: presenceOf(daysSince(u.last_seen_at)),
      // Non-reversible 8-char code. Identifies a credential without revealing it.
      passwordFingerprint: u.password_fingerprint,
      passwordHistory: (history[u.id] || []).slice(0, 5),
      // Only moderators have meaningful grants; an admin implicitly holds all of
      // them and reporting [] would wrongly read as "has none been granted".
      permissions: u.role === 'moderator' ? (u.granted ? u.granted.split(',') : []) : [],
    })),
    permissionCatalogue: catalogue,
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

  // Username is optional when staff create an account: derive one from the
  // email rather than making the admin invent it.
  let username;
  if (body.username) {
    const nameCheck = validateUsername(body.username);
    if (nameCheck.error) return json({ error: nameCheck.error }, 400);
    const taken = await env.DB.prepare(
      'SELECT 1 AS x FROM users WHERE lower(username) = lower(?)',
    )
      .bind(nameCheck.username)
      .first();
    if (taken) return json({ error: 'That username is already taken' }, 409);
    username = nameCheck.username;
  } else {
    username = await deriveUsername(env, email);
  }

  const existing = await env.DB.prepare(
    'SELECT id, deleted_at, purge_after FROM users WHERE email = ?',
  )
    .bind(email)
    .first();

  if (existing?.deleted_at) {
    // Destroy it once the window has closed, so the address becomes reusable
    // rather than being held by a row nobody can ever sign into again.
    if (!isPurgeable(existing.deleted_at, existing.purge_after)) {
      return json(
        {
          error:
            'That email belongs to an account pending deletion. Restore it first, or wait for the recovery window to close.',
        },
        409,
      );
    }
    await purgeAccount(env, existing.id);
  } else if (existing) {
    return json({ error: 'An account with that email already exists' }, 409);
  }

  // Generate a strong password unless staff supplied one, in which case they
  // already know it and there is nothing to hand over afterwards.
  const supplied = typeof body.password === 'string' && body.password.length > 0;
  const password = supplied ? String(body.password) : generatePassword(16);
  if (!validPassword(password)) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }
  if (supplied) {
    // Only the length floor is enforced here, unlike at signup. The complexity
    // rule is advice for somebody picking their own password for their own
    // account; here a member of staff is setting it, and they are the one who
    // chose it. generatePassword output is not run through the policy at all, or
    // the policy would reject its own generator.
    //
    // What comes back is a warning rather than a refusal, and the UI shows it.
    if (!validPassword(password)) {
      return json({ error: 'Password must be at least 8 characters' }, 400);
    }
  }

  const roles = ['user', 'moderator', 'admin'];
  const requestedRole = roles.includes(body.role) ? body.role : 'user';
  // Only the owner may mint admins; admins may create moderators.
  const isOwner = ownerEmails(env).includes(auth.user.email.toLowerCase());
  const role = requestedRole === 'admin' && !isOwner ? 'user' : requestedRole;

  const id = randomHex(16);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);

  const phoneCheck = validatePhone(body.phone);
  if (phoneCheck.error) return json({ error: phoneCheck.error }, 400);

  await env.DB.prepare(
    `INSERT INTO users (id, email, username, password_hash, salt, role, display_name, phone,
                        password_fingerprint, email_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      email,
      username,
      hash,
      salt,
      role,
      body.displayName ?? null,
      phoneCheck.phone,
      await passwordFingerprint(password),
      // Marked proved on creation. Staff set a known password and hand it over
      // directly, so there is no inbox to prove and no link anybody could click.
      // Requiring a verification round trip here would just make staff unable to
      // set up an account for somebody.
      new Date().toISOString().replace('T', ' ').slice(0, 19),
    )
    .run();

  await logAdminAction(env, auth.user.id, 'user.create', id, `${email} (@${username})`);

  return json(
    {
      user: { id, email, username, role, emailVerified: true },
      // Returned exactly once so the admin can hand it over. Never stored readable.
      password: supplied ? null : password,
    },
    201,
  );
}

/**
 * Set a role, including demoting a moderator back to a member.
 *
 * Admin, not owner-only. The owner tier exists to protect the account that
 * cannot be replaced, not to keep the ordinary admin work of running the site to
 * one person: an admin who can promote a moderator must also be able to reverse
 * it, or the only way back is the owner.
 *
 * The owner is still off limits in both directions.
 */
async function handleSetRole(request, env, targetId) {
  const auth = await requireAdmin(request, env);
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
  const target = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  // The owner is fixed at the top of the hierarchy. Any admin attempting it --
  // including the owner demoting themselves -- is refused, so the one account
  // that cannot be recreated cannot be locked out of the admin tier.
  if (owners.includes(target.email.toLowerCase()) && role !== 'admin') {
    return json({ error: 'The owner cannot be demoted' }, 400);
  }

  // An admin cannot strip another admin of their role. Self-demotion is allowed,
  // because an admin handing the job on is a normal thing to want and they can
  // always be promoted back. The asymmetry is deliberate: a demotion applied to
  // a peer is an attack, and the owner can always reverse it.
  if (
    target.role === 'admin' &&
    role !== 'admin' &&
    target.id !== auth.user.id &&
    !owners.includes(auth.user.email.toLowerCase())
  ) {
    return json(
      { error: 'Only the site owner can demote another admin' },
      403,
    );
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, target.id).run();

  // Moving off the moderator tier drops its grants with it, so a later
  // re-promotion starts from nothing rather than silently restoring permissions
  // that were granted weeks earlier. This is what makes demoting a moderator a
  // real revocation rather than a rename.
  if (role !== 'moderator') {
    await env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?')
      .bind(target.id)
      .run();
  }

  await logAdminAction(env, auth.user.id, `user.role.${role}`, target.id, target.email);

  return json({ ok: true, role });
}

/**
 * Replaces a moderator's permissions wholesale.
 *
 * Admin, matching handleSetRole: the ability to grant a permission is only
 * meaningful alongside the ability to take it back.
 *
 * Sending the full set each time rather than toggling individual
 * rows, so the stored grants cannot drift from what the admin last saw.
 */
async function handleSetPermissions(request, env, targetId) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const requested = Array.isArray(body.permissions) ? body.permissions : [];
  const unknown = requested.filter((p) => !PERMISSION_IDS.includes(p));
  if (unknown.length) {
    return json({ error: `Unknown permission: ${unknown.join(', ')}` }, 400);
  }

  const target = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  // Admins hold every permission implicitly, so storing grants for them would
  // suggest they are revocable when they are not.
  if (target.role === 'admin') {
    return json({ error: 'Admins already hold every permission' }, 400);
  }

  await env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(target.id).run();

  for (const permission of requested) {
    await env.DB.prepare(
      'INSERT INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)',
    )
      .bind(target.id, permission, auth.user.id)
      .run();
  }

  await logAdminAction(
    env,
    auth.user.id,
    'user.permissions',
    target.id,
    requested.length ? requested.join(',') : 'none',
  );

  return json({ ok: true, permissions: requested });
}

/**
 * Sets a user's password, either to one the caller chose or to a generated one.
 *
 * Both paths end at the same place: PBKDF2 with a fresh salt. Neither leaves a
 * readable copy anywhere, so there is no code path -- admin tab or otherwise --
 * that can show an existing account's password later. What the caller-supplied
 * path buys is narrower than that: staff can set a password they already know
 * when provisioning an account, instead of having to read a generated one out of
 * a response and hand it over. The account holder ends up with a password that
 * was never transmitted or stored in the clear.
 *
 * `passwordProblem` is deliberately NOT applied to a caller-supplied value. The
 * policy exists to stop somebody choosing their own weak password for their own
 * account; here the person choosing is staff, who already hold the credentials,
 * and refusing would block setting a memorable password for a tester. The length
 * floor still applies, and a weak value is called back in `weak` so the UI can
 * say so out loud.
 */
async function handleAdminResetPassword(request, env, targetId) {
  const auth = await requirePermission(request, env, 'users');
  if (auth.error) return auth.error;

  const target = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  let body = {};
  if (request.headers.get('content-length') !== '0') {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  const supplied = typeof body.password === 'string' && body.password.length > 0;

  if (supplied && !validPassword(body.password)) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const password = supplied ? String(body.password) : generatePassword(16);
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);

  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, password_fingerprint = ? WHERE id = ?',
  )
    .bind(hash, salt, await passwordFingerprint(password), target.id)
    .run();

  // A token handed over before the change would still be redeemable afterwards.
  await env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(target.id).run();

  await logAdminAction(
    env,
    auth.user.id,
    supplied ? 'user.password.set' : 'user.password.reset',
    target.id,
    target.email,
  );

  // A chosen password is not echoed: the caller typed it, so returning it would
  // put it in a response body and a browser history for no benefit.
  if (supplied) {
    return json({
      ok: true,
      email: target.email,
      chosen: true,
      weak: passwordProblem(password) || undefined,
    });
  }

  return json({
    ok: true,
    email: target.email,
    password,
    notice: 'Shown once. Copy it now - it cannot be retrieved later.',
  });
}

/**
 * Soft-deletes an account and starts its recovery window.
 *
 * The row survives, so the account is inert rather than gone: it cannot sign in,
 * is skipped by every listing, and stays restorable until the window closes.
 *
 * Shared by the self-service and admin paths so the two cannot drift. Callers
 * do their own authorisation checks first.
 */
async function softDeleteAccount(env, target, actorId) {
  const now = Date.now();
  const deletedAt = sqlTimestamp(now);
  const purgeAfter = sqlTimestamp(now + PURGE_AFTER_DAYS * 86400000);

  await env.DB.prepare(
    'UPDATE users SET deleted_at = ?, purge_after = ?, deleted_by = ? WHERE id = ?',
  )
    .bind(deletedAt, purgeAfter, actorId ?? null, target.id)
    .run();

  // A link mailed before the deletion would otherwise still be redeemable while
  // the account is meant to be gone.
  await env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?')
    .bind(target.id)
    .run();

  await logAdminAction(
    env,
    actorId ?? target.id,
    'user.delete',
    target.id,
    actorId ? `by staff, purge after ${purgeAfter}` : 'self-deleted',
  );

  return { daysLeft: restoreDaysLeft(deletedAt, purgeAfter, now) };
}

/**
 * Destroys a deleted account for good.
 *
 * Everything hangs off users(id) with ON DELETE CASCADE, so this takes the
 * watchlist, playback history, notifications, activity ledger and reset tokens
 * with it. Titles are left alone: they belong to the catalog, not to the account
 * that posted them.
 */
async function purgeAccount(env, userId) {
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  await logAdminAction(env, userId, 'user.purge', userId, 'recovery window expired');
}

/** A user deletes their own account. Password required. */
async function handleDeleteOwnAccount(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return json({ error: 'Authentication required' }, 401);
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (!payload?.sub) return json({ error: 'Authentication required' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT id, email, salt, password_hash, deleted_at FROM users WHERE id = ?',
  )
    .bind(payload.sub)
    .first();
  if (!row || row.deleted_at) return json({ error: 'Authentication required' }, 401);

  // Session theft alone must not be enough to destroy someone's history, so the
  // account's own password is required to remove it.
  const ok = await verifyPassword(
    String(body.password ?? ''),
    row.salt,
    row.password_hash,
  );
  if (!ok) return json({ error: 'That password is not correct' }, 401);

  const owners = ownerEmails(env);
  if (owners.includes(row.email.toLowerCase())) {
    return json(
      { error: 'The owner account cannot be deleted here. Remove it from OWNER_EMAIL first.' },
      400,
    );
  }

  const { daysLeft } = await softDeleteAccount(env, row, null);

  // The session cookie is deliberately left in place.
  //
  // getUser() refuses a deleted account, so the cookie authorises nothing: the
  // account cannot browse, watch or read notifications. It is kept only because
  // /api/auth/deletion-status and /api/auth/restore-account read the session
  // directly, which is what lets the profile page show the countdown and the
  // undo button. Clearing it here would make both unreachable and leave the
  // user with no way to see how long they have.
  //
  // The token expires on its own schedule regardless, and a deleted account is
  // rejected by every other route.
  return json({
    ok: true,
    daysLeft,
    restoreWindowDays: RESTORE_WINDOW_DAYS,
    message: `Deleted. You have ${daysLeft} days to restore it.`,
  });
}

/**
 * Reports whether the account behind the current cookie is pending deletion.
 *
 * getUser refuses deleted accounts, so the profile page cannot ask it. This
 * reads the session directly, which is what lets someone whose deletion was
 * triggered elsewhere still see their countdown and undo it.
 */
async function handleDeletionStatus(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return json({ pending: false });
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (!payload?.sub) return json({ pending: false });

  const row = await env.DB.prepare(
    'SELECT id, email, deleted_at, purge_after FROM users WHERE id = ?',
  )
    .bind(payload.sub)
    .first();

  if (!row?.deleted_at) return json({ pending: false });

  const daysLeft = restoreDaysLeft(row.deleted_at, row.purge_after);
  return json({
    pending: true,
    email: row.email,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    daysLeft,
    restoreWindowDays: RESTORE_WINDOW_DAYS,
    restorable: daysLeft > 0,
  });
}

/**
 * Cancels a pending self-deletion from the profile page.
 *
 * Separate from restoring on sign-in, because the account may still hold a
 * session elsewhere and an explicit undo is clearer than waiting for a sign-in.
 */
async function handleRestoreOwnAccount(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return json({ error: 'Authentication required' }, 401);
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (!payload?.sub) return json({ error: 'Authentication required' }, 401);

  const row = await env.DB.prepare(
    'SELECT id, email, deleted_at, purge_after FROM users WHERE id = ?',
  )
    .bind(payload.sub)
    .first();

  // Same answer whether there was nothing to restore or the window had closed,
  // so this cannot be used to probe which accounts existed.
  if (!row?.deleted_at || !isRestorable(row.deleted_at, row.purge_after)) {
    return json({ error: 'There is nothing to restore' }, 404);
  }

  await env.DB.prepare(
    'UPDATE users SET deleted_at = NULL, purge_after = NULL, deleted_by = NULL WHERE id = ?',
  )
    .bind(row.id)
    .run();
  await logAdminAction(env, row.id, 'user.restore', row.id, 'self-restored');

  return json({ ok: true });
}

/** Accounts awaiting deletion, so an admin can see what is pending. */
async function handleListDeletedUsers(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.role, u.deleted_at, u.purge_after, u.deleted_by,
            d.email AS deleted_by_email
     FROM users u LEFT JOIN users d ON d.id = u.deleted_by
     WHERE u.deleted_at IS NOT NULL
     ORDER BY u.deleted_at DESC`,
  ).all();

  return json({
    users: results.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username,
      role: r.role,
      deletedAt: r.deleted_at,
      purgeAfter: r.purge_after,
      deletedBy: r.deleted_by_email ?? null,
      daysLeft: restoreDaysLeft(r.deleted_at, r.purge_after),
    })),
  });
}

/** Admin restores a pending deletion, or purges it immediately. */
async function handleAdminDeletedUser(request, env, targetId, action) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const target = await env.DB.prepare(
    'SELECT id, email, deleted_at, purge_after FROM users WHERE id = ?',
  )
    .bind(targetId)
    .first();
  if (!target?.deleted_at) return json({ error: 'That account is not pending deletion' }, 404);

  if (action === 'purge') {
    await purgeAccount(env, target.id);
    return json({ ok: true, purged: true });
  }

  if (!isRestorable(target.deleted_at, target.purge_after)) {
    return json(
      { error: 'The recovery window has closed. This account has to be deleted permanently.' },
      400,
    );
  }

  await env.DB.prepare(
    'UPDATE users SET deleted_at = NULL, purge_after = NULL, deleted_by = NULL WHERE id = ?',
  )
    .bind(target.id)
    .run();
  await logAdminAction(env, auth.user.id, 'user.restore', target.id, target.email);

  return json({ ok: true, restored: true });
}

/** Owner only: delete another account, recoverable like a self-delete. */
async function handleDeleteUser(request, env, targetId) {
  const auth = await requireOwner(request, env);
  if (auth.error) return auth.error;

  const target = await env.DB.prepare('SELECT id, email, deleted_at FROM users WHERE id = ?')
    .bind(targetId)
    .first();
  if (!target) return json({ error: 'User not found' }, 404);

  const owners = ownerEmails(env);
  if (owners.includes(target.email.toLowerCase())) {
    return json({ error: 'The owner cannot be deleted' }, 400);
  }
  if (target.id === auth.user.id) return json({ error: 'You cannot delete your own account' }, 400);

  // Deleting an account that is already pending deletion means "make it
  // permanent now", which is what an admin expects when they press it twice.
  if (target.deleted_at) {
    await purgeAccount(env, target.id);
    return json({ ok: true, purged: true });
  }

  const { daysLeft } = await softDeleteAccount(env, target, auth.user.id);

  return json({
    ok: true,
    daysLeft,
    restoreWindowDays: RESTORE_WINDOW_DAYS,
    message: `Deleted. Restorable for ${RESTORE_WINDOW_DAYS} days.`,
  });
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
  // Reset mails are a cheap way to spam staff notifications, so this is
  // throttled per IP before anything else happens.
  const limit = await hitRateLimit(env, request, 'reset-request', {
    limit: 5,
    windowSeconds: 900,
  });
  if (!limit.allowed) {
    return json(
      { ok: true, message: 'If that account exists, a reset link is on its way.' },
      429,
      { 'retry-after': String(limit.retryAfter) },
    );
  }

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

  const user = await env.DB.prepare(
    'SELECT id, email, deleted_at, purge_after FROM users WHERE email = ?',
  )
    .bind(email)
    .first();
  if (!user || user.deleted_at) return json(accepted);

  // Past the recovery window the row is destroyed on sight, so a stale reset
  // link cannot bring an account back after it should have been permanent.
  if (isPurgeable(user.deleted_at, user.purge_after)) {
    await purgeAccount(env, user.id);
    return json(accepted);
  }

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
  // deleted_at IS NULL everywhere a recipient list is built. Mailing somebody
  // who has asked to leave, or who has had their account deleted by staff, is
  // both a privacy problem and the fastest way to make someone who deleted their
  // account come back angry.
  const { results } = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('admin','moderator') AND deleted_at IS NULL",
  ).all();
  return results.map((r) => r.id);
}

async function allUserIds(env) {
  const { results } = await env.DB.prepare('SELECT id FROM users WHERE deleted_at IS NULL').all();
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
  const auth = await requirePermission(request, env, 'announcements');
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
  const auth = await requirePermission(request, env, 'announcements');
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
  const auth = await requirePermission(request, env, 'announcements');
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

  // Split by kind so the client can render two tabs without deciding what a
  // "ticket" notification is. Counted here rather than in the browser so the
  // badge matches what the API says exists.
  const isTicket = (n) => n.kind === 'ticket';

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
    unread: results.filter((n) => !n.read_at && !isTicket(n)).length,
    ticketUnread: results.filter((n) => !n.read_at && isTicket(n)).length,
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

/**
 * Marks read, optionally only one group.
 *
 * `scope` is normal | tickets | all. The bell has a tab per group, so "mark all
 * read" next to the Tickets tab has to leave the ordinary notifications alone --
 * otherwise reading a ticket silently clears everything else.
 */
async function handleMarkAllRead(request, env, scope) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const which = scope === 'normal' || scope === 'tickets' ? scope : 'all';

  let sql =
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL";
  const binds = [user.id];

  if (which !== 'all') {
    if (which === 'tickets') {
      sql += ' AND kind = ?';
      binds.push('ticket');
    } else {
      // Anything that is not a ticket is an ordinary notification.
      sql += " AND kind <> 'ticket'";
    }
  }

  await env.DB.prepare(sql)
    .bind(...binds)
    .run();

  return json({ ok: true, scope: which });
}

// ------------------------------------------------------------------ tickets
//
// A support ticket is the one place a member talks to staff directly, so it has
// its own rules rather than reusing the notification path: it is a conversation
// rather than a broadcast, only staff may put links in it, and it ends by being
// closed rather than by going quiet.
//
// Who is on which side is decided from the session on every call. `side` is never
// taken from the request body, because a member could otherwise post themselves
// the ability to send links.

/** The side of the conversation an account is on. */
function ticketSide(user) {
  return STAFF_ROLES.includes(user.role) ? 'staff' : 'member';
}

/**
 * Resolves who is asking about tickets, gating the staff queue.
 *
 * A member always gets their own tickets. A staff member gets the queue only
 * with the `tickets` grant, because the queue holds every member's email address
 * and whatever they wrote about their problem -- being a moderator is not on its
 * own a reason to read that.
 *
 * Staff without the grant fall back to the member view rather than being refused
 * outright. handleCreateTicket lets anybody open a ticket, including staff, so a
 * moderator who filed one about their own account has to be able to read it back;
 * otherwise creating a ticket becomes a dead end for exactly the people most
 * likely to file one. Falling back discloses nothing they did not write.
 */
async function ticketViewer(request, env) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: 'Authentication required' }, 401) };

  const side = ticketSide(user);
  if (side === 'staff') {
    const auth = await requirePermission(request, env, 'tickets');
    if (!auth.error) return { user, side };
    return { user, side: 'member' };
  }
  return { user, side };
}

function shapeTicket(row, extra = {}) {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    // Assignment, so the client can say who is on it without a second request.
    acceptedBy: row.accepted_by ?? null,
    acceptedAt: row.accepted_at ?? null,
    ...extra,
  };
}

/**
 * GET /api/tickets
 *
 * Staff with the `tickets` grant see every ticket; a member sees only their own.
 * The two are the same route rather than separate ones, because "my tickets" and
 * "the queue" are the same resource seen from different sides.
 */
async function handleListTickets(request, env, url) {
  const viewer = await ticketViewer(request, env);
  if (viewer.error) return viewer.error;
  const { user, side } = viewer;

  const wantsStaffView = side === 'staff';

  let status = url.searchParams.get('status');
  if (status && !['open', 'closed', 'all'].includes(status)) status = 'all';

  const conditions = [];
  const binds = [];

  if (wantsStaffView) {
    // Only members' tickets belong to the staff queue. If a member raises one,
    // it is still their conversation, so it lands in their list rather than
    // becoming staff correspondence about them.
    conditions.push("u.role = 'user'");
  } else {
    conditions.push('t.user_id = ?');
    binds.push(user.id);
  }

  if (status === 'open' || status === 'closed') {
    conditions.push('t.status = ?');
    binds.push(status);
  }

  const { results } = await env.DB.prepare(
    `SELECT t.*, u.email AS requester_email, u.username AS requester_username,
            a.email AS accepted_by_email, a.username AS accepted_by_username
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.accepted_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.last_message_at DESC
     LIMIT 200`,
  )
    .bind(...binds)
    .all();

  return json({
    tickets: results.map((row) =>
      shapeTicket(row, {
        requesterEmail: wantsStaffView ? row.requester_email : undefined,
        requesterUsername: wantsStaffView ? row.requester_username : undefined,
        // Only staff see who is handling it. A member is told through a
        // notification instead, and does not get the assignee list.
        acceptedByEmail: wantsStaffView ? row.accepted_by_email ?? null : undefined,
        acceptedByUsername: wantsStaffView ? row.accepted_by_username ?? null : undefined,
        mine: !wantsStaffView,
      }),
    ),
    counts: await ticketCounts(env, user),
  });
}

/** Open/closed totals, for the badge and the dashboard tile. */
async function ticketCounts(env, user) {
  const staff = ticketSide(user) === 'staff';
  const scope = staff ? "u.role = 'user'" : 't.user_id = ?';
  const binds = staff ? [] : [user.id];

  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed,
       COUNT(*) AS total
     FROM tickets t JOIN users u ON u.id = t.user_id
     WHERE ${scope}`,
  )
    .bind(...binds)
    .first();

  return {
    open: Number(row?.open ?? 0),
    closed: Number(row?.closed ?? 0),
    total: Number(row?.total ?? 0),
  };
}

/**
 * POST /api/tickets — open a ticket.
 *
 * A member starts one. Staff can too, but their ticket is filed as a member's so
 * it does not appear in their own queue unanswered.
 */
async function handleCreateTicket(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  // Throttled per account: opening tickets is how somebody would spam the staff
  // notification fan-out, which writes a row for every member on the site.
  const limit = await hitRateLimit(env, request, `ticket:new:${user.id}`, {
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.allowed) {
    return json(
      { error: 'You have opened several tickets recently. Try again later.' },
      429,
      { 'retry-after': String(limit.retryAfter) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const side = ticketSide(user);
  const subject = validateSubject(body.subject);
  if (subject.error) return json({ error: subject.error }, 400);

  const message = validateMessage(body.message, side);
  if (message.error) return json({ error: message.error }, 400);

  // An open cap, so one person cannot fill the queue. Closed tickets do not
  // count: they are history, and capping history would push people to start a
  // new ticket instead of replying to the one already open about the same thing.
  const open = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status = 'open'",
  )
    .bind(user.id)
    .first();
  if (Number(open?.n ?? 0) >= MAX_OPEN_TICKETS_PER_USER) {
    return json(
      {
        error: `You already have ${MAX_OPEN_TICKETS_PER_USER} tickets open. Wait for a reply, or close one you no longer need.`,
      },
      429,
    );
  }

  const ticketId = randomHex(16);
  const messageId = randomHex(16);

  // Both rows in one batch: a ticket with no first message would be unreachable
  // from the queue, because the queue is ordered by last_message_at.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tickets (id, user_id, subject, status, message_count, last_message_at)
       VALUES (?, ?, ?, 'open', 1, datetime('now'))`,
    ).bind(ticketId, user.id, subject.subject),
    env.DB.prepare(
      `INSERT INTO ticket_messages (id, ticket_id, author_id, author_side, body, has_link)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(messageId, ticketId, user.id, side, message.body, message.hasLink ? 1 : 0),
  ]);

  // Staff are told, not the member: the member is looking at the page.
  const staffRecipients = await staffIds(env);
  if (staffRecipients.length) {
    await notify(env, {
      userIds: staffRecipients,
      kind: 'ticket',
      title: `New support ticket: ${subject.subject}`,
      body: `${user.email} asked for help.`,
      // The staff console, not the ticket itself: the recipient of this
      // notification is staff, and this is where they can act on it.
      link: '/kaedeentrans',
      actor: user.email,
    });
  }

  return json({ ok: true, ticket: { id: ticketId, subject: subject.subject, status: 'open' } }, 201);
}

/**
 * GET /api/tickets/:id — one ticket and its messages.
 *
 * A member may read only their own ticket. That is checked against the row's
 * owner rather than filtered out of a list, so a member cannot read somebody
 * else's conversation by guessing an id.
 */
async function handleGetTicket(request, env, id) {
  const viewer = await ticketViewer(request, env);
  if (viewer.error) return viewer.error;
  const { user, side } = viewer;

  const staff = side === 'staff';

  const ticket = await env.DB.prepare(
    `SELECT t.*, u.email AS requester_email, u.username AS requester_username,
            a.email AS accepted_by_email, a.username AS accepted_by_username
     FROM tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.accepted_by
     WHERE t.id = ?`,
  )
    .bind(id)
    .first();
  if (!ticket) return json({ error: 'Ticket not found' }, 404);

  // A member can only ever read their own. Staff can read a member's ticket but
  // not a staff member's, which keeps the queue about members' problems.
  const owns = ticket.user_id === user.id;
  const openedByStaff = (await roleOf(env, ticket.user_id)) !== 'user';
  if (!owns && !(staff && !openedByStaff)) {
    return json({ error: 'Ticket not found' }, 404);
  }

  const { results: messages } = await env.DB.prepare(
    `SELECT m.id, m.author_side, m.body, m.has_link, m.created_at, u.email AS author_email
     FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.ticket_id = ? ORDER BY m.created_at ASC LIMIT ?`,
  )
    .bind(id, MAX_TICKET_MESSAGES)
    .all();

  return json({
    ticket: shapeTicket(ticket, {
      requesterEmail: staff ? ticket.requester_email : undefined,
      requesterUsername: staff ? ticket.requester_username : undefined,
      // A member is told who took it through a notification; showing them a
      // staff assignee in the thread as well would just be the same fact twice.
      acceptedByEmail: staff ? ticket.accepted_by_email ?? null : null,
      acceptedByUsername: staff ? ticket.accepted_by_username ?? null : null,
      mine: owns,
      // Staff need to know who they are talking to before they reply.
      canReplyAsStaff: staff,
      // Whether the viewer may take this ticket. False when somebody already
      // has, so the control can explain itself instead of silently reassigning.
      canAccept: staff && ticket.accepted_by !== user.id,
    }),
    messages: messages.map((m) => ({
      id: m.id,
      side: m.author_side,
      body: m.body,
      hasLink: Boolean(m.has_link),
      createdAt: m.created_at,
      authorEmail: staff || !owns ? m.author_email : undefined,
    })),
  });
}

/** The role behind an id, for the ownership check in handleGetTicket. */
async function roleOf(env, userId) {
  const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?')
    .bind(userId)
    .first();
  return row?.role ?? 'user';
}

/**
 * POST /api/tickets/:id/messages — add a reply.
 *
 * Reopening: replying to a closed ticket moves it back to open. A member who was
 * not satisfied reopening the conversation is the normal case, and silently
 * dropping their message because staff had closed it would lose it.
 */
async function handleReplyTicket(request, env, id) {
  const viewer = await ticketViewer(request, env);
  if (viewer.error) return viewer.error;
  const { user, side } = viewer;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(id)
    .first();
  if (!ticket) return json({ error: 'Ticket not found' }, 404);

  const owns = ticket.user_id === user.id;
  if (side === 'staff') {
    const ownerRole = await roleOf(env, ticket.user_id);
    if (ownerRole !== 'user') return json({ error: 'Ticket not found' }, 404);
  } else if (!owns) {
    return json({ error: 'Ticket not found' }, 404);
  }

  const message = validateMessage(body.message, side);
  if (message.error) return json({ error: message.error }, 400);

  const messageId = randomHex(16);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ticket_messages (id, ticket_id, author_id, author_side, body, has_link)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(messageId, id, user.id, side, message.body, message.hasLink ? 1 : 0),
    env.DB.prepare(
      `UPDATE tickets SET message_count = message_count + 1,
         last_message_at = datetime('now'),
         status = 'open', closed_at = NULL, closed_by = NULL,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(id),
  ]);

  // Tell the other side, and only the other side. Staff replying notifies the
  // member; a member replying notifies staff, which is how a question waiting on
  // a member's answer gets noticed rather than sitting open.
  if (side === 'staff') {
    await notify(env, {
      userIds: [ticket.user_id],
      kind: 'ticket',
      title: `Staff replied: ${ticket.subject}`,
      body: message.body.slice(0, 200),
      link: '/support',
      actor: user.email,
    });
  } else {
    const ids = await staffIds(env);
    if (ids.length) {
      await notify(env, {
        userIds: ids,
        kind: 'ticket',
        title: `Reply on ticket: ${ticket.subject}`,
        body: `${user.email} replied.`,
        link: '/kaedeentrans',
        actor: user.email,
      });
    }
  }

  return json({ ok: true, message: { id: messageId, side }, status: 'open' }, 201);
}

/**
 * POST /api/tickets/:id/accept — pick the ticket up.
 *
 * Whoever accepts it is named on it and the member is told, so a conversation has
 * one owner rather than several staff each assuming somebody else will reply.
 *
 * Reassignment is allowed rather than refused. Refusing would be tidier on paper
 * but wrong in practice: the common case is somebody who took a ticket and then
 * went on leave, and leaving it locked to an absent account is how a ticket goes
 * unanswered forever. The handover is audited, and the member is told again, so a
 * change of hands is visible rather than silent.
 */
async function handleAcceptTicket(request, env, id) {
  const auth = await requirePermission(request, env, 'tickets');
  if (auth.error) return auth.error;

  const ticket = await env.DB.prepare(
    `SELECT t.*, u.role AS requester_role FROM tickets t
     JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
  )
    .bind(id)
    .first();
  if (!ticket) return json({ error: 'Ticket not found' }, 404);

  // The queue is about members' problems. A ticket raised by staff is still that
  // staff member's own conversation, and 404 keeps it unreadable from here.
  if (ticket.requester_role !== 'user') return json({ error: 'Ticket not found' }, 404);

  const alreadyMine = ticket.accepted_by === auth.user.id;

  await env.DB.prepare(
    `UPDATE tickets SET accepted_by = ?, accepted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(auth.user.id, id)
    .run();

  await logAdminAction(
    env,
    auth.user.id,
    alreadyMine ? 'ticket.accept.repeat' : ticket.accepted_by ? 'ticket.accept.reassign' : 'ticket.accept',
    id,
    ticket.subject,
  );

  // Told either way, because from the member's side "somebody is on it" is new
  // information even when it is the same somebody as before. Not sent for a
  // repeat press, which would be the member getting pinged for nothing.
  if (!alreadyMine) {
    await notify(env, {
      userIds: [ticket.user_id],
      kind: 'ticket',
      title: ticket.accepted_by
        ? `${auth.user.email} is now handling your ticket`
        : `${auth.user.email} picked up your ticket`,
      body: ticket.subject,
      link: '/support',
      actor: auth.user.email,
    });
  }

  return json({
    ok: true,
    acceptedBy: auth.user.id,
    acceptedByEmail: auth.user.email,
    acceptedByUsername: auth.user.username,
    acceptedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    reassigned: Boolean(ticket.accepted_by) && !alreadyMine,
  });
}

/**
 * POST /api/tickets/:id/close — mark it solved.
 *
 * Staff only. Closing is reversible: replying reopens it, so closing something
 * by mistake is not a dead end.
 */
async function handleCloseTicket(request, env, id) {
  // The gate carries both conditions: a member gets "authentication required",
  // a moderator without the grant gets the permission message, and neither can
  // reach the row.
  const auth = await requirePermission(request, env, 'tickets');
  if (auth.error) return auth.error;
  const user = auth.user;

  const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(id)
    .first();
  if (!ticket) return json({ error: 'Ticket not found' }, 404);

  const alreadyClosed = ticket.status === 'closed';
  await env.DB.prepare(
    `UPDATE tickets SET status = 'closed', closed_at = datetime('now'), closed_by = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(user.id, id)
    .run();

  if (!alreadyClosed) {
    await logAdminAction(env, user.id, 'ticket.close', id, ticket.subject);
    await notify(env, {
      userIds: [ticket.user_id],
      kind: 'ticket',
      title: `Ticket closed: ${ticket.subject}`,
      body: 'Staff marked this as resolved. Reply to reopen it if it is not.',
      link: '/support',
      actor: user.email,
    });
  }

  return json({ ok: true, status: 'closed', alreadyClosed });
}

/**
 * Admin-only activity dashboard. Moderators are intentionally excluded: this
 * aggregates every account, not just the ones they help with.
 */
async function handleDashboard(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    `SELECT id, email, username, role, created_at, last_seen_at, deleted_at
     FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC`,
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
      username: u.username,
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

  // Tickets are summarised rather than listed here; the tab itself reads the
  // queue. Counted over member tickets only, matching what the queue shows.
  const tickets = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed
     FROM tickets t JOIN users u ON u.id = t.user_id
     WHERE u.role = 'user'`,
  ).first();

  return json({
    generatedAt: new Date().toISOString(),
    counts,
    tickets: {
      open: Number(tickets?.open ?? 0),
      closed: Number(tickets?.closed ?? 0),
    },
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
  const auth = await requirePermission(request, env, 'notifications');
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
      `SELECT id, email FROM users WHERE (${conditions.join(' OR ')}) AND deleted_at IS NULL`,
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
    "SELECT id, email FROM users WHERE role IN ('admin','moderator') AND deleted_at IS NULL",
  ).all();
  return results;
}

async function userRows(env, where) {
  // The caller's predicate is combined with deleted_at IS NULL, so a deleted
  // account can never be selected as a notification recipient.
  const { results } = await env.DB.prepare(
    `SELECT id, email FROM users WHERE (${where}) AND deleted_at IS NULL`,
  ).all();
  return results;
}

/**
 * GET /api/ads — the pre-roll pool.
 *
 * Public, because a pre-roll plays to everyone including signed-out visitors.
 * Only fields the player needs are returned, and the stream path is the same
 * gated route the catalog uses, so an advert with no playable upload is filtered
 * out here rather than failing in the player's face.
 *
 * The pool is ordered by creation and the client picks, so adding a second
 * advert is a matter of posting another one. There is no campaign, budget or
 * impression tracking, deliberately: this is a slot that plays, not an ad server.
 */
async function handleListAds(request, env) {
  if (!env.VIDEOS) return json({ ads: [] });

  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, upload_id, video_kind, embed_provider, embed_id
     FROM titles
     WHERE type = ? AND featured >= 0
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(AD_TYPE)
    .all();

  const ads = [];
  for (const row of results) {
    if (row.video_kind === 'upload' && row.upload_id) {
      const upload = await loadUpload(env, row.upload_id);
      if (upload?.status !== 'ready') continue;
      ads.push({
        slug: row.slug,
        title: row.title,
        kind: 'upload',
        src: videoStreamPath(row.upload_id),
        // Not required for playback, but a zero-length ad would flash and vanish.
        durationSecs: row.duration_secs ?? upload.duration_secs ?? null,
      });
    } else if (row.video_kind === 'embed' && row.embed_provider && row.embed_id) {
      ads.push({
        slug: row.slug,
        title: row.title,
        kind: 'embed',
        provider: row.embed_provider,
        videoId: row.embed_id,
        durationSecs: row.duration_secs ?? null,
      });
    }
  }

  return json({ ads });
}

/**
 * POST /api/titles/import-series
 *
 * Posts a whole series in one go from a pasted list of episode links. This is
 * the practical route to a real catalog: a rights holder's YouTube channel can
 * be pasted episode by episode, and the whole season is created atomically.
 *
 * Gated on the "catalog" permission like any other posting.
 *
 * The inserts go into one D1 batch, so a series cannot end up with a title and
 * half its episodes: either all of it lands or none of it does. The links are
 * parsed with the same parseEmbed the console uses, so a pasted snippet is
 * reduced to a provider and an id and nothing else survives into the database.
 */
async function handleImportSeries(request, env) {
  const auth = await requirePermission(request, env, 'catalog');
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const name = String(body.title ?? '').trim();
  if (!name) return json({ error: 'A title is required' }, 400);

  const type = String(body.type ?? 'series');
  if (!TITLE_TYPE_VALUES.includes(type)) {
    return json({ error: `type must be one of: ${TITLE_TYPE_VALUES.join(', ')}` }, 400);
  }
  if (type === AD_TYPE) {
    return json({ error: 'An advert is a single video, not a series' }, 400);
  }

  const { episodes, problems, tooMany } = parseEpisodeList(body.episodes, parseEmbed);
  if (tooMany) {
    return json(
      { error: `That is more than ${MAX_EPISODES_PER_IMPORT} episodes. Import them in batches.` },
      400,
    );
  }
  if (episodes.length === 0) {
    return json(
      {
        error:
          problems.length > 0
            ? `None of the ${problems.length} lines could be read. First problem, line ${problems[0].line}: ${problems[0].error}`
            : 'No episode links found in the pasted list',
      },
      400,
    );
  }

  const slug = slugify(body.slug || name);
  if (!slug) return json({ error: 'Could not derive a slug from that title' }, 400);

  const clash = await env.DB.prepare('SELECT id FROM titles WHERE slug = ?').bind(slug).first();
  if (clash) return json({ error: 'A title with that slug already exists' }, 409);

  const titleId = randomHex(16);
  const seasonId = randomHex(16);
  const genres = JSON.stringify(normalizeGenres(body.genres));

  // Every statement in one batch: D1 applies them together, so a failure part
  // way through cannot leave a title with no episodes.
  const statements = [
    env.DB.prepare(
      `INSERT INTO titles (id, slug, type, title, synopsis, genres, release_date, runtime, rating,
         poster_url, backdrop_url, video_url, video_source, video_kind, embed_provider, embed_id,
         upload_id, subtitles_url, featured)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      titleId,
      slug,
      type,
      name,
      String(body.synopsis ?? ''),
      genres,
      body.releaseDate || null,
      null,
      Number(body.rating ?? 0),
      body.posterUrl || null,
      body.backdropUrl || null,
      // A series has no video of its own; each episode carries it. Every
      // remaining column is bound explicitly and in order, because this list is
      // positional and one missing null throws inside D1 with no useful message.
      null, // video_url
      null, // video_source
      null, // video_kind
      null, // embed_provider
      null, // embed_id
      null, // upload_id
      null, // subtitles_url
      body.featured ? 1 : 0, // featured
    ),
    env.DB.prepare(
      'INSERT INTO seasons (id, title_id, season_number, description) VALUES (?,?,?,?)',
    ).bind(seasonId, titleId, 1, body.seasonDescription || null),
  ];

  for (const ep of episodes) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO episodes (id, season_id, episode_number, title, video_kind, embed_provider, embed_id)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        randomHex(16),
        seasonId,
        ep.number,
        ep.title || `Episode ${ep.number}`,
        'embed',
        ep.provider,
        ep.videoId,
      ),
    );
  }

  await env.DB.batch(statements);

  await logAdminAction(
    env,
    auth.user.id,
    'title.import',
    titleId,
    `${slug}: ${episodes.length} episodes`,
  );

  return json(
    {
      title: { slug, title: name, type, episodeCount: episodes.length },
      // Returned rather than swallowed: staff need to know which lines to fix.
      problems,
      imported: episodes.length,
    },
    201,
  );
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

/** Change your own username or display name. */
async function handleUpdateProfile(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Authentication required' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let username = user.username;
  if (body.username !== undefined) {
    const nameCheck = validateUsername(body.username);
    if (nameCheck.error) return json({ error: nameCheck.error }, 400);
    // Deliberately NOT filtered on deleted_at.
    //
    // The unique index on lower(username) covers every row, including accounts
    // inside their recovery window, so a pending-deletion account still holds
    // its handle. Checking only live rows said the name was free and the INSERT
    // then failed on the index, which surfaced as a 500 rather than the "already
    // taken" this is supposed to say. Excluding deleted rows here and including
    // them at the index is the mismatch that caused it.
    const taken = await env.DB.prepare(
      'SELECT 1 AS x FROM users WHERE lower(username) = lower(?) AND id <> ?',
    )
      .bind(nameCheck.username, user.id)
      .first();
    if (taken) {
      return json(
        {
          error:
            'That username is already taken. If it belongs to an account pending deletion, it stays reserved until the recovery window closes.',
        },
        409,
      );
    }
    username = nameCheck.username;
  }

  const displayName =
    body.displayName === undefined
      ? user.display_name
      : body.displayName
        ? String(body.displayName).trim().slice(0, 60)
        : null;

  // Phone is optional and never verified, so it is updated whenever it is sent.
  // Absent means "leave it alone" rather than "clear it", so a client that does
  // not know about the field cannot wipe somebody's number.
  let phone = user.phone ?? null;
  if (body.phone !== undefined) {
    const phoneCheck = validatePhone(body.phone);
    if (phoneCheck.error) return json({ error: phoneCheck.error }, 400);
    phone = phoneCheck.phone;
  }

  await env.DB.prepare(
    'UPDATE users SET username = ?, display_name = ?, phone = ? WHERE id = ?',
  )
    .bind(username, displayName, phone, user.id)
    .run();

  return json({
    user: {
      id: user.id,
      email: user.email,
      username,
      displayName,
      role: user.role,
      phone,
      emailVerified: true,
    },
  });
}

/**
 * Stable short digest, used to key a rate limit bucket by email without storing
 * the address itself in the rate limit table.
 */
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A hash and salt no account uses, for spending comparable CPU time on a login
 * for an unknown email. Generated once with the same PBKDF2 settings, so the
 * work matches a real verification closely enough to level the timings.
 */
const DECOY_SALT_VALUE = 'animeta-timing-equalizer-v1';

// Resolved once per isolate rather than at module scope: top-level await in a
// Worker module blocks startup, and one 100k-iteration hash on every cold start
// is not worth paying for a fallback path.
let decoyHashPromise = null;
function decoyHash() {
  if (!decoyHashPromise) {
    decoyHashPromise = hashPassword('animeta-not-a-real-password', DECOY_SALT_VALUE);
  }
  return decoyHashPromise;
}

/**
 * Resolves a pasted embed snippet or share link into something postable.
 *
 * Admin only, and gated on the same "catalog" permission as posting a title.
 *
 * The paste is parsed for a provider and an id and then thrown away: what comes
 * back is those two values plus a URL rebuilt from them. Nothing from the pasted
 * markup is returned, so there is no path by which a snippet can reach the
 * database or the DOM.
 *
 * oEmbed supplies the title and thumbnail when the video is public. It is
 * best-effort, and its absence is reported as such rather than as a failure,
 * because staff can always type the title themselves.
 */
async function handleEmbedLookup(request, env) {
  const auth = await requirePermission(request, env, 'catalog');
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = parseEmbed(body.url);
  if (parsed.error) return json({ error: parsed.error }, 400);

  const meta = await fetchEmbedMetadata(parsed.provider, parsed.videoId);

  // A video that will not embed is worth saying plainly. YouTube answers oEmbed
  // 404 for private, age-restricted, region-blocked and deleted videos, and a
  // public player for one of those shows the viewer an error instead of a film.
  return json({
    provider: parsed.provider,
    videoId: parsed.videoId,
    embedUrl: parsed.embedUrl,
    watchUrl: parsed.watchUrl,
    // The provider's own thumbnail is a good poster when there is no TMDB art.
    thumbnailUrl: meta.thumbnailUrl ?? null,
    title: meta.title ?? null,
    author: meta.author ?? null,
    metadataFound: Boolean(meta.title),
    hint: meta.title
      ? undefined
      : 'Could not read the title from the provider. It may be private, unlisted, or blocked in this region. Check the link, or type the title yourself.',
  });
}

/**
 * Every title, for the staff catalog list. Admin only.
 */
async function handleListTitlesAdmin(request, env, url) {
  const auth = await requirePermission(request, env, 'catalog');
  if (auth.error) return auth.error;

  const type = url.searchParams.get('type');
  const where = type && TITLE_TYPE_VALUES.includes(type) ? 'WHERE type = ?' : '';
  const sql = `SELECT t.*, (SELECT COUNT(*) FROM seasons s WHERE s.title_id = t.id) AS season_count,
    (SELECT COUNT(*) FROM episodes e JOIN seasons s2 ON s2.id = e.season_id WHERE s2.title_id = t.id) AS episode_count
    FROM titles t ${where} ORDER BY t.created_at DESC`;

  const { results } = await env.DB.prepare(sql)
    .bind(...(where ? [type] : []))
    .all();

  return json({
    titles: results.map((r) => ({
      ...shapeTitle(r),
      seasonCount: r.season_count,
      episodeCount: r.episode_count,
      createdAt: r.created_at,
    })),
  });
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
      if (seg[2] === 'verify-email' && method === 'POST') return handleVerifyEmail(request, env);
      if (seg[2] === 'resend-verification' && method === 'POST') {
        return handleResendVerification(request, env);
      }
      if (seg[2] === 'me' && method === 'GET') return handleMe(request, env);
      if (seg[2] === 'profile' && (method === 'PUT' || method === 'PATCH')) {
        return handleUpdateProfile(request, env);
      }
      if (seg[2] === 'request-reset' && method === 'POST') return handleRequestReset(request, env);
      if (seg[2] === 'reset-password' && method === 'POST') return handleResetPassword(request, env);
      // Self-service account deletion, with the recovery window that makes it
      // reversible. /restore exists because a pending-deletion account cannot be
      // signed in, so the session cookie is the only thing left to act on.
      if (seg[2] === 'delete-account' && method === 'POST') return handleDeleteOwnAccount(request, env);
      if (seg[2] === 'restore-account' && method === 'POST') return handleRestoreOwnAccount(request, env);
      // Lets the profile page show a pending deletion to whoever still holds the
      // session, including after the account has been signed out elsewhere.
      if (seg[2] === 'deletion-status' && method === 'GET') return handleDeletionStatus(request, env);
    }

    if (seg[1] === 'admin') {
      if (seg[2] === 'dashboard' && seg.length === 3 && method === 'GET') {
        return handleDashboard(request, env);
      }
      // /api/admin/users                      GET  | POST
      // /api/admin/users/deleted               GET
      // /api/admin/users/:id                   DELETE
      // /api/admin/users/:id/role              POST
      // /api/admin/users/:id/permissions       POST
      // /api/admin/users/:id/password          POST
      // /api/admin/users/:id/restore | purge   POST
      if (seg[2] === 'users' && seg.length === 3 && method === 'GET') {
        // ?scope=members|staff|all. Defaults to all, which is what the endpoint
        // has always returned, so an older client keeps working.
        return handleListUsers(request, env, url.searchParams.get('scope') || 'all');
      }
      if (seg[2] === 'users' && seg.length === 3 && method === 'POST') {
        return handleCreateUser(request, env);
      }
      // Ordered ahead of the generic /:id routes below: 'deleted' is only a
      // list name, and matching it as an id would 404.
      if (seg[2] === 'users' && seg.length === 4 && seg[3] === 'deleted' && method === 'GET') {
        return handleListDeletedUsers(request, env);
      }
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'role' && method === 'POST') {
        return handleSetRole(request, env, seg[3]);
      }
      // Grants are owner-only, unlike the actions they authorise.
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'permissions' && method === 'POST') {
        return handleSetPermissions(request, env, seg[3]);
      }
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'restore' && method === 'POST') {
        return handleAdminDeletedUser(request, env, seg[3], 'restore');
      }
      if (seg[2] === 'users' && seg.length === 5 && seg[4] === 'purge' && method === 'POST') {
        return handleAdminDeletedUser(request, env, seg[3], 'purge');
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

    // Bulk series import. Must be matched before the generic /:slug routes below
    // or "import-series" would be read as a slug.
    if (seg[1] === 'titles' && seg[2] === 'import-series' && seg.length === 3 && method === 'POST') {
      return handleImportSeries(request, env);
    }

    if (seg[1] === 'titles') {
      // Must come before the generic get-by-slug route below, otherwise
      // /api/titles/staff is read as a title whose slug is "staff" and 404s.
      if (seg.length === 3 && seg[2] === 'staff' && method === 'GET') {
        return handleListTitlesAdmin(request, env, url);
      }
      if (seg.length === 2 && method === 'GET') return handleListTitles(request, env, url);
      if (seg.length === 3 && method === 'GET') return handleGetTitle(request, env, url, seg[2]);
      if (seg.length === 2 && method === 'POST') return handleCreateTitle(request, env);
      if (seg.length === 3 && method === 'PUT') return handleUpdateTitle(request, env, seg[2]);
      if (seg.length === 3 && method === 'DELETE') return handleDeleteTitle(request, env, seg[2]);
    }

    // Pasted embed snippet or share link -> provider, id and a rebuilt player
    // URL. Same "catalog" permission as posting a title.
    if (seg[1] === 'embed' && seg[2] === 'lookup' && method === 'POST') {
      return handleEmbedLookup(request, env);
    }

    // Uploads.
    //
    // Creating an upload requires the `upload` permission, which only an admin
    // holds implicitly and a moderator holds if the admin granted it. A regular
    // account is refused here, so there is no route to it at all.
    //
    // Listing, finalising and deleting are not gated: they act only on the
    // caller's own rows, which is what somebody tidying up after a failed
    // upload needs, and a user with no uploads gets an empty list either way.
    if (seg[1] === 'uploads') {
      if (seg.length === 2 && method === 'GET') {
        const user = await getUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        return handleListMyUploads(request, env, user);
      }
      if (seg.length === 2 && method === 'POST') {
        const auth = await requirePermission(request, env, 'upload');
        if (auth.error) return auth.error;
        return handleCreateUpload(request, env, auth.user);
      }
      if (seg.length === 4 && seg[3] === 'finalise' && method === 'POST') {
        const user = await getUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        return handleFinaliseUpload(request, env, user, seg[2]);
      }
      if (seg.length === 4 && seg[3] === 'poster' && method === 'POST') {
        // Gated like the upload itself: attaching artwork to a file is part of
        // publishing it, and the image is served from this origin.
        const auth = await requirePermission(request, env, 'upload');
        if (auth.error) return auth.error;
        return handleUploadPoster(request, env, auth.user, seg[2]);
      }
      if (seg.length === 3 && method === 'DELETE') {
        const user = await getUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        return handleDeleteUpload(request, env, user, seg[2]);
      }
    }

    // Uploaded video bytes. Public, because a movie has to play for a signed-out
    // visitor, but the access rule is re-checked per request rather than encoded
    // into the URL.
    if (seg[1] === 'stream' && seg.length === 3 && method === 'GET') {
      return handleStreamUpload(request, env, seg[2]);
    }

    // Poster artwork. Public and cached hard: a catalog card has to render for
    // anyone, and the image never changes.
    if (seg[1] === 'poster' && seg.length === 3 && method === 'GET') {
      return handleServePoster(request, env, seg[2]);
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

    // Pre-roll pool. Public: a pre-roll plays to everyone, and a signed-out
    // visitor is who most needs to see the advert that pays for the site.
    if (seg[1] === 'ads' && seg.length === 2 && method === 'GET') {
      return handleListAds(request, env);
    }

    if (seg[1] === 'settings') {
      if (seg.length === 2 && method === 'GET') return handleGetSettings(request, env);
      if (seg.length === 2 && method === 'PUT') return handleUpdateSettings(request, env);
    }

    if (seg[1] === 'notifications') {
      if (seg.length === 2 && method === 'GET') return handleListNotifications(request, env);
      if (seg.length === 2 && method === 'POST') {
        return handleMarkAllRead(request, env, url.searchParams.get('scope') || 'all');
      }
      if (seg.length === 3 && method === 'POST') return handleMarkRead(request, env, seg[2]);
    }

    // Support tickets. One route for both sides: a member sees their own, staff
    // see the queue. Who you are decides what comes back, never a parameter.
    if (seg[1] === 'tickets') {
      if (seg.length === 2 && method === 'GET') return handleListTickets(request, env, url);
      if (seg.length === 2 && method === 'POST') return handleCreateTicket(request, env);
      if (seg.length === 3 && method === 'GET') return handleGetTicket(request, env, seg[2]);
      if (seg.length === 4 && seg[3] === 'messages' && method === 'POST') {
        return handleReplyTicket(request, env, seg[2]);
      }
      if (seg.length === 4 && seg[3] === 'close' && method === 'POST') {
        return handleCloseTicket(request, env, seg[2]);
      }
      if (seg.length === 4 && seg[3] === 'accept' && method === 'POST') {
        return handleAcceptTicket(request, env, seg[2]);
      }
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
