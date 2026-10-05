import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Only same-site paths, so `next` cannot be used as an open redirect. */
function safeNext(value) {
  if (!value) return '/';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function AuthPage() {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // The playback gate sends people here with ?next=/title/... so signing in
  // drops them straight back on the episode they were trying to watch.
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">You&rsquo;re signed in</h1>
        <p className="mt-2 text-sm text-muted">{user.email}</p>
        <button
          type="button"
          onClick={() => navigate(next, { replace: true })}
          className="mt-6 rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Continue browsing
        </button>
      </div>
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, username.trim());
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-lg bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  return (
    <div className="mx-auto max-w-md px-4 py-16 pb-24">
      <div className="rounded-2xl bg-surface p-7 ring-1 ring-white/10">
        <h1 className="text-xl font-extrabold">
          {mode === 'login' ? 'Sign in to Animeta' : 'Create your account'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {mode === 'login'
            ? 'Your watchlist and progress follow you across devices.'
            : 'Save titles and pick up where you left off.'}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          {mode === 'signup' && (
            <div>
              <label htmlFor="username" className="mb-1 block text-xs font-medium text-muted">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                maxLength={30}
                pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,29}"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder="your_handle"
                aria-describedby="username-help"
              />
              <p id="username-help" className="mt-1 text-[11px] text-muted">
                3-30 characters. Letters, numbers, underscores and hyphens. Must be unique.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-cta/15 px-3 py-2 text-xs text-cta ring-1 ring-cta/30">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-muted">
          {mode === 'login' ? "Don't have an account? " : 'Already registered? '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
            }}
            className="font-semibold text-accent hover:underline"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>

        {mode === 'login' && (
          <p className="mt-2 text-center text-xs text-muted">
            <Link to="/forgot-password" className="text-muted hover:text-text hover:underline">
              Forgot your password?
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}