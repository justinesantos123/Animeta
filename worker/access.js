/**
 * The catalog access rule, as a pure function.
 *
 * Kept separate from the request handler so it can be unit tested directly.
 * An earlier version of this logic lived inline in handleGetTitle, and the
 * jsdom mock in the smoke test drifted out of step with it: the mock said
 * `locked: false` while the Worker said `true`, so the tests passed on a gate
 * that was actually showing over the free episode.
 *
 * The rule:
 *   - A movie plays for anyone, signed out or not.
 *   - On a series, anime or AI title, a signed-out visitor may watch the first
 *     episode only. Episode 2 onwards needs an account.
 *   - An episodic title with no episodes has no preview to offer, so it is
 *     locked outright rather than showing a dead player.
 */

/** Types that gate episode 2 onwards behind an account. Mirrors the CHECK
 *  constraint in worker/schema.sql and the `gated` flag in src/lib/titleTypes.js. */
export const EPISODIC_TYPES = ['series', 'anime', 'ai'];

/**
 * @param {object} args
 * @param {string} args.type           stored title type
 * @param {string[]} args.episodeIds  episode ids in play order
 * @param {boolean} args.signedIn
 * @returns {{
 *   episodic: boolean,
 *   titlePlayable: boolean,
 *   previewAvailable: boolean,
 *   locked: boolean,
 *   playableEpisodeIds: Set<string>,
 * }}
 */
export function planAccess({ type, episodeIds, signedIn }) {
  const episodic = EPISODIC_TYPES.includes(type);
  const hasEpisodes = episodeIds.length > 0;

  // The title-level stream is only for titles with no episodes. On an episodic
  // title it is withheld: with episodes present episode 1 carries the preview,
  // and without them it would hand a signed-out visitor the whole show.
  const titlePlayable = !episodic || signedIn;

  const firstEpisodeId = hasEpisodes ? episodeIds[0] : null;
  const previewAvailable = episodic && !signedIn && firstEpisodeId !== null;

  const playableEpisodeIds = new Set(
    !episodic || signedIn
      ? episodeIds
      : firstEpisodeId !== null
        ? [firstEpisodeId]
        : [],
  );

  return {
    episodic,
    hasEpisodes,
    titlePlayable,
    previewAvailable,
    // Nothing playable at all: an episodic title whose preview does not exist.
    locked: !titlePlayable && !previewAvailable,
    playableEpisodeIds,
  };
}