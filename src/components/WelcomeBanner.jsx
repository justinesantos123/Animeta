import { useEffect, useState } from 'react';

const KEY = 'animeta:justLoggedIn';
const VISIBLE_MS = 7000;

/**
 * One-shot greeting shown after a successful sign-in or sign-up.
 *
 * The flag is written by AuthContext and cleared here, so a page refresh does
 * not replay it and a sign-out cannot leave it queued.
 */
export default function WelcomeBanner() {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let raw;
    try {
      raw = sessionStorage.getItem(KEY);
      if (raw) sessionStorage.removeItem(KEY);
    } catch {
      return; // private mode / storage disabled
    }
    if (!raw) return;

    try {
      const data = JSON.parse(raw);
      if (data?.name) setMessage(data);
    } catch {
      /* malformed flag - ignore */
    }
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const hide = setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => clearTimeout(hide);
  }, [message]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-16 z-30 mx-auto mt-4 w-full max-w-7xl px-4"
    >
      <div className="flex items-center gap-3 rounded-xl bg-accent/15 px-4 py-3 ring-1 ring-accent/40 backdrop-blur-md">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
          {(message.name || '?').charAt(0).toUpperCase()}
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">
            {message.fresh ? 'Welcome to Animeta, ' : 'Welcome back, '}
            {message.name}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setMessage(null)}
          aria-label="Dismiss greeting"
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
