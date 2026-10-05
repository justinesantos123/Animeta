import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full rounded-[var(--radius-control)] bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <div className="rounded-[var(--radius-card)] bg-surface p-7 text-center ring-1 ring-[var(--color-line-strong)]">
          <p className="text-2xl">✓</p>
          <h1 className="mt-2 text-xl font-bold">Password updated</h1>
          <p className="mt-2 text-sm text-muted">
            You can now sign in with your new password.
          </p>
          <Link
            to="/auth"
            className="mt-6 inline-block rounded-[var(--radius-control)] bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 pb-24">
      <div className="rounded-[var(--radius-card)] bg-surface p-7 ring-1 ring-[var(--color-line-strong)]">
        <h1 className="text-xl font-bold">Choose a new password</h1>

        {!token ? (
          <>
            <p className="mt-2 text-sm text-muted">
              This page needs a reset link. Request one from the sign-in page.
            </p>
            <Link
              to="/auth"
              className="mt-6 inline-block rounded-[var(--radius-control)] bg-surface-2 px-4 py-2.5 text-sm font-semibold ring-1 ring-[var(--color-line-strong)]"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <div>
              <label htmlFor="new-password" className="mb-1 block text-xs font-medium text-muted">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-xs font-medium text-muted">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={input}
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
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
