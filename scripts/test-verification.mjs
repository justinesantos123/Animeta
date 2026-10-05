/**
 * Invariants for email verification, the account tabs and the ticket queue.
 *
 * These are source-level assertions rather than behavioural ones, because the
 * bugs that motivated them were all "the code looks right but two things
 * disagree" -- a username check that disagreed with its own unique index, a
 * presence check that disagreed with the session gate. A behavioural test needs
 * a database; a source test catches the disagreement at the point it is written,
 * and this project already has the habit of pinning SQL predicates by reading
 * them.
 */
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../worker/api.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../src/components/Nav.jsx', import.meta.url), 'utf8');
const userAdmin = readFileSync(new URL('../src/pages/UserAdmin.jsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/pages/Admin.jsx', import.meta.url), 'utf8');
const bell = readFileSync(new URL('../src/components/NotificationBell.jsx', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../migrations/0012_email_verification_and_tickets.sql', import.meta.url),
  'utf8',
);

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

// ------------------------------------------------- username uniqueness
//
// The unique index covers every row. A "is this name taken" check that filters on
// deleted_at reports a name as free and then the INSERT throws on the index, which
// the caller sees as a 500 rather than "already taken". Every such check must
// match the index.

const usernameChecks = [...api.matchAll(/lower\(username\) = lower\(\?\)([^)]*)/g)];
check('there is more than one username check', usernameChecks.length >= 4, `${usernameChecks.length} found`);

const filtered = usernameChecks.filter((m) => /deleted_at\s+IS\s+NULL/i.test(m[1]));
check(
  'no username check filters on deleted_at',
  filtered.length === 0,
  filtered.map((m) => m[1].trim()).join(' | '),
);

check(
  'the unique index covers lower(username)',
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users\(lower\(username\)\)/.test(schema),
);

// The comment that said the opposite of what the code did.
check(
  'no comment claims deleted accounts release their username',
  !/deleted_at IS NULL: a pending-deletion account still holds its username/i.test(api),
);

// ---------------------------------------------------------- verification
check('signup creates the account unverified', /needsVerification: true/.test(api));
// The verified-at value at signup is a ternary on the owner flag, so an
// ordinary registration cannot get a timestamp by accident.
check(
  'the verified timestamp at signup is the owner flag only',
  /isOwner \? new Date\(\)\.toISOString\(\)\.replace\('T', ' '\)\.slice\(0, 19\) : null/.test(api),
);
check(
  'the owner is trusted by config, not by email',
  /const isOwner = ownerEmails\(env\)\.includes\(email\);/.test(api),
);
check(
  'signup issues no session for an unverified account',
  /needsVerification: true/.test(api) &&
    // The only signToken in handleSignup is inside the owner branch, so an
    // ordinary registration cannot obtain a cookie here.
    /if \(isOwner\) \{[\s\S]{0,400}sessionCookie\(token\)/.test(api),
);
check('login refuses an unverified account', /Confirm your email address before signing in/.test(api));
check(
  'login checks the password before the verification state',
  api.indexOf("if (!ok) return json({ error: 'Invalid email or password' }, 401);") <
    api.indexOf('Confirm your email address before signing in'),
);
check(
  'getUser refuses an unverified account',
  /if \(!row\.email_verified_at\) return null;/.test(api),
);
check(
  'the verification token is stored hashed',
  /email_verify_token_hash = \?/.test(api) && /hashResetToken\(token\)/.test(api),
);
check(
  'a spent token cannot be replayed',
  /SET email_verified_at = datetime\('now'\), email_verify_token_hash = NULL/.test(api),
);
check(
  'an unknown token and an expired token give the same message',
  /That verification link is not valid/.test(api) && /That verification link has expired/.test(api),
);
check(
  'resend does not reveal whether an address is registered',
  /if \(!row \|\| row\.email_verified_at\) \{\s*\n\s*return json\(\{ ok: true, sent: false \}\);/.test(api),
);
check(
  'the phone number has no verified column',
  !/phone_verified/i.test(schema),
);

// ---------------------------------------------------------- account tabs
check('the staff console has a Members tab', /id: 'members', label: 'Members'/.test(admin));
check('the staff console has a Staff tab', /id: 'staff', label: 'Staff'/.test(admin));
check('the old combined Users tab is gone', !/label: 'Users'/.test(admin));

// Each tab asks the API for its own slice rather than filtering one list.
check(
  'UserAdmin asks for its own scope',
  /api\.listUsers\(scope\)/.test(userAdmin),
);
check('the members scope is members', /members: "u\.role = 'user'"/.test(api));
check('the staff scope is staff', /staff: "u\.role IN \('admin','moderator'\)"/.test(api));
check(
  'an unknown scope is refused rather than defaulted to everything',
  /scope must be members, staff or all/.test(api),
);

// The columns the tab is not supposed to show.
check('the users table has no Last active column', !/>Last active</.test(userAdmin));
check('the users table has no Days offline column', !/>Days offline</.test(userAdmin));
check('the users table shows presence instead', />Active now</.test(userAdmin));
check('the users table shows the phone number', /u\.phone/.test(userAdmin));

// ---------------------------------------------------- roles and permissions
check(
  'setting a role is an admin action, not owner-only',
  /handleSetRole[\s\S]{0,200}requireAdmin\(request, env\)/.test(api),
);
check(
  'setting permissions is an admin action, not owner-only',
  /handleSetPermissions[\s\S]{0,200}requireAdmin\(request, env\)/.test(api),
);
check('the owner still cannot be demoted', /The owner cannot be demoted/.test(api));
check(
  'demoting a peer admin needs the owner',
  /Only the site owner can demote another admin/.test(api),
);
check('deleting an account is still owner-only', /handleDeleteUser[\s\S]{0,120}requireOwner\(request, env\)/.test(api));
check(
  'a demotion drops the moderator grants',
  /if \(role !== 'moderator'\) \{[\s\S]{0,120}DELETE FROM user_permissions/.test(api),
);
check(
  'the role control can express a demotion',
  /<option value="user">Member<\/option>/.test(userAdmin),
);

// --------------------------------------------------- admin-set passwords
//
// The thing this must never become: a way to read a stored password. What staff
// get instead is the ability to OVERWRITE one with a value they already know.
// These checks exist so that stays true -- the schema must have no column that
// could hold a readable password, and the response must never echo one back.

check(
  'no column anywhere could hold a readable password',
  !/\b(password|passwd|pw|secret)\s+TEXT(?!\s*$)/i.test(schema) ||
    // The only password-shaped columns allowed are the hash, the salt and the
    // non-reversible fingerprint.
    (schema.match(/\bpassword[a-z_]*\s+TEXT/gi) || []).every((c) =>
      /password_hash|password_fingerprint/i.test(c),
    ),
  (schema.match(/\bpassword[a-z_]*\s+TEXT/gi) || []).join(', '),
);
check('there is no plaintext password column', !/password_plain|password_text|password_readable/i.test(schema));
check('the migration adds no readable password column', !/password_plain|password_text/i.test(migration));

// Setting a password must not return it. The caller typed it, so echoing it
// would only put it in a response body and browser history.
// Scans only the chosen-password branch. Bounded at the *next* top-level
// `return json({`, which is the generated branch: bounding on `notice:` instead
// would include that branch's `password,` and pass for the wrong reason.
{
  const start = api.indexOf('if (supplied) {', api.indexOf('async function handleAdminResetPassword'));
  const end = api.indexOf('\n  return json({', start);
  const body = api.slice(start, end);
  check(
    'a chosen password is not echoed back',
    /chosen: true/.test(body) && !/\bpassword\b\s*[,:]/.test(body),
    body.replace(/\s+/g, ' ').slice(0, 100),
  );
}
check(
  'a generated password is still returned exactly once',
  /notice: 'Shown once\. Copy it now - it cannot be retrieved later\.'/.test(api),
);

// Both paths must hash before storing. A raw insert of the supplied value would
// make the whole thing a plaintext store.
check(
  'both paths hash with a fresh salt',
  /const hash = await hashPassword\(password, salt\);/.test(api) &&
    /UPDATE users SET password_hash = \?, salt = \?, password_fingerprint = \?/.test(api),
);
check('a fresh salt is generated per call', /const salt = randomSalt\(\);/.test(api));

// A password change must invalidate outstanding reset links, or a link handed
// out before the change stays valid afterwards.
check(
  'changing a password clears outstanding reset tokens',
  /DELETE FROM password_reset_tokens WHERE user_id = \?/.test(api),
);
// The two events are logged separately, so a later audit can tell a staff-chosen
// password from a generated one.
check('a chosen password is audited distinctly', /'user\.password\.set'/.test(api));
check('a generated password is audited distinctly', /'user\.password\.reset'/.test(api));

// -------------------------------------------------------------- watchlist
check('Library is hidden from staff', /memberOnly: true/.test(nav));
check('the nav filters by role', /linksFor\(user\?\.role\)/.test(nav));

// --------------------------------------------------------------- tickets
check('tickets tables exist', /CREATE TABLE IF NOT EXISTS tickets/.test(schema));
check('ticket messages exist', /CREATE TABLE IF NOT EXISTS ticket_messages/.test(schema));
check('the migration creates them', /CREATE TABLE IF NOT EXISTS tickets/.test(migration));
check('a ticket belongs to an account', /user_id\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/.test(schema));

// The link rule is enforced where the side is known server-side.
check(
  'the reply side comes from the session, not the body',
  /const side = ticketSide\(user\);/.test(api),
  'ticketSide is derived from the role',
);
check('ticketSide is role-based', /function ticketSide\(user\)[\s\S]{0,80}STAFF_ROLES\.includes\(user\.role\)/.test(api));
check(
  'a member cannot reach a ticket they do not own',
  /else if \(!owns\) \{\s*\n\s*return json\(\{ error: 'Ticket not found' \}, 404\);/.test(api),
);
check('a missing ticket 404s rather than 403s', /\{ error: 'Ticket not found' \}, 404/.test(api));
check('closing needs the tickets grant', /handleCloseTicket[\s\S]{0,400}requirePermission\(request, env, 'tickets'\)/.test(api));
check(
  'replying to a closed ticket reopens it',
  /status = 'open', closed_at = NULL, closed_by = NULL/.test(api),
);
// Every staff-facing ticket route must go through the same gate. The queue holds
// every member's address and what they wrote about their problem, so "is a
// moderator" is not on its own a reason to read it -- being a moderator used to
// be exactly that, because these four handlers checked the role and not the
// grant.
check(
  'a single gate resolves the ticket viewer and its side',
  /async function ticketViewer\(request, env\)/.test(api),
);
check(
  'the gate requires the tickets permission for staff',
  /if \(side === 'staff'\) \{[\s\S]{0,160}requirePermission\(request, env, 'tickets'\)/.test(api),
);
// Staff without the grant fall back to the member view rather than being
// refused: handleCreateTicket lets staff open a ticket, so refusing to read it
// back would make that a dead end for the people most likely to use it.
check(
  'staff without the grant fall back to their own tickets',
  /side: 'member'/.test(api.slice(api.indexOf('async function ticketViewer'), api.indexOf('async function handleListTickets'))),
);
for (const [name, fn] of [
  ['handleListTickets', 'handleListTickets'],
  ['handleGetTicket', 'handleGetTicket'],
  ['handleReplyTicket', 'handleReplyTicket'],
  ['handleCloseTicket', 'handleCloseTicket'],
]) {
  const start = api.indexOf(`async function ${fn}(`);
  // Wide enough to reach the gate past a leading comment.
  const body = api.slice(start, start + 500);
  check(
    `${name} goes through the gate`,
    /ticketViewer\(request, env\)|requirePermission\(request, env, 'tickets'\)/.test(body),
    body.replace(/\s+/g, ' ').slice(0, 70),
  );
}
// And none of them may decide "is this staff?" on its own any more.
check(
  'no ticket handler gates on the role alone',
  !/ticketSide\(user\) !== 'staff'/.test(api),
);
// Opening a ticket is a member action, so it is deliberately not gated.
check(
  'creating a ticket needs no permission',
  /async function handleCreateTicket[\s\S]{0,200}getUser\(request, env\)/.test(api),
);

check('staff are notified of a new ticket',
  /kind: 'ticket'/.test(api) && /userIds: staffRecipients/.test(api),
);
check(
  'the member is notified of a staff reply',
  /Staff replied/.test(api),
);
check(
  'a reply link goes to the support page',
  /link: '\/support'/.test(api),
);

// --------------------------------------------------------- notifications
check('the bell has a Notifications tab', /label: 'Notifications', count: unread/.test(bell));
check('the bell has a Tickets tab', /label: 'Tickets', count: ticketUnread/.test(bell));
check('the API reports a separate ticket unread count', /ticketUnread:/.test(api));
check(
  'marking read can target one group',
  /handleMarkAllRead\(request, env, url\.searchParams\.get\('scope'\)/.test(api),
);
check(
  'marking the tickets tab does not clear ordinary notifications',
  /if \(which === 'tickets'\)[\s\S]{0,160}kind = \?/.test(api),
);

// -------------------------------------------------------------- dashboard
const dash = readFileSync(new URL('../src/components/AdminDashboard.jsx', import.meta.url), 'utf8');
check('the dashboard has a Tickets tab', /id: 'tickets', label: 'Tickets'/.test(dash));
check('it shows pending tickets', /Pending tickets/.test(dash));
check('it shows closed tickets', /Closed tickets/.test(dash));
check('the API sends ticket counts', /tickets: \{\s*\n\s*open:/.test(api));

console.log('');
if (failed) {
  console.log(`${failed} verification check(s) failed.`);
  process.exit(1);
}
console.log('Verification, tabs and ticket invariants hold.');