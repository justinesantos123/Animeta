/**
 * Username derivation, for staff-created accounts with no username supplied.
 *
 * Run: node scripts/test-derive-username.mjs
 *
 * Deriving a handle skipped the reserved list while signup and the profile page
 * both enforce it, so an account created from staff@, help@ or admin@ silently
 * ended up holding a name that no member is allowed to pick. That is a
 * correctness bug, not a cosmetic one: @admin reading as a member would be
 * mistaken for the site.
 */
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../worker/api.js', import.meta.url), 'utf8');

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

// The reserved set, read out of the module so this cannot drift from it.
const reservedBlock = api.slice(api.indexOf('const RESERVED_USERNAMES'), api.indexOf(']);', api.indexOf('const RESERVED_USERNAMES')));
const reserved = [...reservedBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);

check('the reserved list was found', reserved.length >= 10, reserved.join(', '));
check(
  'the words that matter here are all reserved',
  ['admin', 'staff', 'help', 'support', 'moderator', 'root', 'system', 'api', 'me', 'www'].every((w) =>
    reserved.includes(w),
  ),
  reserved.filter((w) => !['admin', 'staff', 'help', 'support', 'moderator', 'root', 'system', 'api', 'me', 'www'].includes(w)).join(', '),
);

// The derivation must consult the reserved list, both on the first candidate and
// on each retry.
const derive = api.slice(
  api.indexOf('async function deriveUsername'),
  api.indexOf('function validPassword'),
);

check('derivation checks the reserved list', /RESERVED_USERNAMES\.has\(candidate\)/.test(derive));
const reservedChecks = (derive.match(/RESERVED_USERNAMES\.has\(candidate\)/g) || []).length;
check(
  'the retry path checks it too, not just the first candidate',
  reservedChecks >= 2,
  `${reservedChecks} check(s)`,
);
check(
  'a reserved first candidate gets a suffix rather than being returned',
  /if \(RESERVED_USERNAMES\.has\(candidate\)\) \{\s*\n\s*candidate = `\$\{candidate\}\$\{randomHex\(2\)\}`;/.test(derive),
);

// Uniqueness must still hold: the reserved check must not replace the taken check.
check('the taken check still runs', /SELECT 1 AS x FROM users WHERE lower\(username\) = lower\(\?\)/.test(derive));

// And the paths that *do* validate must still reject reserved names outright, so
// the fix is additive rather than a relaxation.
check('signup still rejects a reserved username', /RESERVED_USERNAMES\.has\(username\.toLowerCase\(\)\)/.test(api));

console.log('');
if (failed) {
  console.log(`${failed} derivation check(s) failed.`);
  process.exit(1);
}
console.log('Derived usernames cannot be reserved names.');