// Unit tests for watch-provider normalisation.
// Run: node scripts/test-watch-providers.mjs
//
// Availability data is supplied by TMDB via JustWatch. Two things matter here:
// the parser must not invent availability, and it must never hand back a link
// to somewhere other than TMDB's own watch page, because that link is rendered
// as an href and persisted.
import { parseWatchProviders, normaliseRegion } from '../worker/tmdb.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// --- Region handling ---------------------------------------------------------
check('defaults to US', normaliseRegion(undefined) === 'US');
check('uppercases a lowercase code', normaliseRegion('gb') === 'GB');
check('trims whitespace', normaliseRegion('  ca ') === 'CA');
check('rejects a long string', normaliseRegion('UNITEDSTATES') === 'US');
check('rejects digits', normaliseRegion('12') === 'US');

// --- A realistic payload -----------------------------------------------------
const NETFLIX = {
  results: {
    US: {
      link: 'https://www.themoviedb.org/movie/550/watch?locale=US',
      flatrate: [
        { logo_path: '/netflix.jpg', provider_id: 8, provider_name: 'Netflix', display_priority: 0 },
      ],
      rent: [
        { logo_path: '/apple.jpg', provider_id: 2, provider_name: 'Apple TV', display_priority: 1 },
      ],
      buy: [
        { logo_path: '/apple.jpg', provider_id: 2, provider_name: 'Apple TV', display_priority: 1 },
      ],
    },
  },
};

const netflix = parseWatchProviders(NETFLIX, 'US');
check('reads the requested region', netflix.region === 'US');
check('keeps the TMDB watch link', netflix.link === 'https://www.themoviedb.org/movie/550/watch?locale=US');
check('reports three groups', netflix.groups.length === 3, JSON.stringify(netflix.groups));
check('orders groups streaming first', netflix.groups[0].key === 'flatrate');
// Empty buckets are dropped, so the order is flatrate, rent, buy here.
check('orders groups rent second', netflix.groups[1].key === 'rent');
check('drops buckets TMDB did not return', !netflix.groups.some((g) => g.key === 'ads'));
check('builds the logo url', netflix.groups[0].items[0].logoUrl === 'https://image.tmdb.org/t/p/w92/netflix.jpg');
check('keeps the provider id', netflix.groups[0].items[0].id === 8);

// --- Region fallback is reported, not hidden ---------------------------------
const fallback = parseWatchProviders(NETFLIX, 'BR');
check('falls back when the region is missing', fallback.region === 'US', fallback.region);
check('records what was asked for', fallback.regionRequested === 'BR');
check(
  'keeps the fallback link',
  fallback.link === 'https://www.themoviedb.org/movie/550/watch?locale=US',
);

// A title available only in DE, requested as GB: must not claim GB availability.
const deOnly = parseWatchProviders(
  { results: { DE: { link: 'https://www.themoviedb.org/movie/550/watch?locale=DE', flatrate: [
    { provider_id: 119, provider_name: 'Prime Video' },
  ] } } },
  'GB',
);
check('does not relabel a fallback region', deOnly.region === 'DE', deOnly.region);
check('does not borrow another region link', deOnly.link.includes('locale=DE'));
check('still parses the fallback data', deOnly.groups[0].items[0].name === 'Prime Video');

// --- Empty availability is a real answer, not an error ------------------------
const known = parseWatchProviders({ id: 1, results: { US: { link: 'https://www.themoviedb.org/movie/1/watch?locale=US' } } });
check('a known title with no providers returns data', known !== null);
check('a known title with no providers has no groups', known.groups.length === 0);
check('a known title with no providers keeps the link', known.link !== null);

// --- Missing data returns null so the UI can say "unknown" -------------------
check('no results key returns null', parseWatchProviders({ id: 1 }, 'US') === null);
check('null payload returns null', parseWatchProviders(null, 'US') === null);
check('empty results returns null', parseWatchProviders({ results: {} }, 'US') === null);
check('array results returns null', parseWatchProviders({ results: [] }, 'US') === null);

// --- Link safety -------------------------------------------------------------
// The link is rendered as an href and stored in D1, so only TMDB's own watch
// page may be carried through.
function linkOf(link) {
  return parseWatchProviders(
    { results: { US: { link, flatrate: [{ provider_id: 1, provider_name: 'Netflix' }] } } },
    'US',
  ).link;
}

check('accepts themoviedb.org', linkOf('https://www.themoviedb.org/movie/550/watch') !== null);
check(
  'accepts a bare subdomain',
  linkOf('https://api.themoviedb.org/3/movie/550/watch/providers') !== null,
);
check('rejects a lookalike host', linkOf('https://themoviedb.org.evil.example/movie/550') === null);
check('rejects an unrelated host', linkOf('https://netflix.com/watch/550') === null);
check('rejects a lookalike suffix', linkOf('https://notthemoviedb.org/x') === null);
check('rejects plain http', linkOf('http://www.themoviedb.org/movie/550/watch') === null);
check('rejects a javascript url', linkOf('javascript:alert(1)') === null);
check('rejects empty', linkOf('') === null);
check('rejects a non-string', linkOf(null) === null);

// --- Malformed provider entries are dropped, not rendered --------------------
const messy = parseWatchProviders({
  results: {
    US: {
      link: 'https://www.themoviedb.org/movie/550/watch',
      flatrate: [
        { provider_id: 8, provider_name: 'Netflix' },
        { provider_id: 9 },
        { provider_name: '' },
        null,
        'not an object',
      ],
    },
  },
});
check('keeps only well-formed providers', messy.groups[0].items.length === 1);
check('the surviving provider is correct', messy.groups[0].items[0].name === 'Netflix');

// Non-numeric ids must not become NaN in the React key.
const oddId = parseWatchProviders({
  results: { US: { flatrate: [{ provider_id: 'abc', provider_name: 'Mystery' }] } },
});
check('a non-numeric provider id becomes null', oddId.groups[0].items[0].id === null);

// --- Sorting is stable by name so the row does not reshuffle ------------------
const many = parseWatchProviders({
  results: {
    US: {
      flatrate: [
        { provider_id: 3, provider_name: 'Zee5' },
        { provider_id: 1, provider_name: 'Netflix' },
        { provider_id: 2, provider_name: 'Amazon Prime Video' },
      ],
    },
  },
});
check(
  'sorts providers alphabetically',
  many.groups[0].items.map((i) => i.name).join(',') === 'Amazon Prime Video,Netflix,Zee5',
  many.groups[0].items.map((i) => i.name).join(','),
);

// --- Duplicate providers across buckets must not break rendering --------------
const dupes = parseWatchProviders({
  results: {
    US: {
      rent: [{ provider_id: 2, provider_name: 'Apple TV' }],
      buy: [{ provider_id: 2, provider_name: 'Apple TV' }],
    },
  },
});
check('the same service in two buckets is kept in both', dupes.groups.length === 2);

console.log(
  failed === 0
    ? '\nWatch provider parsing behaves as expected.'
    : `\n${failed} watch provider check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);