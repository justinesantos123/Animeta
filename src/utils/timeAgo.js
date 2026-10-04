/**
 * Relative time formatting for activity timestamps.
 *
 * Accepts both ISO-8601 and the "YYYY-MM-DD HH:MM:SS" shape that SQLite's
 * datetime('now') produces, which has no timezone marker and is UTC.
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const raw = String(value).trim();
  // SQLite form: treat as UTC by appending Z after converting the space to T.
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

/**
 * "just now" -> "1 min ago" -> "3 hours ago" -> "2 days ago"
 * -> "3 weeks ago" -> "2 months ago" -> "1 year ago"
 */
export function timeAgo(value, { fallback = 'never' } = {}) {
  const date = toDate(value);
  if (!date) return fallback;

  const ms = Date.now() - date.getTime();
  // Clock skew or a future timestamp should not read as "-3 mins ago".
  if (ms < 0) return 'just now';
  if (ms < MINUTE) return 'just now';

  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'min');
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour');
  if (ms < WEEK) return plural(Math.floor(ms / DAY), 'day');
  if (ms < MONTH) return plural(Math.floor(ms / WEEK), 'week');
  if (ms < YEAR) return plural(Math.floor(ms / MONTH), 'month');
  return plural(Math.floor(ms / YEAR), 'year');
}

/** Short form for dense table cells: "4m", "3h", "2d", "5w", "3mo". */
export function timeAgoShort(value, { fallback = '—' } = {}) {
  const date = toDate(value);
  if (!date) return fallback;

  const ms = Date.now() - date.getTime();
  if (ms < 0) return 'now';
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d`;
  if (ms < MONTH) return `${Math.floor(ms / WEEK)}w`;
  if (ms < YEAR) return `${Math.floor(ms / MONTH)}mo`;
  return `${Math.floor(ms / YEAR)}y`;
}
