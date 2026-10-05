// Confirms the database and the SQL that is supposed to describe it agree.
// Run: node scripts/test-schema.mjs
//
// The nullable username column shipped with no CREATE INDEX for it in
// schema.sql, so a fresh database had no case-insensitive uniqueness at all
// while production did. Nothing caught that. This compares the two sources.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/^\w:/, (m) => m);
const schema = readFileSync(join(ROOT, 'worker/schema.sql'), 'utf8');

let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

// Tables the code reads must exist in schema.sql.
const REQUIRED_TABLES = [
  'users', 'titles', 'seasons', 'episodes', 'watchlist', 'playback_records',
  'notifications', 'announcements', 'user_activity_days', 'app_settings',
  'admin_action_log', 'password_reset_tokens', 'auth_rate_limits',
];

for (const table of REQUIRED_TABLES) {
  check(`schema.sql declares ${table}`, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(schema));
}

// Every title type the app accepts must pass the CHECK constraint.
for (const type of ['anime', 'movie', 'series', 'ai']) {
  check(`titles CHECK allows '${type}'`, new RegExp(`'${type}'`).test(schema));
}

// Column constraints the code depends on.
check('users.username is NOT NULL', /username\s+TEXT NOT NULL/.test(schema));
check(
  'case-insensitive username index is created',
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users\(lower\(username\)\)/.test(schema),
);

// The migration files must cover each of these, since production was changed by
// hand before the folder existed.
const migrationsDir = join(ROOT, 'migrations');
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
check('migrations folder is populated', migrations.length >= 3);
check(
  'a migration covers users.username',
  migrations.some((f) => /ADD COLUMN username/.test(readFileSync(join(migrationsDir, f), 'utf8'))),
);
check(
  'a migration covers the ai title type',
  migrations.some((f) => /'anime','movie','series','ai'/.test(readFileSync(join(migrationsDir, f), 'utf8'))),
);

// Rate limit storage must exist in both places or a fresh deploy differs from prod.
check(
  'auth_rate_limits declared in schema.sql too',
  /CREATE TABLE IF NOT EXISTS auth_rate_limits/.test(schema),
);

console.log(
  failed === 0 ? '\nSchema and migrations agree.' : `\n${failed} schema check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);