/**
 * The five catalog categories.
 *
 * The stored `type` values are the source of truth and are shared with the
 * Worker: EPISODIC_TYPES in worker/api.js and the CHECK constraint in
 * worker/schema.sql must agree with the `gated` flag here.
 *
 * `gated` marks types that need an account to watch. Only movies play for a
 * signed-out visitor.
 *
 * `sponsored` marks the one type that is not editorial content. It exists so an
 * advert can be published and browsed like anything else, while being labelled
 * as a paid placement everywhere it surfaces. An advert presented as a normal
 * title is the one thing that would genuinely cost this site its audience, so
 * the label is not optional and not per-title.
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
  {
    // A paid placement, not editorial. Ungated so an advert is watchable without
    // friction — which is what an advertiser pays for — but always labelled.
    value: 'ads',
    label: 'Ads',
    blurb: 'Sponsored video from an advertiser.',
    gated: false,
    sponsored: true,
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

/** True when `type` is one of the five categories. */
export function isKnownType(type) {
  return BY_VALUE.has(type);
}

/**
 * True when the type is a paid placement rather than editorial content.
 *
 * Everything that renders a title uses this to decide whether to say
 * "Sponsored", rather than checking the raw string, so a new advert surface
 * cannot forget the label.
 */
export function isSponsored(type) {
  return BY_VALUE.get(type)?.sponsored === true;
}

/** Slug for the category's own page, e.g. '/category/ai'. */
export function typePath(type) {
  return `/category/${type}`;
}