// Unit tests for title types and the advert rules.
// Run: node scripts/test-title-types.mjs
//
// The important property here is that 'ads' is a type and not a flag. That is
// what makes the Sponsored label impossible to forget: every surface asks the
// type, so a new place that renders a title cannot show an advert as editorial
// without deliberately overriding the type.
import {
  TITLE_TYPES,
  titleTypeLabel,
  titleTypeMeta,
  isEpisodic,
  isKnownType,
  isSponsored,
  typePath,
} from '../src/lib/titleTypes.js';
import { EPISODIC_TYPES, TITLE_TYPES as WORKER_TYPES } from '../worker/access.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const VALUES = TITLE_TYPES.map((t) => t.value);

// --- The catalogue -----------------------------------------------------------
check('there are five types', TITLE_TYPES.length === 5, String(TITLE_TYPES.length));
check('ids are unique', new Set(VALUES).size === VALUES.length);
for (const t of ['anime', 'movie', 'series', 'ai', 'ads']) {
  check(`catalogue has ${t}`, VALUES.includes(t));
}

// --- Client and Worker must agree --------------------------------------------
// They are separate modules because the browser cannot import the Worker's D1
// code. A type present in one and not the other is unroutable or invisible, so
// the agreement is checked rather than assumed.
check(
  'the Worker knows the same five types',
  WORKER_TYPES.length === VALUES.length && WORKER_TYPES.every((t) => VALUES.includes(t)),
  `${WORKER_TYPES.join(',')} vs ${VALUES.join(',')}`,
);
check(
  'every type has a label',
  VALUES.every((v) => titleTypeLabel(v) && titleTypeLabel(v) !== v),
);
check('every type has a blurb', TITLE_TYPES.every((t) => Boolean(t.blurb)));
check('every type is known to isKnownType', VALUES.every(isKnownType));
check('an unknown type is not known', isKnownType('nonsense') === false);
check('an unknown type returns itself as a label', titleTypeLabel('nonsense') === 'nonsense');
check('an unknown type has no meta', titleTypeMeta('nonsense') === null);

// --- Sponsored: the whole point ----------------------------------------------
check('ads is sponsored', isSponsored('ads') === true);
check('movie is not sponsored', isSponsored('movie') === false);
check('ai is not sponsored', isSponsored('ai') === false);
check('an unknown type is not sponsored', isSponsored('nonsense') === false);
check('undefined is not sponsored', isSponsored(undefined) === false);

// The `sponsored` flag is what makes a type an advert, so the count of records
// carrying it is the count of advert types. One, because two would mean the
// labelling logic and the placement logic could disagree about what an advert is.
const SPONSORED = TITLE_TYPES.filter((t) => t.sponsored);
check('exactly one type is sponsored', SPONSORED.length === 1, SPONSORED.map((t) => t.value).join(','));
check('and that type is ads', SPONSORED[0]?.value === 'ads');
check('isSponsored agrees with the flag', SPONSORED.map((t) => t.value).join(',') === VALUES.filter(isSponsored).join(','));

// The sponsored flag is the ONLY way to be an advert, so a per-title field could
// not be used to smuggle one past the label.
check(
  'only the ads record declares sponsored',
  TITLE_TYPES.filter((t) => 'sponsored' in t).map((t) => t.value).join(',') === 'ads',
);
// And it is declared rather than merely inferred, so the Sponsored label depends
// on data rather than on a default.
check('ads declares sponsored explicitly', SPONSORED[0]?.sponsored === true);

// --- Gating ------------------------------------------------------------------
// An advert is ungated: an advertiser pays for the video being watchable, and
// asking for an account to watch a 30-second ad loses them the click.
check('ads is not gated', isEpisodic('ads') === false);
check('ads is not episodic in the Worker', EPISODIC_TYPES.includes('ads') === false);
check('movie is not gated', isEpisodic('movie') === false);
for (const t of ['anime', 'series', 'ai']) {
  check(`${t} is gated`, isEpisodic(t) === true);
  check(`${t} is episodic in the Worker`, EPISODIC_TYPES.includes(t) === true);
}

// The lists have to line up: a type the UI thinks needs an account but the
// Worker thinks does not would be gated in one place and open in the other.
check(
  'UI and Worker agree on what is gated',
  VALUES.filter(isEpisodic).sort().join(',') === [...EPISODIC_TYPES].sort().join(','),
  `${VALUES.filter(isEpisodic).sort().join(',')} vs ${[...EPISODIC_TYPES].sort().join(',')}`,
);

// --- Paths -------------------------------------------------------------------
check('ads has its own category page', typePath('ads') === '/category/ads');
check('ai keeps its path', typePath('ai') === '/category/ai');
for (const t of VALUES) {
  check(`${t} has a sluggable path`, /^\/category\/[a-z]+$/.test(typePath(t)));
}

// --- Adverts must not be browsable -------------------------------------------
// This is the whole point of the type: an advert is something that plays, not
// something you browse to. Each of these is a surface that has to exclude it.
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../worker/api.js', import.meta.url), 'utf8');

const slice = (from, to) => api.slice(api.indexOf(from), api.indexOf(to));

const listHandler = slice('async function handleListTitles', '// ---------------------------------------------------------------- titles');
check('found the public listing', listHandler.length > 100, `${listHandler.length} chars`);
check(
  'the public listing excludes adverts in SQL',
  /where\.push\(`type <> '\$\{AD_TYPE\}'`\)/.test(listHandler),
);

// A specific end marker: a generic rule separator also appears earlier in the
// file, and slicing to it would silently produce an empty string and pass.
const contHandler = slice(
  'async function handleContinueWatching',
  '// ------------------------------------------------- user management',
);
check('found continue watching', contHandler.length > 100, `${contHandler.length} chars`);
check('continue watching excludes adverts in SQL', /t\.type <> \?/.test(contHandler) && /AD_TYPE/.test(contHandler));

const startHandler = slice(
  'async function handlePlaybackStart',
  'async function handleContinueWatching',
);
check('found playback start', startHandler.length > 100, `${startHandler.length} chars`);
check('playback progress is not recorded for an advert', /title\.type === AD_TYPE/.test(startHandler));

// A category filter must not be a way back in.
check('the category filter refuses the ads type', /type !== AD_TYPE/.test(listHandler));

// The pre-roll pool is the one endpoint that may return adverts.
const adsHandler = slice('async function handleListAds', 'async function handleGetSettings');
check('there is a dedicated pre-roll endpoint', adsHandler.length > 100);
check('it only returns the ads type', /WHERE type = \?/.test(adsHandler));
check('it skips adverts with no playable video', /continue;/.test(adsHandler));

console.log(
  failed === 0
    ? '\nTitle types behave as expected.'
    : `\n${failed} title type check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);