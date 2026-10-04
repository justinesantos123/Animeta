import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  randomSalt,
  randomHex,
  sessionCookie,
  clearSessionCookie,
  COOKIE_NAME,
} from './crypto.js';

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

async function getUser(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (!payload?.sub) return null;
  const row = await env.DB.prepare('SELECT id, email, role, display_name FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();
  return row ?? null;
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
  // First account to register becomes admin, so a fresh install is manageable.
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const role = count?.n === 0 ? 'admin' : 'user';

  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, email, hash, salt, role)
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

async function requireAdmin(request, env) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: 'Authentication required' }, 401) };
  if (user.role !== 'admin') return { error: json({ error: 'Admin access required' }, 403) };
  return { user };
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

    if (seg[1] === 'health' && method === 'GET') return json({ ok: true, ts: Date.now() });

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: 'Internal server error', detail: String(err) }, 500);
  }
}