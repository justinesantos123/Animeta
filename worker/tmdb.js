/**
 * TMDB lookup, used by the staff console to fill in a title from an id.
 *
 * Accepts either a TMDB numeric id ("969681") or an IMDb id ("tt0133093").
 * IMDb ids are resolved through TMDB's /find endpoint, which maps one external
 * id onto a TMDB record.
 *
 * The API key comes from the TMDB_API_KEY Worker secret so it never reaches the
 * browser or the bundle.
 */

const API = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Accepts a bare TMDB id, a TMDB URL, or an IMDb id in any of its forms.
const TMDB_ID_RE = /^\d+$/;
const IMDB_ID_RE = /^tt\d{7,}$/i;

export function parseExternalId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Enter a TMDB or IMDb id' };

  // A pasted URL is a common way to arrive at an id.
  const fromTmdbUrl = raw.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i);
  if (fromTmdbUrl) return { source: 'tmdb', id: fromTmdbUrl[1] };

  const fromImdbUrl = raw.match(/imdb\.com\/(?:title|tt)\/(tt\d{7,})/i);
  if (fromImdbUrl) return { source: 'imdb', id: fromImdbUrl[1].toLowerCase() };

  if (IMDB_ID_RE.test(raw)) return { source: 'imdb', id: raw.toLowerCase() };
  if (TMDB_ID_RE.test(raw)) return { source: 'tmdb', id: raw };

  return { error: 'That does not look like a TMDB id or an IMDb id' };
}

const image = (path, size) => (path ? `${IMAGE_BASE}/${size}${path}` : null);

/** "142 min" -> "2h 22m", matching the free-text runtime already stored. */
function formatRuntime(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** Normalise a TMDB movie or tv payload into the shape the catalog form uses. */
function toTitle(raw, kind) {
  const isTv = kind === 'tv';
  const runtime = isTv
    ? (raw.episode_run_time?.[0] ?? null)
    : (raw.runtime ?? null);

  // A series carries a per-episode runtime, so label it as such rather than
  // presenting it as the length of the whole show.
  const runtimeLabel = isTv && runtime ? `${formatRuntime(runtime)} per episode` : formatRuntime(runtime);

  return {
    source: 'tmdb',
    externalId: String(raw.id),
    type: isTv ? 'series' : 'movie',
    title: raw.title || raw.name || raw.original_title || raw.original_name || '',
    synopsis: raw.overview || '',
    genres: (raw.genres || []).map((g) => g.name),
    rating: Number.isFinite(raw.vote_average) ? Math.round(raw.vote_average * 10) / 10 : null,
    runtime: runtimeLabel,
    releaseDate: (isTv ? raw.first_air_date : raw.release_date) || '',
    posterUrl: image(raw.poster_path, 'w500'),
    backdropUrl: image(raw.backdrop_path, 'w1280'),
    year: (isTv ? raw.first_air_date : raw.release_date)?.slice(0, 4) || null,
    // Carried through so the form can show what it resolved to.
    seasons: isTv ? (raw.number_of_seasons ?? null) : null,
    episodes: isTv ? (raw.number_of_episodes ?? null) : null,
  };
}

// ------------------------------------------------------------ watch providers

/**
 * Streaming availability, keyed by ISO 3166-1 alpha-2 country code.
 *
 * Availability is genuinely regional: a title can be on Netflix in the US and
 * nowhere at all in Brazil. So the region that produced the list is reported
 * alongside it rather than presenting the result as global, and a fallback to
 * another region is recorded as such instead of silently relabelling it.
 *
 * Data here is supplied by TMDB's JustWatch partnership. It is a list of places
 * a title can legally be watched, not a source of video: TMDB deliberately
 * does not issue direct links to the services, only a link to its own watch
 * page, which is the only link carried through here.
 */
const REGION_RE = /^[A-Za-z]{2}$/;

export function normaliseRegion(input) {
  const raw = String(input ?? '').trim().toUpperCase();
  return REGION_RE.test(raw) ? raw : 'US';
}

// Presented in this order, skipping any bucket TMDB did not return.
const PROVIDER_BUCKETS = [
  { key: 'flatrate', label: 'Streaming' },
  { key: 'ads', label: 'Free with ads' },
  { key: 'free', label: 'Free' },
  { key: 'rent', label: 'Rent' },
  { key: 'buy', label: 'Buy' },
];

/**
 * Only TMDB's own watch page is ever linked. The value is persisted and later
 * rendered as an href, so it is constrained to the one host that is expected
 * rather than trusted.
 */
function watchLink(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)themoviedb\.org$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Normalises a `/watch/providers` payload into grouped providers.
 *
 * Returns null only when TMDB reported no availability at all, which is not an
 * error. A known title with an empty group list is a real answer: it means
 * "not currently available here", and the UI says so rather than hiding it.
 *
 * @param {object} raw       parsed TMDB /watch/providers response
 * @param {string} requested ISO country code to prefer
 */
export function parseWatchProviders(raw, requested = 'US') {
  const regions = raw?.results;
  if (!regions || typeof regions !== 'object' || Array.isArray(regions)) return null;

  const wanted = normaliseRegion(requested);
  const region =
    regions[wanted] ?? regions.US ?? Object.values(regions).find((r) => r && typeof r === 'object');
  if (!region || typeof region !== 'object') return null;

  // Work out which region actually answered, so a US fallback requested as GB
  // is not mislabelled as UK availability.
  const usedRegion =
    Object.keys(regions).find((k) => regions[k] === region) ?? wanted;

  const groups = [];
  for (const { key, label } of PROVIDER_BUCKETS) {
    const list = Array.isArray(region[key]) ? region[key] : [];
    const items = list
      .filter((p) => p && p.provider_name)
      .map((p) => ({
        id: Number.isFinite(p.provider_id) ? p.provider_id : null,
        name: String(p.provider_name),
        logoUrl: image(p.logo_path, 'w92'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (items.length) groups.push({ key, label, items });
  }

  return {
    region: usedRegion,
    regionRequested: wanted,
    link: watchLink(region.link),
    groups,
  };
}

/**
 * Fetches where a title can legally be watched.
 *
 * Availability is supplementary information, so any failure resolves to null
 * rather than propagating: a title should still post cleanly when the
 * availability lookup misses or TMDB is briefly unhappy.
 */
export async function fetchWatchProviders(kind, id, apiKey, region = 'US') {
  if (!apiKey || !id) return null;

  const type = kind === 'tv' || kind === 'series' ? 'tv' : 'movie';
  const res = await tmdbFetch(`/${type}/${id}/watch/providers`, apiKey);
  if (res.error) return null;

  return parseWatchProviders(res.data, region);
}

async function tmdbFetch(path, key, params = {}) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('api_key', key);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { accept: 'application/json' } });

  if (res.status === 401) {
    return { error: 'TMDB rejected the API key. Check TMDB_API_KEY.' };
  }
  if (res.status === 404) {
    return { error: 'TMDB has no record for that id' };
  }
  if (res.status === 429) {
    return { error: 'TMDB rate limit reached. Try again shortly.' };
  }
  if (!res.ok) {
    return { error: `TMDB returned ${res.status}` };
  }
  return { data: await res.json() };
}

/**
 * Resolves a TMDB or IMDb id to catalog metadata, plus where it can be watched.
 *
 * Availability costs one extra TMDB call and is fetched alongside the metadata
 * so a single paste in the staff console fills in everything known about the
 * title. It is best-effort: `watchProviders` is simply absent when TMDB has no
 * availability data or the lookup failed.
 *
 * @param {string} input   TMDB id, IMDb id, or either as a URL
 * @param {string} apiKey  from the TMDB_API_KEY Worker secret
 * @param {string} region  ISO country code to read availability for
 * @returns {Promise<{error?: string, ...title}>}
 */
export async function lookupExternalId(input, apiKey, region = 'US') {
  // Validate locally first. A malformed id should be reported as such whether
  // or not a key happens to be configured, and it costs no network call.
  const parsed = parseExternalId(input);
  if (parsed.error) return parsed;

  if (!apiKey) {
    return { error: 'TMDB_API_KEY is not set on this Worker' };
  }

  // TMDB namespaces movies and shows separately, and only the resolved kind's
  // availability endpoint is correct for the title.
  const attachProviders = async (title) => {
    const providers = await fetchWatchProviders(
      title.type === 'series' ? 'tv' : 'movie',
      title.externalId,
      apiKey,
      region,
    );
    return providers ? { ...title, watchProviders: providers } : title;
  };

  if (parsed.source === 'tmdb') {
    // Try movie first, then tv: TMDB namespaces them separately.
    const asMovie = await tmdbFetch(`/movie/${parsed.id}`, apiKey);
    if (asMovie.data) return attachProviders(toTitle(asMovie.data, 'movie'));

    if (asMovie.error?.includes('no record')) {
      const asTv = await tmdbFetch(`/tv/${parsed.id}`, apiKey);
      if (asTv.data) return attachProviders(toTitle(asTv.data, 'tv'));
      return asTv.error ? asTv : { error: 'No TMDB record found' };
    }
    return asMovie.error ?? { error: 'Lookup failed' };
  }

  // IMDb id: ask TMDB which record it maps to.
  const found = await tmdbFetch(`/find/${parsed.id}`, apiKey, { external_source: 'imdb_id' });
  if (found.error) return found;

  const movie = found.data?.movie_results?.[0];
  if (movie) return attachProviders({ ...toTitle(movie, 'movie'), imdbId: parsed.id });

  const tv = found.data?.tv_results?.[0];
  if (tv) return attachProviders({ ...toTitle(tv, 'tv'), imdbId: parsed.id });

  return { error: 'TMDB could not map that IMDb id to a movie or show' };
}