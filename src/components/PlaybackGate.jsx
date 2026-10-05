import { Link } from 'react-router-dom';

/**
 * Shown in place of the player, or over an episode that needs an account.
 *
 * Browsing stays open to everyone; this only blocks the moment of playback.
 * On an episodic title the first episode still plays as a preview, so this
 * appears on the episode list rather than over the whole player.
 */
export default function PlaybackGate({ title, episodeTitle, firstEpisodeIsFree = false }) {
  const compact = Boolean(episodeTitle);

  const heading = episodeTitle ? 'Members only' : 'Sign in to continue';
  const body = episodeTitle
    ? `“${episodeTitle}” needs an account. Create a free one to keep watching this and the rest of the season.`
    : firstEpisodeIsFree
      ? `${title} continues after the free first episode.`
      : `${title} needs an account to play.`;
  const sub = episodeTitle
    ? 'Watching is free once you have one. Browsing never requires an account.'
    : firstEpisodeIsFree
      ? 'Watch episode 1 now, then sign up for episode 2 onwards.'
      : 'Browsing is free; an account is only needed for playback.';

  return (
    <div
      role="region"
      aria-labelledby="gate-heading"
      className="relative overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface)] ring-1 ring-[var(--color-line)]"
    >
      {!compact && <div className="aspect-video w-full bg-black/45" aria-hidden="true" />}

      <div
        className={
          compact
            ? 'flex flex-col items-start gap-2.5 p-5'
            : 'absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center'
        }
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[var(--color-muted)]"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 116 0v3H9z" />
          </svg>
        </span>

        <h2 id="gate-heading" className="text-sm font-semibold">
          {heading}
        </h2>
        <p className="max-w-sm text-[13px] leading-relaxed text-[var(--color-muted)]">{body}</p>
        <p className="max-w-sm text-xs text-[var(--color-faint)]">{sub}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Link to="/auth" className="btn-primary px-3.5 py-1.5 text-[13px]">
            Sign in
          </Link>
          <Link to="/auth?mode=signup" className="btn-secondary px-3.5 py-1.5 text-[13px]">
            Create a free account
          </Link>
        </div>
      </div>
    </div>
  );
}