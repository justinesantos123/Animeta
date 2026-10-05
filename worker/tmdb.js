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
 * Resolves a TMDB or IMDb id to catalog metadata.
 *
 * @returns {Promise<{error?: string, ...title}>}
 */
export async function lookupExternalId(input, apiKey) {
  // Validate locally first. A malformed id should be reported as such whether
  // or not a key happens to be configured, and it costs no network call.
  const parsed = parseExternalId(input);
  if (parsed.error) return parsed;

  if (!apiKey) {
    return { error: 'TMDB_API_KEY is not set on this Worker' };
  }

  if (parsed.source === 'tmdb') {
    // Try movie first, then tv: TMDB namespaces them separately.
    const asMovie = await tmdbFetch(`/movie/${parsed.id}`, apiKey);
    if (asMovie.data) return toTitle(asMovie.data, 'movie');

    if (asMovie.error?.includes('no record')) {
      const asTv = await tmdbFetch(`/tv/${parsed.id}`, apiKey);
      if (asTv.data) return toTitle(asTv.data, 'tv');
      return asTv.error ? asTv : { error: 'No TMDB record found' };
    }
    return asMovie.error ?? { error: 'Lookup failed' };
  }

  // IMDb id: ask TMDB which record it maps to.
  const found = await tmdbFetch(`/find/${parsed.id}`, apiKey, { external_source: 'imdb_id' });
  if (found.error) return found;

  const movie = found.data?.movie_results?.[0];
  if (movie) return { ...toTitle(movie, 'movie'), imdbId: parsed.id };

  const tv = found.data?.tv_results?.[0];
  if (tv) return { ...toTitle(tv, 'tv'), imdbId: parsed.id };

  return { error: 'TMDB could not map that IMDb id to a movie or show' };
}