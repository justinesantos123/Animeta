// Unit tests for TMDB/IMDb id parsing and metadata normalisation.
// Run: node scripts/test-tmdb-lookup.mjs
//
// The live lookup needs an API key, so the shape conversions are tested here
// and the network path is covered by test-tmdb-lookup.test.mjs against a stub.
import { parseExternalId } from '../worker/tmdb.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// --- Accepted forms ---------------------------------------------------------
const ACCEPT = [
  ['969681', 'tmdb', '969681', 'bare TMDB id'],
  ['  969681  ', 'tmdb', '969681', 'padded with whitespace'],
  ['tt0133093', 'imdb', 'tt0133093', 'bare IMDb id'],
  ['TT0133093', 'imdb', 'tt0133093', 'IMDb id is lowercased'],
  ['https://www.themoviedb.org/movie/550', 'tmdb', '550', 'TMDB movie URL'],
  ['https://www.themoviedb.org/tv/1399', 'tmdb', '1399', 'TMDB tv URL'],
  ['themoviedb.org/movie/550', 'tmdb', '550', 'TMDB URL without scheme'],
  ['https://www.imdb.com/title/tt0137523/', 'imdb', 'tt0137523', 'IMDb URL with trailing slash'],
  ['https://www.imdb.com/title/tt0137523/?ref_=hm', 'imdb', 'tt0137523', 'IMDb URL with query'],
];

for (const [input, source, id, why] of ACCEPT) {
  const got = parseExternalId(input);
  check(`accepts ${why}`, got.source === source && got.id === id, JSON.stringify(got));
}

// --- Rejected forms ---------------------------------------------------------
const REJECT = [
  ['', 'empty input'],
  ['   ', 'whitespace only'],
  ['abc', 'a word'],
  ['tt123', 'IMDb id that is too short'],
  ['12.34', 'a decimal'],
  ['969681 550', 'two ids'],
  ['<script>', 'markup'],
  ['-969681', 'a negative number'],
];

for (const [input, why] of REJECT) {
  const got = parseExternalId(input);
  check(`rejects ${why}`, Boolean(got.error), JSON.stringify(got));
}

console.log(
  failed === 0 ? '\nTMDB id parsing behaves as expected.' : `\n${failed} parsing check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);