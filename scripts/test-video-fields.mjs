// Checks that every branch of normaliseVideo returns the same key set.
//
// It lives in api.js as a private function, so this reads the source and
// verifies the shape rather than calling it. The bug this exists for was a
// branch missing a key, which bound undefined positionally and made D1 throw a
// 500 for that input shape only.
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../worker/api.js', import.meta.url), 'utf8');

let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const start = api.indexOf('async function normaliseVideo');
// The function ends at the next top-level declaration, not at a fixed line: any
// other bound would sweep in unrelated `return { ... }` statements.
const rest = api.slice(start);
const endOffset = rest.slice(1).search(/\n(?:async )?function \w/);
const fn = endOffset === -1 ? rest : rest.slice(0, endOffset + 1);
check('found normaliseVideo', start !== -1 && fn.length > 50, `${fn.length} chars`);

// Each branch's returned object literal.
const returns = [...fn.matchAll(/return\s*\{([\s\S]*?)\n\s*\};/g)].map((m) => m[1]);

const KEYS = ['video_kind', 'embed_provider', 'embed_id', 'video_url', 'upload_id'];

check('found every return', returns.length === 3, `${returns.length} returns`);

for (const [i, body] of returns.entries()) {
  const missing = KEYS.filter((k) => !new RegExp(`\\b${k}:`).test(body));
  check(
    `return ${i + 1} sets every key`,
    missing.length === 0,
    `missing: ${missing.join(', ') || 'none'}`,
  );
}

// The INSERT is positional, so the column count and the placeholder count have
// to agree. They drifted once already, which broke every title post.
const insertStart = api.indexOf('INSERT INTO titles');
const insertEnd = api.indexOf('INSERT INTO playback_records');
const insert = api.slice(insertStart, insertEnd);

const open = insert.indexOf('(');
const close = insert.indexOf(')');
const cols = insert.slice(open + 1, close).split(',').map((s) => s.trim()).filter(Boolean);
const valuesClause = insert.slice(insert.indexOf('VALUES'), insert.indexOf('.bind('));
const ph = (valuesClause.match(/\?/g) || []).length;
check('placeholders match the column count', cols.length === ph, `${cols.length} cols, ${ph} placeholders`);

const binds = insert.slice(insert.indexOf('.bind('));
const boundKeys = [...binds.matchAll(/(?:video|next)\.(\w+)/g)].map((m) => m[1]);
const videoBound = new Set(boundKeys.filter((k) => KEYS.includes(k)));
check(
  'every video field is bound',
  KEYS.every((k) => videoBound.has(k)),
  KEYS.filter((k) => !videoBound.has(k)).join(', ') || 'all present',
);

console.log(
  failed === 0
    ? '\nVideo normalisation is consistent.'
    : `\n${failed} video field check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
