/**
 * Parsing a pasted list of episode links.
 *
 * Kept apart from the handler so the awkward part — people paste wildly
 * inconsistent things — is unit testable rather than only reachable by pasting
 * into a form.
 *
 * The accepted shapes, in the order people actually paste them:
 *
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   <iframe src="https://www.youtube.com/embed/ID"></iframe>
 *   Episode name | https://youtu.be/ID
 *   Episode 1 - The title, with punctuation | https://youtu.be/ID
 *
 * A line that cannot be read is reported with its line number rather than
 * dropped, because a silently shorter series is worse than a visible failure:
 * nobody would notice three episodes had gone missing.
 */

/** Upper bound, so a pasted library cannot fill the table or the request. */
export const MAX_EPISODES_PER_IMPORT = 500;

const MAX_EPISODE_TITLE = 120;

/**
 * Splits one pasted line into an episode title and a link.
 *
 * The separator is looked for on the right-hand side only, so a pipe character
 * inside a link's query string cannot be mistaken for one.
 */
function splitLine(line) {
  const bar = line.lastIndexOf('|');
  if (bar === -1) return { episodeTitle: null, url: line.trim() };

  const left = line.slice(0, bar).trim();
  const right = line.slice(bar + 1).trim();
  // A leading pipe is a typo, not a title separator.
  if (!left || !right) return { episodeTitle: null, url: line.trim() };

  return {
    episodeTitle: left.slice(0, MAX_EPISODE_TITLE),
    url: right,
  };
}

/**
 * @param {string} input  the pasted block
 * @returns {{episodes: Array, problems: Array<{line: number, text: string, error: string}>,
 *            total: number, tooMany: boolean}}
 */
export function parseEpisodeList(input, validate) {
  const lines = String(input ?? '').split(/\r?\n/);

  const episodes = [];
  const problems = [];
  let tooMany = false;

  lines.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    // Comment lines, so someone can label a section without it becoming an
    // episode.
    if (text.startsWith('#') || text.startsWith('//')) return;

    if (episodes.length >= MAX_EPISODES_PER_IMPORT) {
      tooMany = true;
      return;
    }

    const { episodeTitle, url } = splitLine(text);
    const parsed = validate(url);

    if (!parsed || parsed.error) {
      problems.push({
        line: index + 1,
        text: text.slice(0, 80),
        error: parsed?.error ?? 'That does not look like a YouTube or Vimeo link',
      });
      return;
    }

    episodes.push({
      number: episodes.length + 1,
      title: episodeTitle,
      provider: parsed.provider,
      videoId: parsed.videoId,
    });
  });

  return { episodes, problems, total: lines.length, tooMany };
}
