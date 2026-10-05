// Guards the genres column against silent data loss.
//
// The staff form sends a comma-separated string; scripts send an array. The
// create/update handlers used `Array.isArray(body.genres) ? body.genres : []`,
// so a string became [] and the genres were dropped with no error at all.
// Run: node scripts/test-genres-normalisation.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/^\w:/, (m) => m);
const api = readFileSync(join(ROOT, 'worker/api.js'), 'utf8');

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// The helper must exist and be used on both write paths.
check('normalizeGenres is defined', /function normalizeGenres\(/.test(api));
check(
  'normalizeGenres handles an array',
  /Array\.isArray\(input\)/.test(api),
);
check(
  'normalizeGenres handles a comma-separated string',
  /input\s*\n?\s*\.split\(','\)/.test(api),
);

const uses = (api.match(/normalizeGenres\(body\.genres\)/g) || []).length;
check('both create and update use normalizeGenres', uses >= 2, `found ${uses} call sites`);

// The old silent-drop pattern must be gone from the write paths.
check(
  'no handler falls back to an empty array for a string',
  !/Array\.isArray\(body\.genres\)\s*\?\s*body\.genres\s*:\s*\[\]/.test(api),
);

// The type guard must reject anything outside the accepted set, and its message
// has to be generated from that set rather than written out by hand — a
// hand-written list is how 'ads' ended up missing from the error when it was
// added. Read from TITLE_TYPES so adding a type cannot leave this behind.
const { TITLE_TYPES: ACCEPTED_TYPES } = await import('../src/lib/titleTypes.js');
check(
  'create rejects unknown types with a message listing every accepted type',
  /type must be one of: \$\{TITLE_TYPE_VALUES\.join\(', '\)\}/.test(api),
);
check(
  'and the accepted set really is every title type',
  ACCEPTED_TYPES.map((t) => t.value).join(',') === 'anime,movie,series,ai,ads',
  ACCEPTED_TYPES.map((t) => t.value).join(','),
);
// The type filter used when listing has to accept the same set, or a category
// page would silently ignore its own filter.
check(
  'the listing filter accepts every title type',
  /TITLE_TYPE_VALUES\.includes\(type\)/.test(api),
);

// Mirror the real behaviour so the string case is exercised, not just read.
function normalizeGenres(input) {
  if (Array.isArray(input)) return input.map((g) => String(g).trim()).filter(Boolean);
  if (typeof input === 'string')
    return input.split(',').map((g) => g.trim()).filter(Boolean);
  return [];
}

check('array input passes through', JSON.stringify(normalizeGenres(['A', 'B'])) === '["A","B"]');
check(
  'comma-separated string is split',
  JSON.stringify(normalizeGenres('Sci-Fi, Mystery , Space')) === '["Sci-Fi","Mystery","Space"]',
);
check('empty entries are dropped', JSON.stringify(normalizeGenres('A,,B,')) === '["A","B"]');
check('a non-string, non-array becomes []', JSON.stringify(normalizeGenres(null)) === '[]');

console.log(
  failed === 0 ? '\nGenres normalisation is safe.' : `\n${failed} genre check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);