/** Human labels for the stored `type` values on titles. */
export const TITLE_TYPES = [
  { value: 'series', label: 'Series' },
  { value: 'movie', label: 'Movie' },
  { value: 'anime', label: 'Anime' },
  { value: 'ai', label: 'AI Generated' },
];

const LABELS = Object.fromEntries(TITLE_TYPES.map((t) => [t.value, t.label]));

/** 'ai' reads as "AI Generated" rather than the raw database value. */
export function titleTypeLabel(type) {
  return LABELS[type] || type;
}