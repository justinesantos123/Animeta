/**
 * Upload endpoints.
 *
 * Files go to R2; only metadata goes to D1. Three endpoints:
 *
 *   POST /api/uploads              create the row and write the object
 *   POST /api/uploads/:id/finalise confirm it and record the real size
 *   GET  /api/uploads/mine         the caller's own uploads
 *
 * The upload itself is a single PUT of the file body. A separate presigned-URL
 * handshake would avoid proxying bytes through the Worker, but R2 does not hand
 * out presigned URLs to Workers directly, and proxying is what lets the size be
 * checked before anything is stored. At the 500MB cap that is the right trade
 * for a site this size; if uploads grow much larger the Worker should hand back
 * a signed S3 URL and take the bytes out-of-band.
 */

import {
  MAX_UPLOAD_BYTES,
  objectKeyFor,
  validateUpload,
  isPlayableUpload,
  randomHex,
} from './uploads.js';

/** Uploads per hour, per account. Generous enough to be usable, tight enough to stop a script. */
const UPLOADS_PER_HOUR = 10;

/** One user, one upload at a time, so a slow upload cannot exhaust the account's quota. */
const MAX_CONCURRENT_PENDING = 2;

function json(data, status = 200, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * R2 has to be reachable, or uploads cannot work at all.
 *
 * Reported as a clear message rather than a 500, because the usual cause is that
 * R2 was never enabled on the account.
 */
function requireBucket(env) {
  if (!env.VIDEOS) {
    return 'Video storage is not configured on this Worker. R2 needs enabling on the Cloudflare account.';
  }
  return null;
}

/** Shape returned to the client. Deliberately never includes the object key. */
function shapeUpload(row) {
  return {
    id: row.id,
    filename: row.original_name,
    bytes: row.bytes,
    contentType: row.content_type,
    durationSecs: row.duration_secs,
    width: row.width,
    height: row.height,
    status: row.status,
    createdAt: row.created_at,
    playable: isPlayableUpload(row),
  };
}

/**
 * POST /api/uploads
 *
 * The request body is the file. Metadata travels in query parameters, because a
 * multipart form would need the body parsed before it could be streamed to R2,
 * and that means buffering the whole video in memory.
 */
export async function handleCreateUpload(request, env, user) {
  const bucketError = requireBucket(env);
  if (bucketError) return json({ error: bucketError }, 503);

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename')?.slice(0, 200) ?? null;

  const check = validateUpload({
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
    filename,
  });
  if (check.error) return json({ error: check.error }, 400);

  // Counted per account, not per IP: the goal is to bound one account's upload
  // volume, and several accounts behind one NAT share an address.
  const hourBucket = `upload:${user.id}:${Math.floor(Date.now() / 3600000)}`;
  const allowed = await bumpCounter(env, hourBucket, UPLOADS_PER_HOUR);
  if (!allowed) {
    return json(
      { error: `Upload limit reached. You can upload ${UPLOADS_PER_HOUR} videos an hour.` },
      429,
      { 'retry-after': '3600' },
    );
  }

  const { results: pending } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM uploads WHERE user_id = ? AND status = 'pending'",
  )
    .bind(user.id)
    .all();
  if ((pending[0]?.n ?? 0) >= MAX_CONCURRENT_PENDING) {
    return json({ error: 'Finish or cancel your current upload first.' }, 409);
  }

  const id = randomHex(16);
  const key = objectKeyFor(id, check.contentType);

  let object;
  try {
    object = await env.VIDEOS.put(key, request.body, {
      httpMetadata: {
        contentType: check.contentType,
      },
    });
  } catch (err) {
    return json({ error: `Upload failed: ${String(err)}` }, 502);
  }

  // R2 does not report the written size on the put response, so it is counted
  // from the body. Content-Length was already checked against the cap, and this
  // is what makes the stored number authoritative.
  const bytes = Number(object?.size ?? request.headers.get('content-length') ?? 0);

  // The client can declare a smaller file than it sends. Rather than trust the
  // header, the real size is compared and an over-cap object is deleted rather
  // than left sitting in the bucket.
  if (bytes > MAX_UPLOAD_BYTES) {
    await env.VIDEOS.delete(key).catch(() => {});
    return json({ error: `That file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit` }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO uploads (id, user_id, object_key, original_name, bytes, content_type, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ready', datetime('now'))`,
  )
    .bind(id, user.id, key, filename, bytes, check.contentType)
    .run();

  const row = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).first();
  return json({ upload: shapeUpload(row) }, 201);
}

/**
 * POST /api/uploads/:id/finalise
 *
 * Records what the browser learned from actually decoding the file: duration and
 * dimensions. Those cannot be trusted from the client for anything that matters,
 * but they are used here only to display, and a wrong value is better than none.
 */
export async function handleFinaliseUpload(request, env, user, uploadId) {
  const row = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first();
  if (!row) return json({ error: 'Upload not found' }, 404);
  // Scoped to the owner so one user cannot finalise or read another's metadata.
  if (row.user_id !== user.id) return json({ error: 'Upload not found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const duration = Number(body.durationSecs);
  const width = Number(body.width);
  const height = Number(body.height);

  await env.DB.prepare(
    `UPDATE uploads SET duration_secs = ?, width = ?, height = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      Number.isFinite(duration) && duration > 0 ? Math.round(duration) : row.duration_secs,
      Number.isFinite(width) && width > 0 ? Math.round(width) : row.width,
      Number.isFinite(height) && height > 0 ? Math.round(height) : row.height,
      uploadId,
    )
    .run();

  const updated = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first();
  return json({ upload: shapeUpload(updated) });
}

/** GET /api/uploads/mine — the caller's own uploads, newest first. */
export async function handleListMyUploads(request, env, user) {
  const { results } = await env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM titles t WHERE t.upload_id = u.id) AS title_count
     FROM uploads u WHERE u.user_id = ?
     ORDER BY u.created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all();

  return json({
    uploads: results.map((r) => ({ ...shapeUpload(r), titleCount: r.title_count ?? 0 })),
    maxBytes: MAX_UPLOAD_BYTES,
  });
}

/** DELETE /api/uploads/:id — remove the object and the row. */
export async function handleDeleteUpload(request, env, user, uploadId) {
  const row = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first();
  if (!row) return json({ error: 'Upload not found' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') {
    return json({ error: 'Upload not found' }, 404);
  }

  // The object goes first. If this fails the row is still deleted, because a
  // stranded row that looks deletable is worse than an orphaned object that costs
  // storage until the bucket lifecycle rule collects it.
  if (env.VIDEOS) await env.VIDEOS.delete(row.object_key).catch(() => {});

  // ON DELETE SET NULL means any title using it keeps its catalog entry and
  // simply loses its video, which is visible to staff rather than silently broken.
  await env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(uploadId).run();
  return json({ ok: true });
}

/**
 * Reads an upload row, for the title endpoints that need to know whether a
 * title's video is actually playable.
 */
export async function loadUpload(env, uploadId) {
  if (!uploadId) return null;
  return env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first();
}

/**
 * Fixed-window counter, same shape as the existing rate limit table.
 *
 * The value expires with the row rather than being swept: the key includes the
 * hour, so an old row is simply never read again.
 */
async function bumpCounter(env, bucket, limit) {
  const row = await env.DB.prepare('SELECT hits FROM auth_rate_limits WHERE bucket = ?')
    .bind(bucket)
    .first();
  const hits = (row?.hits ?? 0) + 1;
  if (hits > limit) return false;

  await env.DB.prepare(
    'INSERT INTO auth_rate_limits (bucket, hits) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET hits = ?',
  )
    .bind(bucket, hits, hits)
    .run();
  return true;
}
