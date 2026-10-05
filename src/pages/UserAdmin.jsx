import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { PresenceChip } from '../components/AdminDashboard';

const INPUT =
  'w-full rounded-[var(--radius-control)] bg-bg px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent';

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
    <div className="rounded-[var(--radius-card)] bg-accent/10 p-4 ring-1 ring-accent/40">
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
          <code className="select-all break-all rounded-[var(--radius-control)] bg-black/40 px-3 py-2 font-mono text-sm text-text">
            {secret}
          </code>
        )}
        <button
          type="button"
          onClick={copy}
          className="rounded-[var(--radius-control)] bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-[var(--radius-control)] bg-surface px-3 py-2 text-xs font-semibold text-muted transition hover:text-text"
        >
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

/**
 * One of the two account tabs.
 *
 * `scope` is 'members' or 'staff' and decides which accounts are listed and what
 * the tab is for. The API is asked for that slice rather than the full list being
 * fetched and filtered here, so the two tabs cannot drift apart or show a row
 * from the other group.
 *
 * `canEditRoles` is admin. Granting and revoking is now any admin's job, not the
 * owner's alone: the ability to promote somebody has to be reversible by whoever
 * can promote, or the only way back is the owner.
 */
export default function UserAdmin({ canManage = false, canEditRoles = false, scope = 'members' }) {
  const { user } = useAuth();
  const [state, setState] = useState({
    users: [],
    ownerEmail: null,
    mailConfigured: false,
    permissionCatalogue: [],
    deleted: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [secret, setSecret] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [newPassword, setNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  // The password currently being set on an existing row, keyed by user id. Null
  // means that row's editor is closed.
  const [editingPasswordFor, setEditingPasswordFor] = useState(null);
  const [chosenPassword, setChosenPassword] = useState('');

  // Weak, but not refused. Staff choose this password themselves, so the policy
  // that guards a member's own choice is reported rather than enforced. The
  // warning is shown rather than swallowed, because this is the one place a
  // short password reaches an account without anybody being stopped.
  const [weakNotice, setWeakNotice] = useState(null);

  const isOwner =
    state.ownerEmail && user && user.email.toLowerCase() === state.ownerEmail.toLowerCase();
  const isStaffTab = scope === 'staff';

  const role = user?.role;

  const load = useCallback(async () => {
    try {
      const d = await api.listUsers(scope);
      // Pending deletions are a separate endpoint, and only admins may read it,
      // so a moderator with the "users" grant gets an empty list rather than an
      // error taking down the whole page.
      let deleted = [];
      if (role === 'admin') {
        deleted = (await api.listDeletedUsers().catch(() => ({ users: [] }))).users || [];
      }
      setState({ ...d, deleted });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [role, scope]);

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
        hint: 'Shown once and never stored in readable form. If you lose it, reset again — nobody can retrieve it later.',
      });
      setWeakNotice(null);
    });

  /**
   * Sets a password staff already know, on an account that already exists.
   *
   * This is not a way to read somebody's current password -- nothing can, and the
   * database holds only a hash. It overwrites it with one we choose, which is the
   * useful half: it makes an account signable by whoever set it without a
   * generated value having to be read out of a response and passed around.
   */
  const onSetChosenPassword = (target) =>
    withBusy(target.id, async () => {
      const d = await api.resetUserPassword(target.id, chosenPassword);
      setWeakNotice(
        d.weak
          ? `Password set for ${target.email}, but it is weak: ${d.weak.toLowerCase()}.`
          : `Password set for ${target.email}. Nobody but you knows it.`,
      );
      setEditingPasswordFor(null);
      setChosenPassword('');
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

  /**
   * Every role, so a demotion is a choice from a list rather than a button that
   * only ever moves somebody up.
   *
   * The single "next role" button this replaced could not demote: it cycled
   * user -> moderator -> admin, so reversing a promotion meant the owner going
   * into the database.
   */
  const onRole = (target, role) =>
    withBusy(target.id, async () => {
      await api.setUserRole(target.id, role);
    });

  /**
   * Replaces a moderator's permissions with the toggled set.
   *
   * The whole set is sent rather than one permission at a time, which is what
   * the endpoint expects: it replaces the grants so they cannot drift from what
   * the admin last saw checked.
   */
  const onTogglePermission = (target, permission, enabled) => {
    const next = new Set(target.permissions || []);
    if (enabled) next.add(permission);
    else next.delete(permission);
    return withBusy(target.id, async () => {
      await api.setUserPermissions(target.id, [...next]);
    });
  };

  const onRestore = (target) =>
    withBusy(target.id, async () => {
      await api.restoreUser(target.id);
    });

  const onPurge = (target) => {
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `Delete ${target.email} permanently? This cannot be undone by anyone.`,
      )
    ) {
      return;
    }
    withBusy(target.id, async () => {
      await api.purgeUser(target.id);
    });
  };

  const onDelete = (target) => {
    // Deletion is recoverable for a week, which is why the copy says so rather
    // than implying the account is already gone.
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `Delete ${target.email}? They can restore it by signing in within 7 days.`,
      )
    ) {
      return;
    }
    withBusy(target.id, async () => {
      await api.deleteUser(target.id);
    });
  };

  const onCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const d = await api.createUser({
        email: newEmail,
        role: newRole,
        username: newUsername.trim(),
        phone: newPhone.trim(),
        // Omitted when blank, so the server generates one and hands it back.
        password: newPassword || undefined,
      });
      if (d.password) {
        setSecret({ value: d.password, label: `Password for ${d.email}` });
      }
      setWeakNotice(null);
      setNewEmail('');
      setNewUsername('');
      setNewPhone('');
      setNewPassword('');
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
        Loading {isStaffTab ? 'staff' : 'members'}…
      </p>
    );
  }

  const cell = 'px-4 py-3 text-sm';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">{isStaffTab ? 'Staff' : 'Members'}</h2>
        <p className="mt-1 text-sm text-muted">
          {isStaffTab
            ? 'Everyone who can act on the site. Roles decide which tabs they see; permissions decide what they can actually do.'
            : 'Registered accounts. Passwords are hashed and cannot be viewed — reset one to hand somebody a working login.'}
        </p>
        {!state.mailConfigured && (
          <p className="mt-2 rounded-[var(--radius-control)] bg-surface px-3 py-2 text-xs text-muted ring-1 ring-[var(--color-line-strong)]">
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
        <p role="alert" className="rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30">
          {error}
        </p>
      )}

      {weakNotice && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-500/30"
        >
          {weakNotice}
        </p>
      )}

      {/* Create account */}
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] bg-surface p-4 ring-1 ring-[var(--color-line-strong)]">
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
          <label htmlFor="new-user-phone" className="mb-1 block text-xs font-medium text-muted">
            Phone (optional)
          </label>
          <input
            id="new-user-phone"
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className={INPUT}
            placeholder="+63 917 123 4567"
          />
          <p className="mt-1 text-[11px] text-muted">Collected, never verified or messaged.</p>
        </div>
        <div>
          <label htmlFor="new-user-password" className="mb-1 block text-xs font-medium text-muted">
            Password <span className="text-faint">(optional)</span>
          </label>
          <input
            id="new-user-password"
            type="text"
            autoComplete="off"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={INPUT}
            placeholder="leave blank to generate one"
          />
          <p className="mt-1 text-[11px] text-muted">
            Set one you know if you need to sign in as this account. Stored hashed either way, so
            nobody can read it back later.
          </p>
        </div>
        <div>
          <label htmlFor="new-user-role" className="mb-1 block text-xs font-medium text-muted">
            Role
          </label>
          <select
            id="new-user-role"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="rounded-[var(--radius-control)] bg-bg px-3 py-2 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="user">User</option>
            <option value="moderator">Moderator</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'Create account'}
        </button>
        {newRole === 'admin' && !isOwner && (
          <p className="w-full text-[11px] text-muted">
            Only the owner can create admins, so this will be created as a regular user.
          </p>
        )}
      </form>

      {/* Password identity. Never the password itself - a short non-reversible
          code so staff can tell whether a credential is the one in use. */}
      <div className="rounded-[var(--radius-card)] bg-surface p-4 ring-1 ring-[var(--color-line-strong)]">
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
      <div className="overflow-x-auto rounded-[var(--radius-card)] ring-1 ring-[var(--color-line-strong)]">
        <table className="w-full min-w-3xl border-collapse bg-surface">
          <thead>
            <tr className="border-b border-[var(--color-line-strong)] text-left text-xs uppercase tracking-wide text-muted">
              <th className={`${cell} font-medium`}>Username</th>
              <th className={`${cell} font-medium`}>Email</th>
              <th className={`${cell} font-medium`}>Phone</th>
              <th className={`${cell} font-medium`}>Role</th>
              <th className={`${cell} font-medium`}>Joined</th>
              {/* Deliberately a presence state and nothing else. The old "last
                  active" and "days offline" columns said how stale a record was,
                  which prompted a reading of inactivity as a problem to correct
                  rather than a fact about an account nobody is looking at. */}
              <th className={`${cell} font-medium`}>Active now</th>
              {showPasswords && <th className={`${cell} font-medium`}>Password</th>}
              <th className={`${cell} font-medium`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {state.users.map((u) => (
              <tr key={u.id}>
                <td className={cell}>
                  <span className="text-text">@{u.username || '—'}</span>
                </td>
                <td className={cell}>
                  <span className="text-text">{u.email}</span>
                  {u.isOwner && (
                    <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      owner
                    </span>
                  )}
                  {/* Only false for accounts registered since verification was
                      required and not yet confirmed. Those cannot sign in, so it
                      is worth saying so here. */}
                  {!u.emailVerified && (
                    <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      unconfirmed
                    </span>
                  )}
                </td>
                <td className={`${cell} text-muted`}>{u.phone || '—'}</td>
                <td className={cell}>
                  <span className={u.role === 'admin' ? 'text-accent' : 'text-muted'}>{u.role}</span>
                </td>
                <td className={`${cell} text-muted`}>
                  {u.createdAt ? new Date(u.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString() : '—'}
                </td>
                <td className={cell}>
                  <PresenceChip presence={u.presence} />
                </td>
                {showPasswords && (
                  <td className={cell}>
                    <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-accent">
                      {u.passwordFingerprint || '—'}
                    </code>
                    {u.passwordHistory?.length > 0 && (
                      <p className="mt-1 text-[10px] text-muted">
                        {u.passwordHistory[0].action.replace('user.password.', '')} ·{' '}
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
                      className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                    >
                      Generate password
                    </button>

                    <button
                      type="button"
                      disabled={busyId === u.id}
                      aria-expanded={editingPasswordFor === u.id}
                      onClick={() => {
                        setWeakNotice(null);
                        setChosenPassword('');
                        setEditingPasswordFor(editingPasswordFor === u.id ? null : u.id);
                      }}
                      className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-accent transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                    >
                      Set password
                    </button>

                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => onSendLink(u)}
                      className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                    >
                      Send reset link
                    </button>

                    {/* Role is a select rather than a promote/demote button pair, because a button
                      that only cycles upward cannot express "make this a member
                      again". The owner is fixed and its control is not rendered. */}
                    {canEditRoles && !u.isOwner && (
                      <select
                        aria-label={`Role for ${u.username || u.email}`}
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => onRole(u, e.target.value)}
                        className="rounded-[var(--radius-control)] bg-surface-2 px-2 py-1 text-xs font-semibold text-text ring-1 ring-[var(--color-line-strong)] outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                      >
                        <option value="user">Member</option>
                        <option value="moderator">Moderator</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                    {!canEditRoles && !u.isOwner && (
                      <span className="text-[11px] text-faint">owner-only changes</span>
                    )}

                    {/* Deletion is owner-only, and irreversible after the window. */}
                    {isOwner && !u.isOwner && u.id !== user?.id && (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => onDelete(u)}
                        className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {editingPasswordFor === u.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        onSetChosenPassword(u);
                      }}
                      className="mt-2 flex flex-wrap items-end gap-2"
                    >
                      <div>
                        <label
                          htmlFor={`pw-${u.id}`}
                          className="mb-1 block text-[11px] font-medium text-muted"
                        >
                          New password for @{u.username || u.email}
                        </label>
                        <input
                          id={`pw-${u.id}`}
                          type="text"
                          autoComplete="off"
                          minLength={8}
                          required
                          value={chosenPassword}
                          onChange={(e) => setChosenPassword(e.target.value)}
                          className="rounded-[var(--radius-control)] bg-bg px-2.5 py-1.5 text-xs text-text ring-1 ring-[var(--color-line-strong)] outline-none focus:ring-2 focus:ring-accent"
                          placeholder="at least 8 characters"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busyId === u.id || chosenPassword.length < 8}
                        className="rounded-[var(--radius-control)] bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
                      >
                        Set it
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPasswordFor(null)}
                        className="px-2 py-1.5 text-xs text-muted transition hover:text-text"
                      >
                        Cancel
                      </button>
                      <p className="w-full text-[10px] text-muted">
                        Overwrites the current password, which cannot be read back out of the
                        database. The account will need to sign in with this one.
                      </p>
                    </form>
                  )}

                  {/* Permission grants, on their own row so the toggles have room. Only
                       moderators have grants to give: an admin holds everything
                       implicitly and cannot be restricted. Admin-level, matching
                       the role control. */}
                  {u.role === 'moderator' && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {state.permissionCatalogue.map((p) => {
                        const checked = (u.permissions || []).includes(p.id);
                        return (
                          <label
                            key={p.id}
                            title={p.description}
                            className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canEditRoles || busyId === u.id}
                              onChange={(e) => onTogglePermission(u, p.id, e.target.checked)}
                              className="accent-[#7B61FF]"
                            />
                            {p.label}
                          </label>
                        );
                      })}
                      {u.permissions?.length > 0 && (
                        <span className="text-[11px] text-faint">
                          {u.permissions.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted">
        {isOwner
          ? 'You are the owner: you can change every role and permission, and delete accounts.'
          : canEditRoles
            ? 'You are an admin: you can change roles and permissions. Only the owner can delete an account.'
            : canManage
              ? 'You can view accounts and reset passwords. Changing roles needs an admin.'
              : 'Read-only.'}
      </p>

      {/* Said plainly, because the alternative is somebody asking for a
          "show password" button that can never exist. Passwords are stored as
          one-way hashes; what staff can do is overwrite one with a value they
          already know. */}
      <p className="rounded-[var(--radius-control)] bg-bg px-3 py-2 text-[11px] leading-relaxed text-muted ring-1 ring-[var(--color-line-strong)]">
        Nobody can read a password back. They are stored as one-way hashes, so there is no view,
        export or admin override that shows one &mdash; including yours. What you can do is{' '}
        <strong className="font-semibold text-text">set</strong> a password you already know with
        &ldquo;Set password&rdquo;, or generate one and read it once with &ldquo;Generate
        password&rdquo;.
      </p>

      {/* Accounts inside their recovery window. Kept separate from the main
          table because these rows are inert: they cannot sign in, and the only
          actions available are restoring or finishing the deletion. */}
      {state.deleted.length > 0 && (
        <div className="rounded-[var(--radius-card)] bg-surface p-4 ring-1 ring-[var(--color-danger)]/30">
          <h3 className="text-sm font-semibold">Pending deletion</h3>
          <p className="mt-1 text-[11px] text-muted">
            These accounts are switched off but still restorable until their window closes. After
            that they are deleted for good.
          </p>
          <ul className="mt-3 divide-y divide-white/5">
            {state.deleted.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-text">{d.email}</span>
                <span className="text-muted">
                  {d.deletedBy ? `removed by ${d.deletedBy}` : 'self-deleted'}
                </span>
                <span className={d.daysLeft > 0 ? 'text-muted' : 'text-[var(--color-danger)]'}>
                  {d.daysLeft > 0 ? `${d.daysLeft}d left to restore` : 'window closed'}
                </span>
                {d.daysLeft > 0 && (
                  <button
                    type="button"
                    disabled={busyId === d.id}
                    onClick={() => onRestore(d)}
                    className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-accent transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                  >
                    Restore
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === d.id}
                  onClick={() => onPurge(d)}
                  className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-1 text-xs font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-surface-3)] disabled:opacity-50"
                >
                  Delete now
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}