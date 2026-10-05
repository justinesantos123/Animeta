import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

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
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Shown instead of the form once an account exists but the address is not
  // proved. Reached by signing up, and by trying to sign in with an address that
  // was never confirmed.
  const [awaiting, setAwaiting] = useState(null);
  const [sentNotice, setSentNotice] = useState(null);
  // Only ever set when email delivery is not configured, in which case the
  // Worker hands the link back instead of mailing it.
  const [manualLink, setManualLink] = useState(null);

  if (user) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">You&rsquo;re signed in</h1>
        <p className="mt-2 text-sm text-muted">{user.email}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {next !== '/' && (
            <Link
              to={next}
              className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
            >
              {next.startsWith('/title/') ? 'Back to the title' : 'Continue'}
            </Link>
          )}
          <Link
            to="/browse"
            className="rounded-[var(--radius-control)] bg-surface px-5 py-2.5 text-sm font-semibold text-text ring-1 ring-[var(--color-line-strong)] transition hover:bg-surface-2"
          >
            Continue browsing
          </Link>
        </div>
      </div>
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSentNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        navigate(next, { replace: true });
        return;
      }

      const d = await signup(email, password, username.trim(), phone.trim());
      if (d.needsVerification) {
        setEmail(d.email || email);
        setAwaiting(d.email || email);
        setManualLink(d.verifyUrl ?? null);
        return;
      }
      navigate(next, { replace: true });
    } catch (err) {
      // An account that exists but was never confirmed comes back as 403 with a
      // marker. It is not a wrong password, so it must not be shown as one.
      if (err.needsVerification) {
        setAwaiting(err.email || email);
        setError(null);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!awaiting) return;
    setError(null);
    setBusy(true);
    try {
      const d = await api.resendVerification(awaiting);
      setSentNotice(
        d.sent
          ? 'Sent. Check your inbox for a new confirmation link.'
          : 'Email is not sending yet, so the link has to come from the site for now.',
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-[var(--radius-control)] bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  // The confirmation step replaces the form entirely. Nothing here asks for the
  // password or a code: the link in the email is the whole proof.
  if (awaiting) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 pb-24">
        <div className="rounded-[var(--radius-card)] bg-surface p-7 ring-1 ring-[var(--color-line-strong)]">
          <h1 className="text-xl font-bold">Confirm your email</h1>
          <p className="mt-2 text-sm text-muted">
            Your account is created, but it stays switched off until the address is confirmed. Open
            the link we sent to <span className="font-semibold text-text">{awaiting}</span>.
          </p>

          {manualLink && (
            <div className="mt-4 rounded-[var(--radius-control)] bg-accent/10 p-3 ring-1 ring-accent/40">
              <p className="text-xs font-semibold text-accent">
                Email delivery is not configured on this deployment
              </p>
              <p className="mt-1 text-[11px] text-muted">
                No message can be sent yet, so here is the link directly. Add a
                <code className="mx-1">RESEND_API_KEY</code> secret and real emails go out instead.
              </p>
              <a
                href={manualLink}
                className="mt-2 block break-all text-xs text-accent underline decoration-dotted hover:text-text"
              >
                {manualLink}
              </a>
            </div>
          )}

          {sentNotice && (
            <p className="mt-4 rounded-[var(--radius-control)] bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 ring-1 ring-emerald-500/30">
              {sentNotice}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30"
            >
              {error}
            </p>
          )}

          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={resend}
              disabled={busy}
              className="w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send the link again'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAwaiting(null);
                setManualLink(null);
                setSentNotice(null);
                setError(null);
              }}
              className="w-full rounded-[var(--radius-control)] bg-surface-2 px-4 py-2.5 text-sm font-semibold text-text transition hover:bg-surface-3"
            >
              Use a different address
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 pb-24">
      <div className="rounded-[var(--radius-card)] bg-surface p-7 ring-1 ring-[var(--color-line-strong)]">
        <h1 className="text-xl font-bold">
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
              aria-describedby={mode === 'signup' ? 'email-help' : undefined}
            />
            {mode === 'signup' && (
              <p id="email-help" className="mt-1 text-[11px] text-muted">
                We send one confirmation link here. The account stays off until it is opened.
              </p>
            )}
          </div>

          {mode === 'signup' && (
            <div>
              <label htmlFor="phone" className="mb-1 block text-xs font-medium text-muted">
                Phone number <span className="text-faint">(optional)</span>
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                placeholder="+63 917 123 4567"
                aria-describedby="phone-help"
              />
              <p id="phone-help" className="mt-1 text-[11px] text-muted">
                Optional, and never verified. No code is sent to it and no message ever is. Only
                your email is confirmed.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={mode === 'signup' ? 'At least 10 characters' : '••••••••'}
            />
            {mode === 'signup' && (
              <p className="mt-1 text-[11px] text-muted">
                At least 10 characters, with a lowercase letter, a capital letter and a number.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
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