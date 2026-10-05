/**
 * Internet Archive resolver.
 *
 * The Internet Archive holds tens of thousands of public-domain films with
 * direct, range-request-capable .mp4 files, reachable through a free REST API
 * with no key and no account. That makes it the one source that is both
 * genuinely playable and genuinely free to serve, so it backs the demo
 * catalog.
 *
 * Licence is surfaced on every result and never assumed. Archive items are
 * either public domain or carry an explicit Creative Commons licence, and the
 * item's own rights statement is what we report rather than a blanket claim.
 */

const SCRAPE = 'https://archive.org/services/search/v1/scrape';
const METADATA = 'https://archive.org/metadata';
const DOWNLOAD = 'https://archive.org/download';

// Films first, then anything playable, then the wider movie collection.
const DEFAULT_QUERY = 'collection:(feature_films) AND mediatype:(movies)';

/** "The Kid (1921)" -> { title: "The Kid", year: "1921" } */
export function splitTitleAndYear(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: m[2] };
  const bare = s.match(/^(.*?)\s*(\d{4})$/);
  if (bare) return { title: bare[1].trim(), year: bare[2] };
  return { title: s, year: null };
}

/**
 * Picks the file to play.
 *
 * Prefers Archive's own h.264 derivative: it is transcoded for browsers and
 * much smaller than the uploaded original, which matters when the file is
 * several hundred megabytes.
 */
function pickPlayable(files = []) {
  const mp4s = files.filter((f) => /\.mp4$/i.test(f.name || ''));
  if (!mp4s.length) return null;

  const byPreference = (f) => {
    const format = String(f.format || '').toLowerCase();
    if (format.includes('h.264')) return 0;
    if (format.includes('512kb')) return 1;
    if (format.includes('mpeg4')) return 2;
    return 3;
  };

  // Originals are usually the huge ones; skip anything Archive flagged as such.
  const notOriginal = mp4s.filter((f) => !/original/i.test(f.source || ''));
  const pool = notOriginal.length ? notOriginal : mp4s;

  return [...pool].sort((a, b) => byPreference(a) - byPreference(b))[0];
}

/** Public-domain or Creative Commons, read off the item's own metadata. */
function readLicence(meta = {}) {
  const url = meta.licenseurl || '';
  const raw = String(meta.license || '');

  if (/creativecommons\.org\/licenses\/by\/4\.0/i.test(url)) return { key: 'cc-by-4.0', label: 'CC BY 4.0', url };
  if (/creativecommons\.org\/licenses\/by-sa/i.test(url)) return { key: 'cc-by-sa', label: 'CC BY-SA', url };
  if (/creativecommons\.org\/publicdomain\/zero/i.test(url)) return { key: 'cc0', label: 'CC0', url };
  if (/creativecommons\.org/i.test(url)) return { key: 'cc', label: 'Creative Commons', url };

  // Archive exposes an explicit rights field on public-domain items.
  const rights = String(meta.rights || '');
  if (/public\s*domain/i.test(rights) || /no\s*known\s*copyright/i.test(rights)) {
    return { key: 'public-domain', label: 'Public domain', url: null };
  }
  if (/publicdomain/i.test(raw)) return { key: 'public-domain', label: 'Public domain', url: null };
  if (raw) return { key: 'other', label: raw, url: null };

  // Unstated. Report that plainly rather than defaulting to "free".
  return { key: 'unstated', label: 'Licence not stated', url: null };
}

function toItem(meta, files) {
  const playable = pickPlayable(files);
  if (!playable) return null;

  const identifier = meta.metadata?.identifier;
  if (!identifier) return null;

  const rawTitle = meta.metadata?.title || identifier;
  const { title, year } = splitTitleAndYear(rawTitle);

  return {
    identifier,
    archiveUrl: `https://archive.org/details/${identifier}`,
    title,
    year: year || (meta.metadata?.year ? String(meta.metadata.year).slice(0, 4) : null),
    synopsis: meta.metadata?.description
      ? String(meta.metadata.description).replace(/<[^>]*>/g, '').trim().slice(0, 600)
      : '',
    // The leading still is a usable poster and needs no extra request.
    posterUrl: `https://archive.org/services/img/${identifier}`,
    videoUrl: `${DOWNLOAD}/${identifier}/${encodeURIComponent(playable.name)}`,
    durationSeconds: Number(playable.length) || null,
    sizeBytes: Number(playable.size) || null,
    licence: readLicence(meta.metadata),
    creator: meta.metadata?.creator
      ? String(meta.metadata.creator).replace(/<[^>]*>/g, '').trim()
      : null,
  };
}

async function getJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Searches for public-domain films.
 *
 * @returns {Promise<{error?: string, results: object[]}>}
 */
export async function searchArchive(query, { limit = 12 } = {}) {
  const trimmed = String(query ?? '').trim();

  // Lucene-ish: quote the phrase so "night of the" does not match everything,
  // and let an empty query fall back to the feature-film collection.
  const q = trimmed
    ? `mediatype:(movies) AND title:("${trimmed.replace(/"/g, '')}")`
    : DEFAULT_QUERY;

  const url =
    `${SCRAPE}?q=${encodeURIComponent(q)}` +
    `&fields=title,identifier,year&count=100&sorts=${encodeURIComponent('downloads desc')}`;

  const data = await getJson(url);
  if (!data) return { error: 'Could not reach the Internet Archive', results: [] };

  const candidates = (data.items || []).slice(0, limit * 3);
  const results = [];

  // Search results carry no file list, so each candidate needs a metadata
  // call to confirm it actually has a playable mp4. Done with a small
  // concurrency cap so a slow item does not stall the rest.
  for (const group of chunk(candidates, 4)) {
    const resolved = await Promise.all(
      group.map((c) =>
        getJson(`${METADATA}/${encodeURIComponent(c.identifier)}`).then((m) => toItem(m, m?.files)),
      ),
    );
    for (const item of resolved) {
      // Only surface items we can actually play.
      if (item && !items.has(item.identifier)) {
        items.add(item.identifier);
        results.push(item);
      }
    }
    if (results.length >= limit) break;
  }

  return { results: results.slice(0, limit) };
}

const items = new Set();

/** Resolves one known identifier to a playable item. */
export async function resolveArchiveItem(identifier) {
  const meta = await getJson(`${METADATA}/${encodeURIComponent(String(identifier).trim())}`);
  if (!meta) return { error: 'No Internet Archive item with that identifier' };

  const item = toItem(meta, meta.files);
  if (!item) return { error: 'That item has no playable MP4' };
  return { item };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}