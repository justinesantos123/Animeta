/**
 * Staff permissions, and the account deletion window.
 *
 * Roles and permissions answer different questions and are deliberately kept
 * apart:
 *
 *   role        Which surfaces the UI offers. user < moderator < admin.
 *   permission  What a moderator may actually do while in the staff console.
 *
 * A moderator therefore has no permissions by default, and the staff console
 * shows them the tabs they can act in rather than everything and then refusing
 * at the API. Admins are not listed here: they hold every permission implicitly,
 * so the set of rows in user_permissions only ever matters for moderators.
 */

// Permission ids. Seeded into the permissions table so grants are referential,
// and re-exported here as the single source of truth for the code.
export const PERMISSIONS = {
  CATALOG: 'catalog',
  ANNOUNCEMENTS: 'announcements',
  NOTIFICATIONS: 'notifications',
  USERS: 'users',
  // Uploading is its own permission rather than part of `catalog`.
  //
  // A moderator who can add titles is not automatically someone who should be
  // able to put a file on the server: uploading costs storage, bandwidth and
  // moderation attention, and is the part most likely to be abused or used to
  // publish something that should not be there. Splitting it means the admin
  // decides who publishes, independently of who edits metadata.
  //
  // Admins hold it implicitly, as with everything else.
  UPLOAD: 'upload',
};

export const PERMISSION_IDS = Object.values(PERMISSIONS);

/**
 * Recovery window for a deleted account.
 *
 * A deleted account can be restored with this many days remaining; past the
 * window it is destroyed permanently and cannot be recovered by anyone,
 * including staff. 7 is the last day restoration is allowed, so "8 days or
 * more" means gone.
 */
export const RESTORE_WINDOW_DAYS = 7;

/** Days a deleted account is kept before the row is destroyed for good. */
export const PURGE_AFTER_DAYS = 8;

const MS_PER_DAY = 86400000;

/**
 * Parses a stored SQLite timestamp.
 *
 * D1 hands back `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC with no zone
 * marker, and `new Date` on that string reads it as local time. Appending Z is
 * what makes it UTC again; without it every timestamp drifts by the server's
 * offset, which on this deployment would be hours.
 */
export function parseSqlDate(value) {
  if (!value) return null;
  const text = String(value);
  const iso = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** "YYYY-MM-DD HH:MM:SS" in UTC, the format D1 stores. */
export function sqlTimestamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Whole days left in the recovery window, for display.
 *
 * Capped at RESTORE_WINDOW_DAYS rather than reporting the raw distance to the
 * purge deadline. The row is made purgeable 8 days out so that "deleted 7 days
 * ago" is still restorable, which means the raw distance starts at 8; showing
 * "8 days left" on the day somebody deletes their account would contradict the
 * 7 days the policy promises.
 *
 * Floored rather than rounded up: an account with six hours left reads as 0,
 * never as 1, because rounding up would promise a day that is not there.
 *
 * Returns null when the account was never deleted, and 0 once the window has
 * closed. Zero rather than a negative, since a negative would leak how far past
 * the deadline it is.
 */
export function restoreDaysLeft(deletedAt, purgeAfter, now = Date.now()) {
  if (!deletedAt) return null;
  const deadline = parseSqlDate(purgeAfter);
  if (deadline === null) return 0;
  const ms = deadline - now;
  if (ms <= 0) return 0;
  return Math.min(RESTORE_WINDOW_DAYS, Math.floor(ms / MS_PER_DAY));
}

/**
 * True while the account may still be restored.
 *
 * This is "before the purge deadline" rather than "days left is above zero", so
 * that an account in its final hours is still restorable even though there is
 * no whole day left to report.
 */
export function isRestorable(deletedAt, purgeAfter, now = Date.now()) {
  if (!deletedAt) return false;
  const deadline = parseSqlDate(purgeAfter);
  if (deadline === null) return false;
  return now < deadline;
}

/**
 * True when a deleted account has outlived its window and must be destroyed.
 *
 * Runs lazily on login and on the staff listing rather than from a cron, since
 * this Worker has no scheduled handler. The consequence is that an untouched
 * account can linger in D1 past its deadline until somebody signs in; that is
 * a storage cost, not a privacy failure, because the account is already
 * unusable. The scheduled trigger is the right fix and is not built.
 */
export function isPurgeable(deletedAt, purgeAfter, now = Date.now()) {
  if (!deletedAt) return false;
  const deadline = parseSqlDate(purgeAfter);
  if (deadline === null) return true;
  return now >= deadline;
}

/**
 * Resolves what a signed-in account is allowed to do.
 *
 * Admins hold everything implicitly, which is checked first so an admin is
 * never locked out by a missing grant row. Moderators hold exactly what has
 * been granted. Regular users hold nothing here.
 */
export function resolvePermissions(role, granted) {
  if (role === 'admin') {
    return { all: true, set: new Set(PERMISSION_IDS) };
  }
  if (role !== 'moderator') {
    return { all: false, set: new Set() };
  }
  return { all: false, set: new Set(granted) };
}

/** Loads a user's granted permissions and resolves them against their role. */
export async function loadPermissions(env, user) {
  if (user.role === 'admin') {
    return { all: true, set: new Set(PERMISSION_IDS) };
  }
  if (user.role !== 'moderator') {
    return { all: false, set: new Set() };
  }
  const { results } = await env.DB.prepare(
    'SELECT permission FROM user_permissions WHERE user_id = ?',
  )
    .bind(user.id)
    .all();
  // Filtered against the known set: a row for a permission that has since been
  // removed from the catalogue must not become a grant that nothing checks.
  return resolvePermissions('moderator', results.map((r) => r.permission).filter((id) =>
    PERMISSION_IDS.includes(id),
  ));
}

// The requirePermission gate itself lives in api.js, next to requireAdmin and
// requireStaff, because it needs the same session lookup. Keeping it there means
// all three gates read as one line at each call site and there is no
// api.js <-> permissions.js import cycle.