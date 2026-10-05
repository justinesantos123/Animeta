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
const migrationsDir = join(ROOT, 'migrations');
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

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
  // uploads holds the metadata for user-supplied video. The bytes are in R2, so
  // this table is what makes an upload durable and auditable.
  'uploads',
  // Permissions, and the grants that decide what a moderator may do.
  'permissions', 'user_permissions',
];

for (const table of REQUIRED_TABLES) {
  check(`schema.sql declares ${table}`, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(schema));
}

// Every title type the app accepts must pass the CHECK constraint.
//
// The list is written out rather than imported so this test would still fail if
// the module were wrong: the schema and the code are separate things that have
// to agree, and a test that reads its expectations from the code under test
// cannot notice them disagreeing.
for (const type of ['anime', 'movie', 'series', 'ai', 'ads']) {
  check(`titles CHECK allows '${type}'`, new RegExp(`'${type}'`).test(schema));
}

// And the constraint itself, so a fifth type cannot be added in one place only.
check(
  'the CHECK constraint lists all five types',
  /CHECK \(type IN \('anime','movie','series','ai','ads'\)\)/.test(schema),
);
check(
  'a migration adds the ads type',
  migrations.some((f) =>
    /'anime','movie','series','ai','ads'/.test(readFileSync(join(migrationsDir, f), 'utf8')),
  ),
);

// A poster is stored as a key, not as bytes, for the same reason the video is.
check('uploads has a poster key column', /poster_key\s+TEXT/.test(schema));
check(
  'a migration adds uploads.poster_key',
  migrations.some((f) =>
    /ADD COLUMN poster_key/.test(readFileSync(join(migrationsDir, f), 'utf8')),
  ),
);

// Column constraints the code depends on.
check('users.username is NOT NULL', /username\s+TEXT NOT NULL/.test(schema));
check(
  'case-insensitive username index is created',
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users\(lower\(username\)\)/.test(schema),
);

// The migration files must cover each of these, since production was changed by
// hand before the folder existed.
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

// A title's upload pointer must survive the upload being deleted: the catalog row
// is curated and should become video-less, not vanish with the file.
check(
  'titles.upload_id references uploads with ON DELETE SET NULL',
  /upload_id\s+TEXT\s+REFERENCES uploads\(id\)\s+ON DELETE SET NULL/.test(schema),
);

// The upload permission is what keeps ordinary accounts off the upload path, so
// it has to exist in the catalogue and in a migration, or the gate has nothing
// to check against.
check(
  'schema.sql declares the upload permission',
  /\('upload',\s*'Upload video'/.test(schema),
);
check(
  'a migration seeds the upload permission',
  migrations.some((f) => /'upload',\s*'Upload video'/.test(readFileSync(join(migrationsDir, f), 'utf8'))),
);

// An upload belongs to an account, and deleting the account must take its files'
// metadata with it.
check(
  'uploads.user_id references users with ON DELETE CASCADE',
  /user_id\s+TEXT\s+NOT NULL REFERENCES users\(id\)\s+ON DELETE CASCADE/.test(schema),
);

console.log(
  failed === 0 ? '\nSchema and migrations agree.' : `\n${failed} schema check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);