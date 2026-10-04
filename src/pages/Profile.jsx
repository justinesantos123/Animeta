import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, preferredName } from '../context/AuthContext';

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

  const input =
    'w-full rounded-lg bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

  return (
    <div className="mx-auto max-w-md px-4 py-10 pb-24">
      <h1 className="text-2xl font-extrabold">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {preferredName(user)} · {user.role}
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl bg-surface p-6 ring-1 ring-white/10">
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

        <div className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">
          Email <span className="text-text">{user.email}</span> (cannot be changed here)
        </div>

        {message && (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 text-xs ring-1 ${
              message.ok
                ? 'bg-accent/15 text-accent ring-accent/30'
                : 'bg-cta/15 text-cta ring-cta/30'
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
