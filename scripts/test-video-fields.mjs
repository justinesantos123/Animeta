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

/**
 * A comment-free copy of the file for structural counting.
 *
 * The bind lists carry trailing comments naming each column, and a naive
 * argument count treats the words after a comma as the start of a new argument.
 * Comments are blanked rather than stripped so offsets stay usable.
 */
const code = api.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) =>
  ' '.repeat(m.length),
);

/**
 * Counts the top-level arguments of a .bind(...) call.
 *
 * Counts commas at nesting depth zero, so an argument which is itself a call
 * with a comma inside it — Number(a ?? 0), a || null — is not miscounted. This is
 * the count that actually throws when it is wrong.
 */
function countBinds(source, fromIndex) {
  const start = source.indexOf('(', fromIndex);
  let depth = 0;
  let args = 0;
  let sawContent = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') { depth++; if (depth === 1) { sawContent = false; continue; } }
    if (ch === ')') { depth--; if (depth === 0) { if (sawContent) args++; return args; } }
    if (depth === 1) {
      if (ch === ',') { if (sawContent) args++; sawContent = false; continue; }
      if (!/\s/.test(ch)) sawContent = true;
    }
  }
  return args;
}

/** The text inside the parentheses that open at `open`, matching the close. */
function insideParens(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return '';
}

/**
 * Scans every `INSERT INTO titles` and checks the three counts agree.
 *
 * Deliberately a scanner rather than a regex: two handlers write this statement
 * with different line breaks, and a pattern that matched only one of them passed
 * happily while the other was broken.
 */
{
  let found = 0;
  let at = 0;
  for (;;) {
    const start = code.indexOf('INSERT INTO titles', at);
    if (start === -1) break;
    at = start + 1;

    const columns = insideParens(code, code.indexOf('(', start))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const valuesAt = code.indexOf('VALUES', start);
    if (valuesAt === -1) continue;
    const placeholders = (insideParens(code, code.indexOf('(', valuesAt)).match(/\?/g) || []).length;

    const bindAt = code.indexOf('.bind(', valuesAt);
    const binds = bindAt === -1 ? -1 : countBinds(code, bindAt + '.bind'.length);

    found++;
    check(
      `INSERT INTO titles #${found}: columns, placeholders and binds agree`,
      columns.length === placeholders && placeholders === binds,
      `${columns.length} cols, ${placeholders} placeholders, ${binds} binds`,
    );
  }

  // More than one, because a second writer of this statement is the whole risk.
  check('found every titles INSERT, and there is more than one', found >= 2, `${found} found`);
}

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
