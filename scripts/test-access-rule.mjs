// Unit tests for the catalog access rule in worker/access.js.
// Run: node scripts/test-access-rule.mjs
//
// This exists because the rule was previously inline in handleGetTitle, where
// the only coverage was a jsdom mock that had silently drifted from the real
// handler. The mock said locked: false; the Worker said true, so the tests
// passed while the sign-in gate was covering the free first episode.
import { planAccess, EPISODIC_TYPES } from '../worker/access.js';

let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const EPS = ['e1', 'e2', 'e3', 'e4', 'e5'];

// --- Movies play for everyone ------------------------------------------------
for (const signedIn of [false, true]) {
  const p = planAccess({ type: 'movie', episodeIds: [], signedIn });
  check(
    `movie plays when signedIn=${signedIn}`,
    p.titlePlayable && !p.locked,
    `titlePlayable=${p.titlePlayable} locked=${p.locked}`,
  );
}

// A movie that somehow has episodes still plays: movies are not episodic.
{
  const p = planAccess({ type: 'movie', episodeIds: EPS, signedIn: false });
  check(
    'movie with episode rows still plays',
    p.titlePlayable && p.playableEpisodeIds.size === EPS.length && !p.locked,
    `playable=${p.playableEpisodeIds.size}`,
  );
}

// --- Episodic, signed out: exactly episode 1 ---------------------------------
for (const type of EPISODIC_TYPES) {
  const p = planAccess({ type, episodeIds: EPS, signedIn: false });

  check(`${type} signed out: episode 1 is playable`, p.playableEpisodeIds.has('e1'));
  check(
    `${type} signed out: episode 2 onwards is not`,
    !p.playableEpisodeIds.has('e2') && !p.playableEpisodeIds.has('e3'),
  );
  check(
    `${type} signed out: only one episode is playable`,
    p.playableEpisodeIds.size === 1,
    `size=${p.playableEpisodeIds.size}`,
  );
  // This is the bug the mock hid: the gate must not cover the free episode.
  check(`${type} signed out: not fully locked`, p.locked === false, `locked=${p.locked}`);
  check(`${type} signed out: preview is offered`, p.previewAvailable === true);
  check(
    `${type} signed out: title-level stream is withheld`,
    p.titlePlayable === false,
    `titlePlayable=${p.titlePlayable}`,
  );
}

// --- Episodic, signed in: everything ----------------------------------------
for (const type of EPISODIC_TYPES) {
  const p = planAccess({ type, episodeIds: EPS, signedIn: true });
  check(
    `${type} signed in: every episode plays`,
    p.playableEpisodeIds.size === EPS.length && !p.locked && p.titlePlayable,
    `size=${p.playableEpisodeIds.size} locked=${p.locked}`,
  );
  check(`${type} signed in: no preview prompt`, p.previewAvailable === false);
}

// --- Episodic with a single episode: that one is still free -----------------
{
  const p = planAccess({ type: 'anime', episodeIds: ['only'], signedIn: false });
  check(
    'a one-episode anime gives its only episode away',
    p.playableEpisodeIds.has('only') && !p.locked,
    `locked=${p.locked}`,
  );
}

// --- Episodic with no episodes: locked outright ------------------------------
for (const type of EPISODIC_TYPES) {
  const p = planAccess({ type, episodeIds: [], signedIn: false });
  check(
    `${type} with no episodes is locked entirely`,
    p.locked === true && p.previewAvailable === false && p.titlePlayable === false,
    `locked=${p.locked} preview=${p.previewAvailable}`,
  );
  check(`${type} with no episodes exposes nothing`, p.playableEpisodeIds.size === 0);
}

// --- Edge cases --------------------------------------------------------------
{
  const p = planAccess({ type: 'anime', episodeIds: [], signedIn: true });
  check('anime with no episodes unlocks when signed in', p.titlePlayable && !p.locked);
}
{
  const p = planAccess({ type: 'nonsense', episodeIds: EPS, signedIn: false });
  check(
    'an unknown type is treated as a movie, not gated',
    p.titlePlayable && !p.locked && p.episodic === false,
    `episodic=${p.episodic}`,
  );
}

console.log(
  failed === 0 ? '\nAccess rule behaves as expected.' : `\n${failed} access rule check(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);