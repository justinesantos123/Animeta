/**
 * Shown in place of the player, or over an episode that needs an account.
 *
 * Browsing stays open to everyone; this only blocks the moment of playback.
 * On an episodic title the first episode still plays as a preview, so this
 * appears on the episode list rather than over the whole player.
 */
import { Link } from 'react-router-dom';

export default function PlaybackGate({
  title,
  episodeTitle,
  firstEpisodeIsFree = false,
}) {
  // Which thing is being blocked: the whole title, or one episode?
  const subject = episodeTitle
    ? `Episode "${episodeTitle}" is for members.`
    : firstEpisodeIsFree
      ? `${title} continues after the free first episode.`
      : `${title} is for members.`;

  const detail = episodeTitle
    ? `Create a free account to keep watching this and the rest of the season.`
    : firstEpisodeIsFree
      ? `Watch episode 1 now, then sign up to continue to episode 2 and beyond.`
      : `Browsing is free. An account is only needed to start playback.`;

  return (
    <div
      role="region"
      aria-labelledby="gate-heading"
      className="relative overflow-hidden rounded-2xl bg-surface ring-1 ring-white/10"
    >
      <div className={episodeTitle ? 'px-6 py-8 text-center' : 'aspect-video w-full bg-black/50'} aria-hidden="true" />

      <div
        className={
          episodeTitle
            ? 'flex flex-col items-center gap-2 p-4 text-center'
            : 'absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center'
        }
      >
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/20 text-accent ring-1 ring-accent/40"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 116 0v3H9z" />
          </svg>
        </span>

        <h2 id="gate-heading" className="text-base font-bold">
          {episodeTitle ? 'Members only' : 'Sign in to continue'}
        </h2>
        <p className="max-w-sm text-sm text-muted">
          {subject} {detail}
        </p>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Link
            to="/auth"
            className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Sign in
          </Link>
          <Link
            to="/auth?mode=signup"
            className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-text ring-1 ring-white/10 transition hover:bg-surface-2"
          >
            Create a free account
          </Link>
        </div>

        {firstEpisodeIsFree && (
          <p className="mt-1 text-xs text-muted">
            Episode 1 is free to watch without an account.
          </p>
        )}
      </div>
    </div>
  );
}