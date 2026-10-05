import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const VISIBLE_MS = 7000;

/**
 * One-shot greeting shown after a successful sign-in or sign-up.
 *
 * Driven by AuthContext state rather than sessionStorage: the banner mounts
 * when the app does, so it would read a storage flag before login ever wrote
 * it and never show anything.
 */
export default function WelcomeBanner() {
  const { greeting, dismissGreeting } = useAuth();

  useEffect(() => {
    if (!greeting) return undefined;
    const hide = setTimeout(dismissGreeting, VISIBLE_MS);
    return () => clearTimeout(hide);
  }, [greeting, dismissGreeting]);

  if (!greeting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-16 z-30 mx-auto mt-4 w-full max-w-7xl px-4"
    >
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-accent/15 px-4 py-3 ring-1 ring-accent/40 backdrop-blur-md">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
          {greeting.name.charAt(0).toUpperCase()}
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">
            {greeting.fresh ? 'Welcome to Animeta, ' : 'Welcome back, '}
            {greeting.name}
          </span>
        </p>
        <button
          type="button"
          onClick={dismissGreeting}
          aria-label="Dismiss greeting"
          className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}