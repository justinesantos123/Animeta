/**
 * Ticket rules: links, lengths, and the phone number.
 *
 * Run: node scripts/test-ticket-rules.mjs
 */
import {
  containsLink,
  validateMessage,
  validateSubject,
  validatePhone,
  MAX_MESSAGE_LENGTH,
} from '../worker/tickets.js';

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

// ---------------------------------------------------------------- link rule
const LINKS = [
  'https://example.com',
  'http://example.com',
  'HTTPS://EXAMPLE.COM',
  'ftp://files.example.com/x',
  'javascript:alert(1)',
  'data:text/html,<script>x</script>',
  'www.example.com',
  'www.example.com/watch?v=abc',
  'example.com',
  'sub.domain.co.uk/path?q=1',
  'example.io',
  '//evil.example.net/x',
  'mailto:someone@example.com',
  'Check http://bit.ly/3x now',
  'my-site.net',
  'xn--80ak6aa92e.com',
];

const NOT_LINKS = [
  'my account will not play',
  'Episode 1.5 is broken',
  'v2.0 released',
  'I paid 12.50 and it failed',
  'Sgt. Pepper is on episode 3',
  'error: 404 not found',
  '   ',
  '',
];

// A filename is deliberately refused. The rule errs towards blocking, so this is
// asserted here rather than left ambiguous: a support ticket has no reason to
// carry a filename, and a ticket that reaches staff unreviewed is the thing
// being prevented.
for (const text of ['the file.txt is not uploading', 'see notes.doc please']) {
  check(`blocks a filename: ${JSON.stringify(text)}`, containsLink(text));
}

for (const text of LINKS) {
  check(`blocks: ${JSON.stringify(text.slice(0, 40))}`, containsLink(text));
}
for (const text of NOT_LINKS) {
  check(`allows: ${JSON.stringify(text.slice(0, 40))}`, !containsLink(text));
}

// The rule must hold however the link is dressed up in the message body.
for (const wrapper of ['please click %s', 'see %s thanks', '>> %s <<', '(%s)']) {
  for (const url of ['https://example.com', 'www.example.com', 'example.com/x']) {
    const text = wrapper.replace('%s', url);
    check(`catches a wrapped link: ${JSON.stringify(text)}`, containsLink(text));
  }
}

// ------------------------------------------------------------------ messages
{
  const member = validateMessage('my password reset never arrives', 'member');
  check('a member can write a plain message', Boolean(member.body) && !member.error);
  check('a plain message reports no link', member.hasLink === false);
}
{
  const member = validateMessage('go to https://example.com/reset', 'member');
  check('a member cannot send a link', Boolean(member.error), member.error?.slice(0, 40));
  check('the refusal says why', /not allowed/i.test(member.error || ''));
}
{
  const staff = validateMessage('try https://example.com/docs', 'staff');
  check('staff may send a link', Boolean(staff.body) && !staff.error);
  check('a staff link is recorded as a link', staff.hasLink === true);
}
{
  const empty = validateMessage('   ', 'staff');
  check('an empty message is refused', Boolean(empty.error));
}
{
  const long = validateMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1), 'staff');
  check('an over-long message is refused', Boolean(long.error));
  check(
    'the exact limit is allowed',
    Boolean(validateMessage('x'.repeat(MAX_MESSAGE_LENGTH), 'staff').body),
  );
}

// A member cannot pass off a side other than their own. The handler reads the
// side from the session, but validateMessage must not trust a caller-supplied
// one either, so anything that is not literally 'staff' is a member.
for (const spoof of ['admin', 'ADMIN', 'moderator', undefined, null, 'staff ', true, 1]) {
  const r = validateMessage('https://example.com', spoof);
  check(`spoofed side ${JSON.stringify(spoof)} is treated as a member`, Boolean(r.error));
}

// ------------------------------------------------------------------ subjects
{
  const s = validateSubject('  Cannot watch episode 2  ');
  check('a subject is trimmed', s.subject === 'Cannot watch episode 2', s.subject);
}
{
  check('an empty subject is refused', Boolean(validateSubject('  ').error));
}
{
  check('a subject with a link is refused', Boolean(validateSubject('see example.com').error));
}

// -------------------------------------------------------------------- phone
const GOOD_PHONES = [
  ['+63 917 123 4567', '+63 917 123 4567'],
  ['09171234567', '09171234567'],
  ['(02) 8123-4567', '(02) 8123-4567'],
  ['+1-555-0100', '+1-555-0100'],
];
for (const [input, expected] of GOOD_PHONES) {
  const r = validatePhone(input);
  check(`accepts phone ${input}`, r.phone === expected, r.error ?? r.phone);
}
check('an empty phone is allowed and stored as null', validatePhone('').phone === null);
check('a blank phone is allowed', validatePhone('   ').phone === null);

const BAD_PHONES = [
  ['12345', 'too short'],
  ['call me maybe', 'letters'],
  ['+63 917 123 4567 ext 4', 'too long'],
  ['<script>', 'markup'],
  ['1234567890123456789', 'over 15 digits'],
];
for (const [input, why] of BAD_PHONES) {
  check(`refuses phone ${JSON.stringify(input)} (${why})`, Boolean(validatePhone(input).error));
}

// The 15-digit ceiling is E.164, so a longer number cannot be a real one.
check('exactly 15 digits is allowed', Boolean(validatePhone('+123456789012345').phone));

console.log('');
if (failed) {
  console.log(`${failed} ticket rule check(s) failed.`);
  process.exit(1);
}
console.log('Ticket rules hold.');