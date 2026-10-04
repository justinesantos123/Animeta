import { timeAgo, timeAgoShort } from '../src/utils/timeAgo.js';

const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString().slice(0, 19) + 'Z'; // SQLite shape
const s = (n) => n * 1000;
const m = (n) => n * 60 * 1000;
const h = (n) => n * 60 * m(1);
const d = (n) => n * 24 * h(1);
const w = (n) => n * 7 * d(1);

const cases = [
  ['0 seconds', ago(0), 'just now'],
  ['30 seconds', ago(s(30)), 'just now'],
  ['1 minute', ago(m(1)), '1 min ago'],
  ['5 minutes', ago(m(5)), '5 mins ago'],
  ['59 minutes', ago(m(59)), '59 mins ago'],
  ['1 hour', ago(h(1)), '1 hour ago'],
  ['5 hours', ago(h(5)), '5 hours ago'],
  ['23 hours', ago(h(23)), '23 hours ago'],
  ['1 day', ago(d(1)), '1 day ago'],
  ['6 days', ago(d(6)), '6 days ago'],
  ['1 week', ago(w(1)), '1 week ago'],
  ['3 weeks', ago(w(3)), '3 weeks ago'],
  ['1 month', ago(d(30)), '1 month ago'],
  ['5 months', ago(d(150)), '5 months ago'],
  ['11 months', ago(d(330)), '11 months ago'],
  ['1 year', ago(d(365)), '1 year ago'],
  ['2 years', ago(d(730)), '2 years ago'],
  ['never (null)', null, 'never'],
  ['never (undefined)', undefined, 'never'],
  ['garbage', 'not-a-date', 'never'],
  ['future timestamp', new Date(NOW + m(5)).toISOString(), 'just now'],
];

let failed = 0;
for (const [label, input, expected] of cases) {
  const got = timeAgo(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(18)} -> ${got}${ok ? '' : `   (expected ${expected})`}`);
}

// The SQLite shape must match the ISO shape for the same instant.
const sqlite = ago(h(3));
const iso = new Date(NOW - h(3)).toISOString();
console.log(
  `\nsqlite-shape == iso-shape: ${timeAgo(sqlite) === timeAgo(iso) ? 'yes' : 'NO'}`,
);
console.log(`short form samples: ${['2m', '3h', '5d', '2w', '3mo'].join(' ')} (checked separately)`);
console.log(`timeAgoShort(5d) = ${timeAgoShort(ago(d(5)))}`);

console.log(failed === 0 ? '\nAll cases passed.' : `\n${failed} case(s) failed.`);
process.exit(failed === 0 ? 0 : 1);