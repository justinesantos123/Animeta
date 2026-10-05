import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, preferredName } from '../context/AuthContext';

const input =
  'w-full rounded-[var(--radius-control)] bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

export default function Profile() {
  const { user, ready } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!user) return;
    setUsername(user.username || '');
    setDisplayName(user.displayName || '');
  }, [user]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.updateProfile({ username: username.trim(), displayName: displayName.trim() });
      // /auth/me is refetched on the next mount; refresh now so the nav updates.
      setMessage({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-bold">You need to be signed in</h1>
        <Link to="/auth" className="mt-4 inline-block text-sm text-accent hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 pb-24">
      <h1 className="text-2xl font-bold">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {preferredName(user)} · {user.role}
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-[var(--radius-card)] bg-surface p-6 ring-1 ring-[var(--color-line-strong)]">
        <div>
          <label htmlFor="p-username" className="mb-1 block text-xs font-medium text-muted">
            Username
          </label>
          <input
            id="p-username"
            required
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,29}"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={input}
            placeholder="your_handle"
            aria-describedby="p-username-help"
          />
          <p id="p-username-help" className="mt-1 text-[11px] text-muted">
            3-30 characters. Letters, numbers, underscores and hyphens. Must be unique.
          </p>
        </div>

        <div>
          <label htmlFor="p-display" className="mb-1 block text-xs font-medium text-muted">
            Display name (optional)
          </label>
          <input
            id="p-display"
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={input}
            placeholder="How you want to be greeted"
          />
          <p className="mt-1 text-[11px] text-muted">
            Used in the welcome message. Falls back to your username.
          </p>
        </div>

        <div className="rounded-[var(--radius-control)] bg-bg px-3 py-2 text-xs text-muted">
          Email <span className="text-text">{user.email}</span> (cannot be changed here)
        </div>

        {message && (
          <p
            role="status"
            className={`rounded-[var(--radius-control)] px-3 py-2 text-xs ring-1 ${
              message.ok
                ? 'bg-accent/15 text-accent ring-accent/30'
                : 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/30'
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <AccountDeletion />
    </div>
  );
}

/**
 * Self-service account deletion with a recovery window.
 *
 * Two states, because deleting an account signs it out and that is the point at
 * which the user is most likely to change their mind:
 *
 *   signed in      a danger zone asking for the password to confirm.
 *   deleted        a countdown with a restore button, readable from the session
 *                  cookie alone since the account itself no longer authenticates.
 */
function AccountDeletion() {
  const { user, ready, refresh } = useAuth();
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    api
      .deletionStatus()
      .then((d) => {
        if (!cancelled) setStatus(d);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  if (!user && !status?.pending) return null;

  if (status?.pending) {
    const gone = !status.restorable;
    return (
      <section
        aria-labelledby="deletion-heading"
        className="mt-6 rounded-[var(--radius-card)] bg-surface p-6 ring-1 ring-[var(--color-danger)]/40"
      >
        <h2 id="deletion-heading" className="text-sm font-semibold text-[var(--color-danger)]">
          Account scheduled for deletion
        </h2>

        {gone ? (
          <p className="mt-2 text-xs text-muted">
            The {status.restoreWindowDays}-day recovery window has closed. This account and its
            data are deleted for good, and signing in with it again will no longer work.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted">
              {status.email} was deleted and can be restored for{' '}
              <span className="font-semibold text-text">
                {status.daysLeft} more {status.daysLeft === 1 ? 'day' : 'days'}
              </span>
              . After that it is deleted permanently and cannot be recovered by anyone.
            </p>

            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                setMessage(null);
                try {
                  await api.restoreOwnAccount();
                  const d = await api.deletionStatus();
                  setStatus(d);
                  await refresh();
                  setMessage({ ok: true, text: 'Your account has been restored.' });
                } catch (e) {
                  setMessage({ ok: false, text: e.message });
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="mt-4 w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
            >
              {busy ? 'Restoring…' : 'Restore this account'}
            </button>
          </>
        )}

        {message && (
          <p
            role="status"
            className={`mt-3 rounded-[var(--radius-control)] px-3 py-2 text-xs ring-1 ${
              message.ok
                ? 'bg-accent/15 text-accent ring-accent/30'
                : 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/30'
            }`}
          >
            {message.text}
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="deletion-heading"
      className="mt-6 rounded-[var(--radius-card)] bg-surface p-6 ring-1 ring-[var(--color-line-strong)]"
    >
      <h2 id="deletion-heading" className="text-sm font-semibold">
        Delete this account
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Your account stops working immediately and your watchlist, history and notifications are
        removed. You can undo this for 7 days by signing in again with the same email and password.
        After that it is deleted permanently.
      </p>

      {confirming ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage(null);
            try {
              const d = await api.deleteOwnAccount(password);
              setPassword('');
              setConfirming(false);
              setStatus(await api.deletionStatus());
              await refresh();
              setMessage({ ok: true, text: d.message });
            } catch (err) {
              setMessage({ ok: false, text: err.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-xs font-medium text-[var(--color-danger)]">
            This cannot be undone after 7 days. Enter your password to confirm.
          </p>
          <div>
            <label htmlFor="delete-password" className="mb-1 block text-xs font-medium text-muted">
              Password
            </label>
            <input
              id="delete-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !password}
              className="flex-1 rounded-[var(--radius-control)] bg-[var(--color-danger)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword('');
                setMessage(null);
              }}
              className="rounded-[var(--radius-control)] bg-surface-2 px-4 py-2.5 text-sm font-semibold text-muted transition hover:text-text"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 w-full rounded-[var(--radius-control)] bg-surface-2 px-4 py-2.5 text-sm font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-danger)]/10"
        >
          Delete my account
        </button>
      )}

      {message && (
        <p
          role="status"
          className={`mt-3 rounded-[var(--radius-control)] px-3 py-2 text-xs ring-1 ${
            message.ok
              ? 'bg-accent/15 text-accent ring-accent/30'
              : 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/30'
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
