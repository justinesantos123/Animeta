/**
 * Support ticket rules.
 *
 * Split out of api.js so the parts that are pure decisions — what counts as a
 * link, how long a message may be, what a subject may say — can be tested
 * directly instead of through a request.
 */

/** Longest subject a member may write. */
export const MAX_SUBJECT_LENGTH = 120;

/** Longest single message, in either direction. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Messages in one ticket before the oldest fall off the record. */
export const MAX_TICKET_MESSAGES = 500;

/** Open tickets one account may have at the same time. */
export const MAX_OPEN_TICKETS_PER_USER = 10;

/**
 * Does this text contain something that would navigate or fetch somewhere?
 *
 * A ticket is the one place a member talks to staff directly, so it is also the
 * obvious place to try to get a link in front of whoever opens it. Staff are the
 * only side allowed one.
 *
 * This is a filter, not a guarantee. It catches schemes, "www." prefixes and
 * dotted hosts, which is everything a person types on purpose. It cannot catch
 * every deliberate evasion — homoglyphs, an IP address written out, an image
 * split across two messages — and it is not the real defence. The real defence
 * is that this runs server-side and never trusts the client, plus the fact that
 * a member's own address is already the only way to reach them.
 *
 * False positives are the accepted cost, and they are biased towards blocking:
 * "see file.txt" is refused, because a support ticket has no reason to carry a
 * filename and a ticket that goes through unreviewed is worse than one someone
 * rewords.
 */
export function containsLink(text) {
  const value = String(text ?? '');

  // An explicit scheme. The dangerous ones are matched without requiring "//",
  // because javascript:, data: and vbscript: are all valid without it and are
  // exactly the strings worth refusing.
  if (/\b(?:javascript|data|vbscript|file|blob|filesystem):/i.test(value)) return true;
  if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  if (/\bmailto:/i.test(value)) return true;
  if (/(^|\s)\/\/[a-z0-9]/i.test(value)) return true;

  // A "www." host with no scheme, which is how most people paste one.
  if (/\bwww\.[a-z0-9-]+\.[a-z]{2,24}\b/i.test(value)) return true;

  // A bare host: something, a dot, an alphabetic TLD, then an optional path.
  // The TLD has to be alphabetic so a version like "v2.0" is not a link, and the
  // dot must touch both sides so ordinary prose with a full stop does not match.
  if (/\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,24}\b(?:\/[^\s]*)?/i.test(value)) {
    return true;
  }

  return false;
}

/**
 * A subject a member may write, or an error.
 *
 * Checked with the same link rule as a message: the subject is rendered as the
 * ticket's title in the staff queue, so a link there is the same problem one
 * level up.
 */
export function validateSubject(raw) {
  const subject = String(raw ?? '').trim();
  if (!subject) return { error: 'Give the ticket a subject' };
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { error: `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer` };
  }
  if (containsLink(subject)) {
    return { error: 'Subjects cannot contain links. Describe the problem in words instead.' };
  }
  return { subject };
}

/**
 * A message body, or an error.
 *
 * `side` decides whether a link is allowed. It is the caller's role as resolved
 * on the server, never a value taken from the request body, so a member cannot
 * declare themselves staff.
 */
export function validateMessage(raw, side) {
  const body = String(raw ?? '').trim();
  if (!body) return { error: 'Write a message' };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer` };
  }

  const hasLink = containsLink(body);
  if (hasLink && side !== 'staff') {
    return {
      error:
        'Links are not allowed in a support ticket. Describe the problem in words and staff will help.',
      hasLink: true,
    };
  }

  return { body, hasLink };
}

/** Trims a phone number to something storable, or returns an error. */
export function validatePhone(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { phone: null };
  if (value.length > 32) return { error: 'That phone number is too long' };

  // Digits, spaces and the punctuation people actually write. A leading + or an
  // opening bracket is allowed, because "(02) 8123-4567" is how most people
  // write a landline. Letters are refused outright so this cannot quietly become
  // a second free-text field on a form that is supposed to collect a number.
  if (!/^[+()0-9][0-9 ().+/-]{4,31}$/.test(value)) {
    return { error: 'Enter a phone number using digits, spaces, +, -, ( ) or . only' };
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) {
    return { error: 'That phone number does not look like a real number' };
  }

  return { phone: value };
}