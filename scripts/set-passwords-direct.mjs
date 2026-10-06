/**
 * Sets known passwords by writing the hash straight into D1.
 *
 * Used to recover from having rotated every password without recording them,
 * which locks out the owner as thoroughly as anybody. Same PBKDF2 settings and
 * the same hex encoding as worker/crypto.js, so the stored value is exactly what
 * the Worker would have written.
 */
import { hashPassword, randomSalt, passwordFingerprint } from '../worker/crypto.js';

const accounts = [
  'justinezantoz01@gmail.com',
  'justinee@gmail.com',
  'moderator@gmail.com',
];

// Readable alphabet: these get typed by a person, not copied. No O/0/I/l/1.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SYMBOLS = '!@#$%&*?';
const letters = 'abcdefghijkmnopqrstuvwxyz';
const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const digits = '23456789';

function generate(len = 18) {
  const out = [];
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) {
    out.push(ALPHABET[buf[i] % ALPHABET.length]);
  }
  // Guarantee the shape the policy wants, whatever the random draw gave.
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  out[0] = pick(letters);
  out[1] = pick(uppers);
  out[2] = pick(digits);
  out[len - 1] = pick(SYMBOLS);
  out[len - 2] = pick(SYMBOLS);
  return out.join('');
}

const rows = [];
const printed = [];

for (const email of accounts) {
  const password = generate();
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const fingerprint = await passwordFingerprint(password);
  rows.push({ email, salt, hash, fingerprint });
  printed.push({ email, password });
}

const statements = rows.map((r) =>
  `UPDATE users SET password_hash = '${r.hash}', salt = '${r.salt}', password_fingerprint = '${r.fingerprint}' WHERE email = '${r.email}';`
);

console.log('--- SQL ---');
console.log(statements.join('\n'));
console.log('--- PASSWORDS (shown once) ---');
for (const p of printed) {
  console.log(`${p.email}  ${p.password}`);
}