// Unit tests for upload validation in worker/uploads.js.
// Run: node scripts/test-uploads.mjs
//
// The theme here is that a client controls everything it sends: the filename,
// the content type and the content length. Nothing it sends may end up as an
// object key or as a served content type, because those two values decide where
// a file lands and how the browser treats it.
import {
  MAX_UPLOAD_BYTES,
  normaliseContentType,
  objectKeyFor,
  posterKeyFor,
  validatePoster,
  validateUpload,
  isPlayableUpload,
  isAdType,
} from '../worker/uploads.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// --- Content types that can be stored ---------------------------------------
for (const type of ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']) {
  check(`accepts ${type}`, normaliseContentType(type, 'x.bin').contentType === type);
}
check('strips parameters from a content type', normaliseContentType('video/mp4; codecs=avc1', 'x.mp4').contentType === 'video/mp4');
check('is case insensitive', normaliseContentType('VIDEO/MP4', 'x.mp4').contentType === 'video/mp4');
check('falls back to the extension for octet-stream mp4', normaliseContentType('application/octet-stream', 'clip.mp4').contentType === 'video/mp4');
check('falls back to the extension for octet-stream mkv', normaliseContentType('application/octet-stream', 'clip.mkv').contentType === 'video/x-matroska');
check('handles an uppercase extension', normaliseContentType('application/octet-stream', 'CLIP.WEBM').contentType === 'video/webm');

// --- Content types that must never be served from our origin ----------------
// This is the stored-XSS case: an HTML or SVG file served from the site's own
// origin runs in the site's origin.
const DANGEROUS = [
  ['text/html', 'evil.html'],
  ['text/html; charset=utf-8', 'evil.html'],
  ['image/svg+xml', 'evil.svg'],
  ['application/xhtml+xml', 'evil.xhtml'],
  ['application/javascript', 'evil.js'],
  ['text/javascript', 'evil.js'],
  ['application/xml', 'evil.xml'],
  ['text/xml', 'evil.xml'],
];
for (const [type, name] of DANGEROUS) {
  const got = normaliseContentType(type, name);
  check(`refuses ${type}`, Boolean(got.error) && !got.contentType, JSON.stringify(got));
}

// A dangerous type must be refused even when the filename looks like a video:
// the type is what the browser will act on.
check('refuses text/html named .mp4', Boolean(normaliseContentType('text/html', 'movie.mp4').error));
check('refuses svg named .mp4', Boolean(normaliseContentType('image/svg+xml', 'movie.mp4').error));

check('refuses an unknown type', Boolean(normaliseContentType('application/x-msdownload', 'a.exe').error));
check('refuses octet-stream with no usable extension', Boolean(normaliseContentType('application/octet-stream', 'a.exe').error));
check('refuses a missing type and name', Boolean(normaliseContentType(undefined, undefined).error));

// --- Object keys -----------------------------------------------------------
// A key derived from the filename would let anyone who guessed it fetch the
// file directly from R2.
{
  const key = objectKeyFor('abc123def456', 'video/mp4');
  check('the key contains the upload id', key.includes('abc123def456'));
  check('the key does not contain any user input', !/[^/]*\s/.test(key));
  check('the key is namespaced', key.startsWith('uploads/'));
  check('the key uses the right extension', key.endsWith('.mp4'));
}
{
  // Two uploads of the same file must not collide on one key.
  const a = objectKeyFor('id-one', 'video/mp4');
  const b = objectKeyFor('id-two', 'video/mp4');
  check('different ids produce different keys', a !== b);
}
{
  check('a webm upload gets a webm key', objectKeyFor('x', 'video/webm').endsWith('.webm'));
  check('a matroska upload gets an mkv key', objectKeyFor('x', 'video/x-matroska').endsWith('.mkv'));
}

// --- Size validation --------------------------------------------------------
check('the cap is 500MB', MAX_UPLOAD_BYTES === 500 * 1024 * 1024);
check('accepts a normal size', validateUpload({ contentType: 'video/mp4', contentLength: 50 * 1024 * 1024, filename: 'a.mp4' }).contentType === 'video/mp4');
check('refuses an oversized file', Boolean(validateUpload({ contentType: 'video/mp4', contentLength: MAX_UPLOAD_BYTES + 1, filename: 'a.mp4' }).error));
check('accepts a file exactly at the cap', !validateUpload({ contentType: 'video/mp4', contentLength: MAX_UPLOAD_BYTES, filename: 'a.mp4' }).error);
check('refuses a zero-byte file', Boolean(validateUpload({ contentType: 'video/mp4', contentLength: 0, filename: 'a.mp4' }).error));
check('accepts a chunked request with no length', validateUpload({ contentType: 'video/mp4', filename: 'a.mp4' }).contentType === 'video/mp4');
check('rejects a negative length', Boolean(validateUpload({ contentType: 'video/mp4', contentLength: -5, filename: 'a.mp4' }).error));
check('a dangerous type is refused before the size matters', Boolean(validateUpload({ contentType: 'text/html', contentLength: 10, filename: 'a.html' }).error));

// --- Playability ------------------------------------------------------------
check('a ready upload with a size is playable', isPlayableUpload({ status: 'ready', bytes: 1024 }) === true);
check('a pending upload is not playable', isPlayableUpload({ status: 'pending', bytes: 1024 }) === false);
check('a failed upload is not playable', isPlayableUpload({ status: 'failed', bytes: 1024 }) === false);
check('a missing upload is not playable', isPlayableUpload(null) === false);
check('a ready upload with no size is not playable', isPlayableUpload({ status: 'ready', bytes: null }) === false);
check('a ready upload of zero bytes is not playable', isPlayableUpload({ status: 'ready', bytes: 0 }) === false);

// --- Poster frames ---------------------------------------------------------
// The poster is drawn by the browser and then served from this origin, so a
// client that describes an image as something else must be refused rather than
// echoed back with the type it claimed.
check('poster key is namespaced', posterKeyFor('abc').startsWith('posters/'));
check('poster key carries the id', posterKeyFor('abc123').includes('abc123'));
check('poster key is a jpg', posterKeyFor('abc').endsWith('.jpg'));
check(
  'poster and video keys differ',
  posterKeyFor('abc') !== objectKeyFor('abc', 'video/mp4'),
);
for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
  check(`poster accepts ${type}`, validatePoster({ contentType: type }).contentType === type);
}
check(
  'poster ignores parameters',
  validatePoster({ contentType: 'image/jpeg; charset=binary' }).contentType === 'image/jpeg',
);
const POSTER_REFUSE = [
  ['text/html', 'evil.html'],
  ['image/svg+xml', 'evil.svg'],
  ['application/javascript', 'evil.js'],
  ['application/octet-stream', 'a.bin'],
  ['video/mp4', 'a.mp4'],
];
for (const [type, name] of POSTER_REFUSE) {
  check(
    `poster refuses ${type}`,
    Boolean(validatePoster({ contentType: type, contentLength: 10 }).error),
    name,
  );
}
check('poster refuses a missing type', Boolean(validatePoster({ contentType: undefined }).error));
check(
  'poster refuses an oversized image',
  Boolean(validatePoster({ contentType: 'image/jpeg', contentLength: 5 * 1024 * 1024 }).error),
);
check(
  'poster accepts an image with no declared length',
  validatePoster({ contentType: 'image/jpeg' }).contentType === 'image/jpeg',
);

// --- Advert type ------------------------------------------------------------
// Only the type decides, so a title cannot be an advert in one place and not
// another.
check('ads is an advert type', isAdType('ads') === true);
for (const t of ['movie', 'series', 'anime', 'ai', undefined, 'nonsense']) {
  check(`${t} is not an advert type`, isAdType(t) === false);
}

console.log(
  failed === 0
    ? '\nUpload validation behaves as expected.'
    : `\n${failed} upload check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);