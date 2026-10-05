import { Link, useLocation } from 'react-router-dom';

/**
 * Shown in place of the player when a title needs an account.
 *
 * Browsing stays open to everyone; this only blocks the moment of playback.
 * The return path is passed along so signing in lands back on the title.
 */
export default function PlaybackGate({ title, episodeCount }) {
  const { pathname } = useLocation();

  return (
    <div
      role="region"
      aria-labelledby="gate-heading"
      className="relative overflow-hidden rounded-2xl bg-surface ring-1 ring-white/10"
    >
      <div className="aspect-video w-full bg-black/50" aria-hidden="true" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/20 text-accent ring-1 ring-accent/40"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 116 0v3H9z" />
          </svg>
        </span>

        <h2 id="gate-heading" className="text-base font-bold">
          Sign in to watch
        </h2>
        <p className="max-w-sm text-sm text-muted">
          {title} {episodeCount > 0 ? `has ${episodeCount} episodes` : 'is an episodic title'}. You
          can browse everything here for free — an account is only needed to start playback.
        </p>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Link
            to={`/auth?next=${encodeURIComponent(pathname)}`}
            className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Sign in to continue
          </Link>
          <Link
            to={`/auth?mode=signup&next=${encodeURIComponent(pathname)}`}
            className="rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-text ring-1 ring-white/10 transition hover:bg-surface-2"
          >
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}