/** Human labels for the stored `type` values on titles. */
export const TITLE_TYPES = [
  { value: 'series', label: 'Series' },
  { value: 'anime', label: 'Anime' },
  { value: 'movie', label: 'Movies' },
  { value: 'ai', label: 'AI Generated' },
];

const LABELS = Object.fromEntries(TITLE_TYPES.map((t) => [t.value, t.label]));

/** 'ai' reads as "AI Generated" rather than the raw database value. */
export function titleTypeLabel(type) {
  return LABELS[type] || type;
}

/**
 * Types that are released as episodes rather than as one film.
 *
 * These are the ones that need an account to watch. Movies are the exception:
 * they play for a signed-out visitor.
 */
export function isEpisodic(type) {
  return type === 'series' || type === 'anime' || type === 'ai';
}