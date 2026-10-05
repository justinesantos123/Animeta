// Unit tests for the pasted episode list parser.
// Run: node scripts/test-episode-import.mjs
//
// This parser sees whatever a person actually pastes, which is a mess: bare
// links, full iframe snippets, names with pipes and punctuation in them, blank
// lines, and the occasional line that is not a link at all. The behaviour that
// matters most is that a bad line is reported with its number, never dropped
// silently — a series quietly missing episodes is worse than a visible error.
import { parseEpisodeList, MAX_EPISODES_PER_IMPORT } from '../worker/episode-import.js';
import { parseEmbed } from '../worker/embed.js';

let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// The real validator, so this tests the actual pipeline rather than a stand-in.
const parse = (input) => parseEpisodeList(input, parseEmbed);

const ID = 'dQw4w9WgXcQ';

// --- Accepted shapes ---------------------------------------------------------
{
  const r = parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  check('a bare watch link', r.episodes.length === 1);
  check('numbered from one', r.episodes[0].number === 1);
  check('no title when none given', r.episodes[0].title === null);
  check('provider and id extracted', r.episodes[0].provider === 'youtube' && r.episodes[0].videoId === ID);
}
{
  const r = parse('The First Meeting | https://youtu.be/dQw4w9WgXcQ');
  check('a named episode', r.episodes[0].title === 'The First Meeting');
}
{
  const r = parse(`<iframe src="https://www.youtube.com/embed/${ID}"></iframe>`);
  check('a full iframe snippet', r.episodes.length === 1 && r.episodes[0].videoId === ID);
}
{
  const r = parse('https://vimeo.com/76979871');
  check('a vimeo link', r.episodes[0].provider === 'vimeo');
}
{
  const r = parse(`https://youtu.be/${ID}\nhttps://youtu.be/aQw4w9WgXcQ\nhttps://youtu.be/bQw4w9WgXcQ`);
  check('multiple lines', r.episodes.length === 3);
  check('numbered in order', r.episodes.map((e) => e.number).join(',') === '1,2,3');
}

// --- Whitespace and comments -------------------------------------------------
{
  const r = parse('\n\n  https://youtu.be/dQw4w9WgXcQ  \n\n\nhttps://youtu.be/aQw4w9WgXcQ\n');
  check('blank lines are ignored', r.episodes.length === 2);
  check('surrounding spaces are trimmed', r.episodes[0].videoId === ID);
}
{
  const r = parse('# Season 1\nhttps://youtu.be/dQw4w9WgXcQ\n# a note\n// another\nhttps://youtu.be/aQw4w9WgXcQ');
  check('comment lines are ignored', r.episodes.length === 2);
}
{
  const r = parse('https://youtu.be/dQw4w9WgXcQ\r\nhttps://youtu.be/aQw4w9WgXcQ');
  check('windows line endings work', r.episodes.length === 2);
}

// --- Punctuation in titles ---------------------------------------------------
// Episode names are full of pipes, dashes and colons, so the separator has to be
// found on the right-hand side and the name must survive intact.
{
  const r = parse('Episode 12 - The Battle, Part 2 | https://youtu.be/dQw4w9WgXcQ');
  check('a name with commas and dashes', r.episodes[0].title === 'Episode 12 - The Battle, Part 2');
  check('and the link still parsed', r.episodes[0].videoId === ID);
}
{
  // A pipe inside the URL's query string must not be treated as a separator.
  const r = parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30');
  check('a pipe-free url with a query is fine', r.episodes.length === 1);
  check('no title invented from the query', r.episodes[0].title === null);
}
{
  // lastIndexOf('|') is what makes this work: a pipe in the name is kept.
  const r = parse('Name | With Pipe | https://youtu.be/dQw4w9WgXcQ');
  check('a pipe inside the name is kept', r.episodes[0].title === 'Name | With Pipe');
}
{
  const r = parse('https://youtu.be/dQw4w9WgXcQ |');
  check('a trailing pipe is not a title', r.episodes.length === 1 && r.episodes[0].title === null);
}
{
  const long = 'E'.repeat(300);
  const r = parse(`${long} | https://youtu.be/dQw4w9WgXcQ`);
  check('a very long name is trimmed', r.episodes[0].title.length <= 120, String(r.episodes[0].title.length));
}

// --- Bad lines are reported, never dropped ------------------------------------
{
  const r = parse(`https://youtu.be/dQw4w9WgXcQ\nnot a link at all\nhttps://youtu.be/aQw4w9WgXcQ`);
  check('good lines still import', r.episodes.length === 2);
  check('the bad line is reported', r.problems.length === 1);
  check('with its line number', r.problems[0].line === 2, String(r.problems[0].line));
  check('and a reason', Boolean(r.problems[0].error));
  check('and the text that failed', r.problems[0].text === 'not a link at all');
}
{
  const r = parse('https://clips.twitch.tv/SomeClip\nhttps://youtu.be/dQw4w9WgXcQ');
  check('a non-youtube host is refused', r.problems.length === 1 && r.episodes.length === 1);
}
{
  const r = parse('https://www.youtube.com/embed/abc');
  check('a too-short id is refused', r.problems.length === 1);
}
{
  const r = parse('');
  check('empty input yields nothing', r.episodes.length === 0 && r.problems.length === 0);
}
{
  const r = parse(undefined);
  check('undefined input is handled', r.episodes.length === 0);
}
{
  const r = parse('   \n\n  # only comments\n');
  check('comments only yields nothing', r.episodes.length === 0);
}

// --- Hostile input ------------------------------------------------------------
// Nothing from the paste should survive beyond a provider and an id.
{
  const r = parse(
    `<script>alert(1)</script> | https://youtu.be/dQw4w9WgXcQ\njavascript:alert(1)\n<iframe src="javascript:alert(2)"></iframe>`,
  );
  check('one hostile line still imports', r.episodes.length === 1);
  check('the script text is not stored as a title source of truth', r.episodes[0].videoId === ID);
  check('the two hostile lines are rejected', r.problems.length === 2, String(r.problems.length));
}

// --- The cap -------------------------------------------------------------------
{
  const many = Array.from({ length: MAX_EPISODES_PER_IMPORT + 20 }, () => `https://youtu.be/${ID}`).join('\n');
  const r = parse(many);
  check('over the cap is refused rather than truncated', r.tooMany === true);
  check('and nothing was accepted', r.episodes.length === MAX_EPISODES_PER_IMPORT, String(r.episodes.length));
}
{
  const exact = Array.from({ length: MAX_EPISODES_PER_IMPORT }, () => `https://youtu.be/${ID}`).join('\n');
  const r = parse(exact);
  check('exactly at the cap is allowed', r.tooMany === false && r.episodes.length === MAX_EPISODES_PER_IMPORT);
}

console.log(
  failed === 0
    ? '\nEpisode list parsing behaves as expected.'
    : `\n${failed} episode import check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);