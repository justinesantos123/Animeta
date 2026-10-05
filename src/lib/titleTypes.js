/**
 * The four catalog categories.
 *
 * The stored `type` values are the source of truth and are shared with the
 * Worker: EPISODIC_TYPES in worker/api.js and the CHECK constraint in
 * worker/schema.sql must agree with the `gated` flag here.
 *
 * `gated` marks types that need an account to watch. Only movies play for a
 * signed-out visitor.
 */
export const TITLE_TYPES = [
  {
    value: 'anime',
    label: 'Anime',
    blurb: 'Series released episode by episode.',
    gated: true,
  },
  {
    value: 'movie',
    label: 'Movies',
    blurb: 'Feature films that play without an account.',
    gated: false,
  },
  {
    value: 'series',
    label: 'Series',
    blurb: 'Long-running shows, one episode at a time.',
    gated: true,
  },
  {
    // Labelled "AI Movie" at the user's request, but still gated: the AI
    // titles in the catalog are built as seasons and episodes, so they behave
    // like any other episodic release. Renaming the label must not silently
    // change who has to sign in to watch, so this stays true.
    value: 'ai',
    label: 'AI Movie',
    blurb: 'Films generated end to end with AI tooling.',
    gated: true,
  },
];

const BY_VALUE = new Map(TITLE_TYPES.map((t) => [t.value, t]));

/** 'ai' reads as "AI Movie" rather than the raw database value. */
export function titleTypeLabel(type) {
  return BY_VALUE.get(type)?.label ?? type;
}

/** The category record, or null when the type is not one we know about. */
export function titleTypeMeta(type) {
  return BY_VALUE.get(type) ?? null;
}

/**
 * Types that are released as episodes rather than as one film.
 *
 * These are the ones that need an account to watch. Movies are the exception:
 * they play for a signed-out visitor.
 */
export function isEpisodic(type) {
  return BY_VALUE.get(type)?.gated ?? false;
}

/** True when `type` is one of the four categories. */
export function isKnownType(type) {
  return BY_VALUE.has(type);
}

/** Slug for the category's own page, e.g. '/category/ai'. */
export function typePath(type) {
  return `/category/${type}`;
}