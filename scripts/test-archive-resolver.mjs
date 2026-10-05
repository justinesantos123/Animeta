// Unit tests for the Internet Archive resolver's parsing and licence logic.
// Run: node scripts/test-archive-resolver.mjs
//
// The network path needs Archive to be up, which is not something a unit test
// should depend on, so the pure parts are pinned here instead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitTitleAndYear } from '../worker/archive.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/^\w:/, (m) => m);
const source = readFileSync(join(ROOT, 'worker/archive.js'), 'utf8');

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// --- Title and year splitting ------------------------------------------------
const TITLES = [
  ['Night of the Living Dead (1968)', 'Night of the Living Dead', '1968'],
  ['13 Hours By Air (1936)', '13 Hours By Air', '1936'],
  ['The Kid 1921', 'The Kid', '1921'],
  ['Some Long Feature Title', 'Some Long Feature Title', null],
  ['', '', null],
];

for (const [input, wantTitle, wantYear] of TITLES) {
  const got = splitTitleAndYear(input);
  check(
    `splits ${JSON.stringify(input)}`,
    got.title === wantTitle && got.year === wantYear,
    JSON.stringify(got),
  );
}

// --- Playable-file selection -------------------------------------------------
// The h.264 derivative is preferred: it is transcoded for browsers and far
// smaller than the uploaded original.
check('prefers an h.264 derivative', /format.*includes\('h\.264'\)/.test(source));
check('skips files flagged as originals', /original/i.test(source));
check('only accepts mp4 files', /\.mp4\$/i.test(source.replace(/\\\\/g, '\\')));
check('download URL is percent-encoded', /encodeURIComponent\(playable\.name\)/.test(source));
check('requests a range-capable direct file', /archive\.org\/download/.test(source));

// --- Licence reporting -------------------------------------------------------
// An item with no stated rights must not be presented as free.
check('reads the rights field', /meta\.rights/.test(source));
check('reads licenceurl', /licenseurl/.test(source));
check(
  'detects Creative Commons by licence URL',
  /creativecommons\\?\.org/.test(source) && /key:\s*'cc'/.test(source),
);
check('has an explicit unstated state', /key:\s*'unstated'/.test(source));
check('unstated is not treated as public domain', /key:\s*'unstated'[\s\S]{0,40}label:\s*'Licence not stated'/.test(source));

// --- Resiliency --------------------------------------------------------------
check('metadata fetch has a timeout', /AbortController/.test(source));
check('a failed fetch resolves instead of throwing', /catch\s*\{\s*return null/.test(source));
check('search falls back to a default collection', /DEFAULT_QUERY/.test(source));
check('candidates are de-duplicated', /!items\.has\(item\.identifier\)/.test(source));

// --- What must not happen ---------------------------------------------------
check('does not invent a stream host', !/megaload|123movies|vid\.cc|streamtape/.test(source));
check('uses only archive.org endpoints', !new RegExp('https://(?!archive\\.org)').test(source));

console.log(
  failed === 0 ? '\nArchive resolver behaves as expected.' : `\n${failed} resolver check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);