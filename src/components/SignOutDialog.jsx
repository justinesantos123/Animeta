import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { preferredName } from '../context/AuthContext';

const TITLE = 'You are about to sign out. Do you want to continue?';

/**
 * Confirmation before signing out. Applies to every role: regular users,
 * moderators and admins all pass through here, so nobody loses a half-finished
 * session by muscle memory.
 */
export default function SignOutDialog({ open, onCancel }) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);

  // Move focus into the dialog so keyboard users are not stranded behind it.
  useEffect(() => {
    if (!open) return undefined;
    confirmRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  async function onConfirm() {
    await logout();
    onCancel();
    navigate('/');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signout-title"
        className="relative w-full max-w-sm rounded-[var(--radius-card)] bg-surface p-6 shadow-2xl ring-1 ring-[var(--color-line-strong)]"
      >
        <h2 id="signout-title" className="text-base font-bold">
          {TITLE}
        </h2>
        <p className="mt-2 text-sm text-muted">
          You are signed in as{' '}
          <span className="text-text">{user ? preferredName(user) : ''}</span>. Anything you have
          not saved will be lost.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-control)] bg-surface-2 px-4 py-2 text-sm font-semibold ring-1 ring-[var(--color-line-strong)] transition hover:bg-[var(--color-surface-3)]"
          >
            Stay signed in
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
