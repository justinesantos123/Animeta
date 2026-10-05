// Unit tests for staff permissions and the account deletion window.
// Run: node scripts/test-permissions.mjs
//
// Two things here are easy to get subtly wrong, so they are pinned by tests:
//
//   1. Role and permission are separate axes. A moderator must end up with
//      exactly what was granted and nothing else, and an admin must never be
//      lockable out by a missing grant row.
//   2. The recovery window is stated as "7 days to restore, 8 and above is
//      permanent". Off-by-one either way either destroys an account somebody
//      could still have restored, or keeps a "deleted" account alive past the
//      point it was promised to be gone.
import {
  PERMISSION_IDS,
  PERMISSIONS,
  RESTORE_WINDOW_DAYS,
  PURGE_AFTER_DAYS,
  parseSqlDate,
  sqlTimestamp,
  restoreDaysLeft,
  isRestorable,
  isPurgeable,
  resolvePermissions,
} from '../worker/permissions.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

/** "N days before now", as D1 would have stored it. */
function daysAgo(n) {
  return sqlTimestamp(NOW - n * DAY);
}

/** Builds the pair a soft-deleted account would have. */
function deleted(daysSinceDelete, windowDays = PURGE_AFTER_DAYS) {
  const deletedAt = daysAgo(daysSinceDelete);
  const purgeAfter = sqlTimestamp(new Date(parseSqlDate(deletedAt) + windowDays * DAY));
  return { deletedAt, purgeAfter };
}

// --- Timestamp handling ------------------------------------------------------
// D1 returns "YYYY-MM-DD HH:MM:SS" with no zone marker. Reading that as local
// time shifts every deadline by the server offset, so this is the foundation
// the whole window calculation rests on.
{
  const stored = '2026-01-15 12:00:00';
  check('a stored timestamp parses as UTC', parseSqlDate(stored) === Date.UTC(2026, 0, 15, 12));
  check('null parses to null', parseSqlDate(null) === null);
  check('undefined parses to null', parseSqlDate(undefined) === null);
  check('nonsense parses to null', parseSqlDate('not a date') === null);
  check(
    'an ISO timestamp with Z still parses',
    parseSqlDate('2026-01-15T12:00:00.000Z') === Date.UTC(2026, 0, 15, 12),
  );
}
check(
  'sqlTimestamp round-trips',
  sqlTimestamp(Date.UTC(2026, 0, 15, 12, 0, 0)) === '2026-01-15 12:00:00',
  sqlTimestamp(Date.UTC(2026, 0, 15, 12, 0, 0)),
);

// --- Permission catalogue ----------------------------------------------------
check('the catalogue has five permissions', PERMISSION_IDS.length === 5, String(PERMISSION_IDS.length));
for (const id of ['catalog', 'announcements', 'notifications', 'users', 'upload']) {
  check(`catalogue contains ${id}`, PERMISSION_IDS.includes(id));
}
check('ids are unique', new Set(PERMISSION_IDS).size === PERMISSION_IDS.length);
check('PERMISSIONS maps to the same set', Object.keys(PERMISSIONS).length === 5);

// --- Upload is its own permission, not part of the catalog --------------------
// The whole point of splitting these: a moderator who can add titles must not
// thereby gain the ability to put a file on the server.
check('upload is separate from catalog', PERMISSIONS.UPLOAD !== PERMISSIONS.CATALOG);
{
  const p = resolvePermissions('moderator', ['catalog']);
  check('catalog does not imply upload', p.set.has('catalog') && !p.set.has('upload'));
}
{
  const p = resolvePermissions('moderator', ['upload']);
  check('upload alone does not imply catalog', p.set.has('upload') && !p.set.has('catalog'));
}
{
  const p = resolvePermissions('admin', []);
  check('an admin holds upload implicitly', p.set.has('upload'));
}
{
  // A regular account must never be able to upload, however it is asked.
  const p = resolvePermissions('user', ['upload']);
  check('a regular user cannot hold upload', p.set.size === 0 && !p.all);
}

// --- Admins hold everything, implicitly --------------------------------------
{
  const p = resolvePermissions('admin', []);
  check('an admin with no grant rows still holds everything', p.all && p.set.size === PERMISSION_IDS.length);
}
{
  // The important one: a missing row must not restrict an admin. If this ever
  // regresses, an admin could revoke their own access to the console.
  const p = resolvePermissions('admin', ['catalog']);
  check('an admin is not restricted by a partial grant', p.set.has('notifications'));
}

// --- Moderators hold exactly what was granted --------------------------------
{
  const p = resolvePermissions('moderator', ['catalog']);
  check('a moderator with catalog has it', p.set.has(PERMISSIONS.CATALOG));
  check('a moderator with catalog has nothing else', p.set.size === 1, JSON.stringify([...p.set]));
  check('a moderator is never all-powerful', p.all === false);
}
{
  const p = resolvePermissions('moderator', []);
  check('a moderator with no grants has none', p.set.size === 0);
}
{
  // loadPermissions filters against the known set, so simulate that here: this is
  // what protects against a row for a permission that no longer exists.
  const stale = ['catalog', 'permission-that-was-removed'];
  const p = resolvePermissions('moderator', stale.filter((id) => PERMISSION_IDS.includes(id)));
  check('a grant for an unknown permission is dropped', p.set.size === 1 && p.set.has('catalog'));
}
{
  const p = resolvePermissions('user', ['catalog', 'users']);
  check('a regular user never holds permissions', p.set.size === 0 && !p.all);
}
{
  const p = resolvePermissions(undefined, ['catalog']);
  check('a missing role holds nothing', p.set.size === 0);
}

// --- The window constants ----------------------------------------------------
// "restore if 7 days ago, permanent if 8 or more" only holds if the purge
// deadline is 8 days out, not 7.
check('the restore window is 7 days', RESTORE_WINDOW_DAYS === 7);
check('the purge deadline is 8 days', PURGE_AFTER_DAYS === 8);
check(
  'the purge deadline is one day past the restore window',
  PURGE_AFTER_DAYS === RESTORE_WINDOW_DAYS + 1,
);

// --- Days remaining ----------------------------------------------------------
check('an account never deleted reports null', restoreDaysLeft(null, null, NOW) === null);
{
  // Capped at 7, not the raw 8-day distance to the purge deadline: the policy
  // says 7 days, so saying "8 days left" on the day of deletion contradicts it.
  const { deletedAt, purgeAfter } = deleted(0);
  check('just deleted shows 7 days, not 8', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 7, String(restoreDaysLeft(deletedAt, purgeAfter, NOW)));
}
{
  const { deletedAt, purgeAfter } = deleted(1);
  check('1 day in still shows 7 days', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 7);
}
{
  // 6 days elapsed of an 8-day window leaves 2 whole days.
  const { deletedAt, purgeAfter } = deleted(6);
  check('6 days in, 2 days left', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 2, String(restoreDaysLeft(deletedAt, purgeAfter, NOW)));
}
{
  // The last moment the user can retrieve it, per the stated rule: deleted 7
  // days ago is still restorable.
  const { deletedAt, purgeAfter } = deleted(7);
  check('exactly 7 days in it is still restorable', isRestorable(deletedAt, purgeAfter, NOW) === true);
  check('with 1 day left to restore', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 1);
}
{
  const { deletedAt, purgeAfter } = deleted(8);
  check('8 days in, reported as 0 rather than negative', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 0, String(restoreDaysLeft(deletedAt, purgeAfter, NOW)));
  check('8 days in, no longer restorable', isRestorable(deletedAt, purgeAfter, NOW) === false);
}
{
  // 12h left must read as 0 days, not 1. Rounding up is how a countdown
  // promises a day that is not there, and then the page lies about an account
  // that has already been destroyed.
  const { deletedAt, purgeAfter } = deleted(0, 0.5);
  check('half a day left reads as 0 days', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 0, String(restoreDaysLeft(deletedAt, purgeAfter, NOW)));
  check('but is still restorable', isRestorable(deletedAt, purgeAfter, NOW) === true);
}
{
  // The cap must not become a ceiling on the truth: 7.5 days of window still
  // reports the full 7, because the policy promises 7 and no more.
  const { deletedAt, purgeAfter } = deleted(0, 7.5);
  check('a window longer than the policy still caps at 7', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 7);
}
check('an account with no stored deadline reports 0', restoreDaysLeft(daysAgo(1), null, NOW) === 0);

// --- Restorable --------------------------------------------------------------
{
  const { deletedAt, purgeAfter } = deleted(0);
  check('a fresh deletion is restorable', isRestorable(deletedAt, purgeAfter, NOW) === true);
}
{
  const { deletedAt, purgeAfter } = deleted(6);
  check('a deletion 6 days in is restorable', isRestorable(deletedAt, purgeAfter, NOW) === true);
}
{
  // Fewer than 24h left is still restorable even though there is no whole day
  // left to report. Gating on daysLeft would strand somebody in the final
  // hours of their own window.
  const { deletedAt, purgeAfter } = deleted(7.75, 8);
  check('a few hours left is still restorable', isRestorable(deletedAt, purgeAfter, NOW) === true);
  check('but reports 0 whole days', restoreDaysLeft(deletedAt, purgeAfter, NOW) === 0, String(restoreDaysLeft(deletedAt, purgeAfter, NOW)));
}
check('an account never deleted is not restorable', isRestorable(null, null, NOW) === false);
{
  // A missing purge_after means the row predates the column or was written
  // without one. Treating that as "restorable forever" would make a deletion
  // permanent in name only.
  check('a missing deadline is not restorable', isRestorable(daysAgo(1), null, NOW) === false);
}

// --- Purgeable ---------------------------------------------------------------
check('an account never deleted is not purgeable', isPurgeable(null, null, NOW) === false);
{
  const { deletedAt, purgeAfter } = deleted(7);
  check('7 days in, not yet purgeable', isPurgeable(deletedAt, purgeAfter, NOW) === false);
}
{
  // The boundary the user specified: 8 days and above is permanent.
  const { deletedAt, purgeAfter } = deleted(8);
  check('exactly 8 days in, purgeable', isPurgeable(deletedAt, purgeAfter, NOW) === true);
}
{
  const { deletedAt, purgeAfter } = deleted(30);
  check('30 days in, purgeable', isPurgeable(deletedAt, purgeAfter, NOW) === true);
}
check('a missing deadline is purgeable', isPurgeable(daysAgo(30), null, NOW) === true);

// --- The two paths must not disagree ----------------------------------------
{
  // Anything restorable must not also be purgeable. A row that were both would
  // be restored by one request and destroyed by the next.
  for (const d of [0, 1, 3, 6, 7, 7.5, 8, 20]) {
    const { deletedAt, purgeAfter } = deleted(d);
    const both = isRestorable(deletedAt, purgeAfter, NOW) && isPurgeable(deletedAt, purgeAfter, NOW);
    check(`at ${d} days the two paths do not conflict`, !both);
  }
}

console.log(
  failed === 0
    ? '\nPermissions and the deletion window behave as expected.'
    : `\n${failed} permission check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);