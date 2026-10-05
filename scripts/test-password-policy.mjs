// Unit checks for the password policy. Run: node scripts/test-password-policy.mjs
import { passwordProblem } from '../worker/ratelimit.js';

let failed = 0;

const REJECT = [
  ['aaaaaaaaaa', 'repeating one character'],
  ['12345678aa', 'digits only'],
  ['short1A', 'too short'],
  ['password123', 'contains "password"'],
  ['qwertyuiop1', 'keyboard run'],
  ['mypassword1A', 'contains "password"'],
  ['PASSWORD123', 'uppercase run without a lowercase'],
  ['abcdefghij12', 'no uppercase'],
  ['NoDigitsHere', 'no digit'],
];

// The policy requires one lowercase, one capital and one digit. It does not
// demand two of each, so a single capital in an otherwise lowercase password is
// accepted. These cases pin that boundary down on purpose: if someone later
// tightens the policy, these should start failing loudly rather than silently.
const ACCEPT = [
  'CorrectHorse9',
  'Str0ngEnough',
  'Tidefall2026',
  'bake-MyKite42',
  'aB3xY9zQw1', // exactly at the 10 character minimum
  'aA00000000', // one capital, one lowercase, rest digits
];

for (const [pw, why] of REJECT) {
  const problem = passwordProblem(pw);
  if (!problem) {
    failed++;
    console.log(`FAIL  accepted a weak password (${why}): ${JSON.stringify(pw)}`);
  } else {
    console.log(`ok   rejects ${JSON.stringify(pw)} -> ${problem}`);
  }
}

for (const pw of ACCEPT) {
  const problem = passwordProblem(pw);
  if (problem) {
    failed++;
    console.log(`FAIL  rejected a good password: ${JSON.stringify(pw)} -> ${problem}`);
  } else {
    console.log(`ok   accepts ${JSON.stringify(pw)}`);
  }
}

// The length boundary, and inputs that could trip the regexes.
const EDGE = [
  ['', 'empty'],
  ['   ', 'whitespace only'],
  ['aB3xY9zQw', '9 characters, one short of the minimum'],
  ['abcdefghij', '10 lowercase letters, no capital'],
  ['ABCDEFGHIJ', '10 uppercase letters, no lowercase'],
  ['0123456789', '10 digits, no letters'],
  ['a'.repeat(500), 'absurdly long'],
];
for (const [pw, why] of EDGE) {
  const problem = passwordProblem(pw);
  if (!problem) {
    failed++;
    console.log(`FAIL  accepted ${why}`);
  } else {
    console.log(`ok   rejects ${why} -> ${problem}`);
  }
}

console.log(failed === 0 ? '\nPassword policy behaves as expected.' : `\n${failed} policy check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);