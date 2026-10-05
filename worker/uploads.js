/**
 * User video uploads, stored in R2.
 *
 * Three things this module is careful about:
 *
 * 1. Object keys are generated, never derived from what the user typed. A key
 *    built from the filename would let anyone who guessed it fetch the file
 *    straight from R2, bypassing the access rules and the size accounting.
 *
 * 2. The declared size is checked against a cap before anything is written, and
 *    the stored object size is checked again on finalize. The client can lie
 *    about the first; it cannot lie about the second.
 *
 * 3. Only a small allow-list of container types is accepted. Serving an
 *    arbitrary type from the site's own origin is how an uploaded HTML or SVG
 *    file turns into stored XSS against whoever watches it.
 */

/**
 * Hard cap on one upload.
 *
 * Workers cannot stream an arbitrarily large body through: the request has to
 * fit within the platform's limits and the account pays egress for every byte.
 * 500MB is roughly a feature-length AI episode at a sane bitrate.
 */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/**
 * Containers we will store.
 *
 * video/* is what a browser can play in a <video> element. The two application
 * types are there so an MKV can be uploaded and transcoded later rather than
 * being rejected outright.
 *
 * Note what is absent: text/html, image/svg+xml and application/javascript. Any
 * of those served from the site's origin is executable in the site's origin.
 */
const ALLOWED_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/mpeg',
  'video/ogg',
  'application/octet-stream', // sniffed below; a browser may send this for mkv
]);

/** Prefixes that must never be served from our origin. */
const DANGEROUS_TYPE_RE = /(text\/html|application\/xhtml|image\/svg|javascript|xml)/i;

/** Extensions we sniff for when the client sends a generic content type. */
const EXTENSION_FOR_TYPE = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/mpeg': 'mpeg',
  'video/ogg': 'ogv',
};

export function randomHex(bytes) {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalises and checks a declared content type.
 *
 * Browsers are inconsistent: some send application/octet-stream for a perfectly
 * ordinary .mkv, so that is accepted and resolved from the filename. A genuinely
 * executable type is refused no matter what the filename claims.
 */
export function normaliseContentType(declared, filename) {
  const raw = String(declared ?? '').split(';')[0].trim().toLowerCase();

  if (DANGEROUS_TYPE_RE.test(raw)) {
    return { error: 'That file type cannot be uploaded here' };
  }

  if (ALLOWED_TYPES.has(raw) && raw !== 'application/octet-stream') {
    return { contentType: raw };
  }

  // Unknown or generic: fall back to the extension.
  const ext = String(filename ?? '')
    .toLowerCase()
    .split('.')
    .pop();
  const byExt = Object.entries(EXTENSION_FOR_TYPE).find(([, value]) => value === ext);
  if (byExt) return { contentType: byExt[0] };

  if (raw === 'application/octet-stream') {
    return { error: 'Could not tell what kind of video that is. Use .mp4, .webm or .mov.' };
  }
  return { error: 'That file type cannot be uploaded here' };
}

/**
 * Builds the R2 object key for an upload.
 *
 * Sharded by date so no single key prefix accumulates every object, which keeps
 * bucket listings manageable. The name is informational; the id before it is
 * what makes the key unguessable.
 */
export function objectKeyFor(uploadId, contentType, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const ext = EXTENSION_FOR_TYPE[contentType] ?? 'mp4';
  return `uploads/${day}/${uploadId}.${ext}`;
}

/**
 * Key for the poster frame captured in the browser at upload time.
 *
 * Separate from the video so the two can have different lifetimes: a poster is
 * a few tens of kilobytes and worth keeping, while the video is the expensive
 * part and may be replaced.
 */
export function posterKeyFor(uploadId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return `posters/${day}/${uploadId}.jpg`;
}

/**
 * Guards the poster image the browser sends alongside the video.
 *
 * The capture is client-side, so the client is describing an image it drew
 * itself. It is re-typed here because the bytes are served from this origin:
 * anything the Worker would echo back as image/jpeg has to actually be an image,
 * and SVG is never acceptable because it is a document that can script.
 */
const POSTER_MAX_BYTES = 2 * 1024 * 1024;

export function validatePoster({ contentType, contentLength }) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  // Only what a canvas can produce. Anything else, including a re-labelled
  // script, is refused.
  if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') {
    return { error: 'The poster must be a JPEG, PNG or WebP image' };
  }
  const declared = Number(contentLength);
  if (Number.isFinite(declared) && declared > POSTER_MAX_BYTES) {
    return { error: 'That poster image is too large' };
  }
  return { contentType: type };
}

/** True when a title is an advert, and so must be labelled as one. */
export function isAdType(type) {
  return type === 'ads';
}

/**
 * Guards the upload request.
 *
 * Refuses before any bytes move when the declared size is over the cap. This is
 * a courtesy check that saves the uploader a wasted transfer; finalize checks
 * the real stored size too, because the declared one is not trustworthy.
 *
 * @returns {{error?: string, contentType?: string}}
 */
export function validateUpload({ contentType, contentLength, filename }) {
  const declared = Number(contentLength);

  // Content-Length is optional on a chunked request, so its absence is allowed.
  // It is an upper bound on what will actually be accepted, not a claim about
  // the file, which is why finalize re-reads the stored size.
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return {
      error: `That file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`,
    };
  }
  // A missing Content-Length arrives as NaN and is allowed through, because a
  // chunked request has none. Zero and negative are both nonsense from a
  // browser and are refused rather than treated as "unknown".
  if (Number.isFinite(declared) && declared <= 0) {
    return { error: 'That file is empty' };
  }

  return normaliseContentType(contentType, filename);
}

/**
 * True when a title should be playable from an upload.
 *
 * Kept separate from the row shape so the rule is testable on its own.
 */
export function isPlayableUpload(upload) {
  if (!upload) return false;
  if (upload.status !== 'ready') return false;
  // A stored size of zero with a ready status would mean an object that uploaded
  // but holds nothing; treating it as playable gives the viewer a broken player.
  return Number(upload.bytes ?? 0) > 0;
}
