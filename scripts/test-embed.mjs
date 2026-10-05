// Unit tests for embed parsing in worker/embed.js.
// Run: node scripts/test-embed.mjs
//
// The parse output is stored and later rendered as an iframe src, so the tests
// concentrate on the way an attacker would try to smuggle something through a
// paste: a second host, a script tag, a javascript: URL, a malformed id. The
// rule under all of them is that nothing from the paste survives parsing.
import { parseEmbed, embedUrl, watchUrl } from '../worker/embed.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const YT = 'dQw4w9WgXcQ';

// --- Accepted pastes ---------------------------------------------------------
const ACCEPT = [
  ['a share link', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', YT],
  ['a share link with extra params', 'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ', 'youtube', YT],
  ['the mobile share link', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', YT],
  ['a youtu.be short link', 'https://youtu.be/dQw4w9WgXcQ', 'youtube', YT],
  ['an embed URL on its own', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', YT],
  ['a nocookie embed URL', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube', YT],
  ['a Shorts link', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', YT],
  ['a live link', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube', YT],
  ['a full iframe snippet', `<iframe src="https://www.youtube.com/embed/${YT}" allowfullscreen></iframe>`, 'youtube', YT],
  ['an iframe with attributes first', `<iframe width="560" src="https://www.youtube.com/embed/${YT}" title="t" frameborder="0" allowfullscreen></iframe>`, 'youtube', YT],
  ['an iframe with single quotes', `<iframe src='https://www.youtube.com/embed/${YT}'></iframe>`, 'youtube', YT],
  ['a vimeo page', 'https://vimeo.com/76979871', 'vimeo', '76979871'],
  ['a vimeo player URL', 'https://player.vimeo.com/video/76979871', 'vimeo', '76979871'],
  ['a vimeo iframe', '<iframe src="https://player.vimeo.com/video/76979871"></iframe>', 'vimeo', '76979871'],
];

for (const [label, input, provider, videoId] of ACCEPT) {
  const got = parseEmbed(input);
  check(
    `accepts ${label}`,
    got.provider === provider && got.videoId === videoId && !got.error,
    JSON.stringify(got),
  );
}

// --- The parsed result is a rebuilt URL, never the pasted one ----------------
// This is the property that makes storing the output safe.
{
  const got = parseEmbed(`<iframe src="https://www.youtube.com/embed/${YT}"></iframe>`);
  check(
    'the embed URL is rebuilt, not echoed',
    got.embedUrl === `https://www.youtube-nocookie.com/embed/${YT}?rel=0`,
    got.embedUrl,
  );
  check('the provider host is the nocookie host', got.embedUrl.includes('youtube-nocookie.com'));
  check('the watch URL is rebuilt too', got.watchUrl === `https://www.youtube.com/watch?v=${YT}`);
}

// --- Refusals ---------------------------------------------------------------
const REJECT = [
  ['empty input', ''],
  ['whitespace only', '   '],
  ['a bare word', 'hello'],
  ['a numeric id with no host', '12345'],
  ['a Dailymotion link', 'https://www.dailymotion.com/video/x7tgad0'],
  ['a Twitch clip', 'https://clips.twitch.tv/SomeClip'],
  ['a direct mp4', 'https://example.com/film.mp4'],
  ['a bare youtube id', YT],
];

for (const [label, input] of REJECT) {
  const got = parseEmbed(input);
  check(`refuses ${label}`, Boolean(got.error), JSON.stringify(got));
}

// --- Injection attempts ------------------------------------------------------
// Each of these pastes something hostile. The contract is the same for all: no
// script, no foreign host and no javascript: URL may reach embedUrl.
const HOSTILE = [
  ['a script tag', '<script>alert(1)</script><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'],
  ['an onerror handler', '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onerror="alert(1)"></iframe>'],
  ['a javascript: src', '<iframe src="javascript:alert(1)"></iframe>'],
  ['a second host in the path', '<iframe src="https://www.youtube.com/embed/../../evil.com/x"></iframe>'],
  ['a query string on the id', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1'],
  ['a provider name as the id', 'https://www.youtube.com/embed/../../'],
];

for (const [label, input] of HOSTILE) {
  const got = parseEmbed(input);
  // Either it is refused outright, or it resolved to a provider-hosted URL and
  // nothing else survived. Refusing is the ideal outcome; leaking is not.
  const url = got.embedUrl ?? '';
  const safe =
    Boolean(got.error) ||
    (url.startsWith('https://www.youtube-nocookie.com/') &&
      !/javascript:/i.test(url) &&
      !/evil/i.test(url));
  check(`${label} cannot escape the provider host`, safe, JSON.stringify(got));
}

// --- Id validation -----------------------------------------------------------
// embedUrl is the single choke point between a stored id and an iframe src, so
// it is tested directly rather than only through parseEmbed.
check('a valid youtube id builds', embedUrl('youtube', YT) !== null);
check('an unknown provider is refused', embedUrl('evil', YT) === null);
check('a missing provider is refused', embedUrl(undefined, YT) === null);
check('a null id is refused', embedUrl('youtube', null) === null);
check('an id with a slash is refused', embedUrl('youtube', 'abc/def') === null);
check('an id with a dot is refused', embedUrl('youtube', 'abc.def') === null);
check('an id with a quote is refused', embedUrl('youtube', 'abc"onload=x') === null);
check('an id with a space is refused', embedUrl('youtube', 'abc def') === null);
check('an id with a hash is refused', embedUrl('youtube', 'abc#x') === null);
check('an id with a percent is refused', embedUrl('youtube', 'abc%2Fx') === null);
check('an over-long id is refused', embedUrl('youtube', 'a'.repeat(65)) === null);
check('a too-short youtube id is refused', embedUrl('youtube', 'abc') === null);
check('a dotted-decimal vimeo id is refused', embedUrl('vimeo', '123.456') === null);
check('a non-numeric vimeo id is refused', embedUrl('vimeo', 'abcdef') === null);
check('a valid vimeo id builds', embedUrl('vimeo', '76979871') !== null);

// watchUrl has the same duty, for the link the viewer can click.
check('a youtube watch URL builds', watchUrl('youtube', YT) !== null);
check('a vimeo watch URL builds', watchUrl('vimeo', '76979871') !== null);
check('an unknown provider has no watch URL', watchUrl('evil', YT) === null);
check('a hostile id has no watch URL', watchUrl('youtube', 'abc"onload=x') === null);

// --- The 'v= parameter must not be confused with other params ---------------
{
  // The v= pattern must not match a different parameter that merely contains
  // "v=" inside it, or an unrelated link would resolve to a wrong video.
  const got = parseEmbed('https://www.youtube.com/watch?feature=shared');
  check('a link with no v= is refused', Boolean(got.error), JSON.stringify(got));
}
{
  const got = parseEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  check('v= before other params still parses', got.videoId === YT);
}
{
  // "live" appearing in an unrelated query string must not be read as a path.
  const got = parseEmbed('https://example.com/live/dQw4w9WgXcQ');
  check('a live path on another host is not trusted', Boolean(got.error), JSON.stringify(got));
}

console.log(
  failed === 0
    ? '\nEmbed parsing behaves as expected.'
    : `\n${failed} embed check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);