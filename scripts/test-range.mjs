// Unit tests for Range header parsing.
// Run: node scripts/test-range.mjs
//
// Extracted so it can be tested directly: the function is a pure string parser
// and it guards seeking, which is impossible to verify from a screenshot.
import { handleRangeForTest as parseRange } from '../worker/api.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function shape(r) {
  return JSON.stringify(r);
}

// --- The everyday cases a <video> element sends -----------------------------
check('a bounded range', shape(parseRange('bytes=0-1023')) === '{"start":0,"end":1023}', shape(parseRange('bytes=0-1023')));
check('an open-ended range', shape(parseRange('bytes=1024-')) === '{"start":1024}', shape(parseRange('bytes=1024-')));

// A suffix range is how a player asks for "the last N bytes", used to read a
// trailer's duration without fetching the whole file.
check('a suffix range', shape(parseRange('bytes=-500')) === '{"suffix":500}', shape(parseRange('bytes=-500')));

// --- Refusals ---------------------------------------------------------------
// Anything not understood returns undefined, which R2 reads as "serve the whole
// object". That is the safe direction: a malformed range degrades to a full
// response rather than to a wrong slice of someone else's video.
const REFUSE = [
  ['no bytes prefix', '0-1023'],
  ['a nonsense unit', 'bytes=abc-def'],
  ['a completely different header', 'items=0-10'],
  ['empty on both sides', 'bytes=-'],
  ['a non-numeric range', 'bytes=abc-def'],
  ['a negative start', 'bytes=--100'],
  ['empty', ''],
];
for (const [label, header] of REFUSE) {
  check(`refuses ${label}`, parseRange(header) === undefined, shape(parseRange(header)));
}

// A reversed range asks for a slice that begins after it ends, which is not a
// request for bytes at all. Serving "500 to the end of the object" instead would
// return far more than was asked for and more than a player can use, so it is
// rejected rather than widened.
check('refuses an end before the start', parseRange('bytes=500-100') === undefined, shape(parseRange('bytes=500-100')));

// A zero suffix length is not a request for bytes.
check('refuses a zero suffix', parseRange('bytes=-0') === undefined, shape(parseRange('bytes=-0')));

// --- Multi-range ------------------------------------------------------------
// Browsers do not send these, and R2's single-range API cannot express them.
// Parsing the first range keeps seeking working for a player that asks anyway,
// rather than failing the whole seek.
check('uses the first range of a multi-range request', shape(parseRange('bytes=0-99,200-299')) === '{"start":0,"end":99}', shape(parseRange('bytes=0-99,200-299')));

console.log(
  failed === 0
    ? '\nRange parsing behaves as expected.'
    : `\n${failed} range check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);