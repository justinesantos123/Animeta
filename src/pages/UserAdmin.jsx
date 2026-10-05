import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { DaysOffline, PresenceChip } from '../components/AdminDashboard';
import { timeAgo } from '../utils/timeAgo';

const INPUT =
  'w-full rounded-lg bg-bg px-3 py-2 text-sm text-text ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

/**
 * Reveals a value exactly once with a copy button.
 *
 * Passwords are PBKDF2-hashed at rest, so the API can only ever return a
 * freshly generated password at the moment it is reset. This component makes
 * that one-time nature explicit instead of implying it can be looked up later.
 */
function OneTimeSecret({ secret, label, onDismiss, hint }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const isUrl = secret.startsWith('http');

  return (
    <div className="rounded-xl bg-accent/10 p-4 ring-1 ring-accent/40">
      <p className="text-xs font-semibold text-accent">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isUrl ? (
          <a
            href={secret}
            className="max-w-full break-all text-sm text-accent underline decoration-dotted hover:text-text"
          >
            {secret}
          </a>
        ) : (
          <code className="select-all break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-sm text-text">
            {secret}
          </code>
        )}
        <button
          type="button"
          onClick={copy}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-muted transition hover:text-text"
        >
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

export default function UserAdmin({ canDelete = false }) {
  const { user } = useAuth();
  const [state, setState] = useState({ users: [], ownerEmail: null, mailConfigured: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [secret, setSecret] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [showPasswords, setShowPasswords] = useState(false);

  const isOwner =
    state.ownerEmail && user && user.email.toLowerCase() === state.ownerEmail.toLowerCase();

  const load = useCallback(async () => {
    try {
      const d = await api.listUsers();
      setState(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function withBusy(id, fn) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const onReset = (target) =>
    withBusy(target.id, async () => {
      const d = await api.resetUserPassword(target.id);
      setSecret({
        value: d.password,
        label: `New password for ${d.email}`,
        hint: 'Shown once and never stored in readable form. If you lose it, reset again â€” nobody can retrieve it later.',
      });
    });

  const onSendLink = (target) =>
    withBusy(target.id, async () => {
      const d = await api.sendUserResetLink(target.id);
      setSecret({
        value: d.resetUrl,
        label: d.emailed
          ? `Reset link emailed to ${d.email}`
          : `Reset link for ${d.email}`,
        hint: d.emailed
          ? `They can set their own password from this link. It expires in ${d.expiresMinutes} minutes and works only once.`
          : `Email is not sending yet (${d.deliveryReason}), so send them this link yourself. It expires in ${d.expiresMinutes} minutes and works only once.`,
      });
    });

  const onRole = (target, role) =>
    withBusy(target.id, async () => {
      await api.setUserRole(target.id, role);
    });

  const onDelete = (target) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${target.email}? Their watchlist and history go too.`)) return;
    withBusy(target.id, async () => {
      await api.deleteUser(target.id);
    });
  };

  /** user -> moderator -> admin, capped at admin. */
  const nextRole = (role) => (role === 'user' ? 'moderator' : 'admin');

  const onCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const d = await api.createUser({ email: newEmail, role: newRole, username: newUsername.trim() });
      if (d.password) {
        setSecret({ value: d.password, label: `Password for ${d.email}` });
      }
      setNewEmail('');
      setNewUsername('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-3 py-8 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        Loading usersâ€¦
      </p>
    );
  }

  const cell = 'px-4 py-3 text-sm';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Users</h2>
        <p className="mt-1 text-sm text-muted">
          Passwords are hashed and cannot be viewed. Reset one to hand a tester a working login.
        </p>
        {!state.mailConfigured && (
          <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted ring-1 ring-white/10">
            Email delivery is not configured, so reset links are shown here instead of being sent.
          </p>
        )}
      </div>

      {secret && (
        <OneTimeSecret
          secret={secret.value}
          label={secret.label}
          hint={secret.hint}
          onDismiss={() => setSecret(null)}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-cta/15 px-3 py-2 text-xs text-cta ring-1 ring-cta/30">
          {error}
        </p>
      )}

      {/* Create account */}
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3 rounded-xl bg-surface p-4 ring-1 ring-white/10">
        <div className="min-w-56 flex-1">
          <label htmlFor="new-user-email" className="mb-1 block text-xs font-medium text-muted">
            New user email
          </label>
          <input
            id="new-user-email"
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={INPUT}
          />
          <p className="mt-1 text-[11px] text-muted">
            Leave the username blank to derive one from the email address.
          </p>
        </div>

          <div>
            <label htmlFor="new-user-username" className="mb-1 block text-xs font-medium text-muted">
              Username (optional)
            </label>
            <input
              id="new-user-username"
              type="text"
              maxLength={30}
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,29}"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className={INPUT}
              placeholder="their_handle"
            />
          </div>
        <div>
          <label htmlFor="new-user-role" className="mb-1 block text-xs font-medium text-muted">
            Role
          </label>
          <select
            id="new-user-role"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="rounded-lg bg-bg px-3 py-2 text-sm text-text ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="user">User</option>
            <option value="moderator">Moderator</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {creating ? 'Creatingâ€¦' : 'Create account'}
        </button>
        {newRole === 'admin' && !isOwner && (
          <p className="w-full text-[11px] text-muted">
            Only the owner can create admins, so this will be created as a regular user.
          </p>
        )}
      </form>

      {/* Password identity. Never the password itself - a short non-reversible
          code so staff can tell whether a credential is the one in use. */}
      <div className="rounded-xl bg-surface p-4 ring-1 ring-white/10">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text">
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(e) => setShowPasswords(e.target.checked)}
            className="accent-[#7B61FF]"
          />
          Show password fingerprints
        </label>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Passwords are hashed with PBKDF2 and cannot be read by anyone, including the owner. This
          shows an 8-character code derived from the current password so you can confirm whether an
          account is still using the password you set. Resetting an account changes the code.
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl ring-1 ring-white/10">
        <table className="w-full min-w-3xl border-collapse bg-surface">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted">
              <th className={`${cell} font-medium`}>Username</th>
              <th className={`${cell} font-medium`}>Email</th>
              <th className={`${cell} font-medium`}>Role</th>
              <th className={`${cell} font-medium`}>Joined</th>
              <th className={`${cell} font-medium`}>Watchlist</th>
              <th className={`${cell} font-medium`}>Last active</th>
              <th className={`${cell} font-medium`}>Days offline</th>
              {showPasswords && <th className={`${cell} font-medium`}>Password</th>}
              <th className={`${cell} font-medium`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {state.users.map((u) => (
              <tr key={u.id}>
                <td className={cell}>
                  <span className="text-text">@{u.username || 'â€”'}</span>
                </td>
                <td className={cell}>
                  <span className="text-text">{u.email}</span>
                  {u.isOwner && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      owner
                    </span>
                  )}
                </td>
                <td className={cell}>
                  <span className={u.role === 'admin' ? 'text-accent' : 'text-muted'}>{u.role}</span>
                </td>
                <td className={`${cell} text-muted`}>
                  {u.createdAt ? new Date(u.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString() : 'â€”'}
                </td>
                <td className={`${cell} text-muted`}>{u.watchlistCount}</td>
                <td className={cell}>
                  <span className="text-muted">{timeAgo(u.lastSeenAt)}</span>
                </td>
                <td className={cell}>
                  <DaysOffline days={u.daysOffline} presence={u.presence} />
                  <div className="mt-1">
                    <PresenceChip presence={u.presence} />
                  </div>
                </td>
                {showPasswords && (
                  <td className={cell}>
                    <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-accent">
                      {u.passwordFingerprint || 'â€”'}
                    </code>
                    {u.passwordHistory?.length > 0 && (
                      <p className="mt-1 text-[10px] text-muted">
                        {u.passwordHistory[0].action.replace('user.password.', '')} Â·{' '}
                        {u.passwordHistory[0].at?.replace(' ', 'T').slice(0, 10)}
                      </p>
                    )}
                  </td>
                )}
                <td className={cell}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => onReset(u)}
                      className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:brightness-125 disabled:opacity-50"
                    >
                      Reset password
                    </button>

                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => onSendLink(u)}
                      className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:brightness-125 disabled:opacity-50"
                    >
                      Send reset link
                    </button>

                    {/* Deletion: admins and the owner. Moderators cannot.
                        Role changes: owner only. */}
                    {isOwner && !u.isOwner && (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => onRole(u, nextRole(u.role))}
                        className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-accent transition hover:brightness-125 disabled:opacity-50"
                      >
                        {nextRole(u.role) === 'admin' ? 'Make admin' : 'Make moderator'}
                      </button>
                    )}

                    {canDelete && !u.isOwner && u.id !== user?.id && (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => onDelete(u)}
                        className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-cta transition hover:brightness-125 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted">
        You are {isOwner ? 'the owner' : 'an admin'}. Only the owner can promote, demote or delete
        accounts.
      </p>
    </div>
  );
}