import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Standalone "forgot password" step.
 *
 * The API deliberately returns an identical response whether or not the email
 * exists, so this page cannot be used to discover registered accounts. When
 * email delivery is not configured the API hands back the reset link for the
 * admin to pass on manually, which is surfaced here as a testing convenience.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api.requestPasswordReset(email));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-[var(--radius-control)] bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  return (
    <div className="mx-auto max-w-md px-4 py-16 pb-24">
      <div className="rounded-[var(--radius-card)] bg-surface p-7 ring-1 ring-[var(--color-line-strong)]">
        <h1 className="text-xl font-bold">Reset your password</h1>

        {result ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-[var(--radius-control)] bg-accent/10 px-3 py-2.5 text-xs text-accent ring-1 ring-accent/30">
              {result.message}
            </p>

            {result.resetUrl && (
              <div className="rounded-[var(--radius-card)] bg-bg p-4 ring-1 ring-[var(--color-line-strong)]">
                <p className="text-xs font-semibold text-muted">
                  Email delivery is not configured, so here is the link directly:
                </p>
                <Link
                  to={`/reset-password?token=${result.resetUrl.split('token=')[1] ?? ''}`}
                  className="mt-2 block break-all text-xs text-accent hover:underline"
                >
                  {result.resetUrl}
                </Link>
              </div>
            )}

            <Link
              to="/auth"
              className="inline-block rounded-[var(--radius-control)] bg-surface-2 px-4 py-2.5 text-sm font-semibold ring-1 ring-[var(--color-line-strong)]"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <p className="text-sm text-muted">
              Enter the email on your account and we&rsquo;ll send a link to set a new password.
            </p>
            <div>
              <label htmlFor="reset-email" className="mb-1 block text-xs font-medium text-muted">
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
                placeholder="you@example.com"
              />
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
              {busy ? 'Sending…' : 'Send reset link'}
            </button>

            <Link to="/auth" className="block text-center text-xs text-accent hover:underline">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
