import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

/**
 * Lands from the confirmation link in the signup email.
 *
 * The token is spent on mount rather than on a button press, because arriving
 * here *is* the confirmation. Re-spending is guarded: React 18 mounts twice in
 * StrictMode, and a token works only once, so without the guard the second mount
 * would show "this link is not valid" immediately after it succeeded.
 */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();

  const token = params.get('token');

  // The missing-token case is the initial state rather than something set inside
  // the effect: a link with no token is wrong from the first render and needs no
  // request, so there is nothing to wait for.
  const [state, setState] = useState(token ? 'working' : 'failed');
  const [message, setMessage] = useState(
    token ? null : 'That confirmation link is incomplete. Ask for a new one.',
  );
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const spent = useRef(false);

  useEffect(() => {
    if (!token) return undefined;
    // React 18 mounts twice in StrictMode and a token works exactly once, so
    // without this guard the second mount would spend an already-spent token and
    // report the link as invalid immediately after it worked.
    if (spent.current) return undefined;
    spent.current = true;

    let cancelled = false;
    verifyEmail(token)
      .then(() => {
        if (cancelled) return;
        setState('done');
        // Straight in: they have just proved the address, so making them sign in
        // again on top of it would be busywork.
        navigate('/', { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        setState('failed');
        setMessage(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [token, verifyEmail, navigate]);

  async function resend() {
    if (!email) return;
    setBusy(true);
    setMessage(null);
    try {
      const d = await api.resendVerification(email);
      setMessage(
        d.sent
          ? 'Sent. Check your inbox for a new confirmation link.'
          : 'Email is not sending yet on this deployment. Try again once it is configured.',
      );
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 pb-24">
      <div className="rounded-[var(--radius-card)] bg-surface p-7 ring-1 ring-[var(--color-line-strong)]">
        {state === 'working' && (
          <>
            <h1 className="text-xl font-bold">Confirming your email…</h1>
            <p className="mt-2 text-sm text-muted">One moment.</p>
          </>
        )}

        {state === 'done' && (
          <>
            <h1 className="text-xl font-bold">Email confirmed</h1>
            <p className="mt-2 text-sm text-muted">Your account is ready.</p>
          </>
        )}

        {state === 'failed' && (
          <>
            <h1 className="text-xl font-bold">That link did not work</h1>
            <p className="mt-2 text-sm text-muted">{message}</p>

            <div className="mt-5">
              <label
                htmlFor="resend-email"
                className="mb-1 block text-xs font-medium text-muted"
              >
                Send a new link to
              </label>
              <input
                id="resend-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[var(--radius-control)] bg-surface px-4 py-2.5 text-sm text-text ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
                placeholder="you@example.com"
              />
              <button
                type="button"
                onClick={resend}
                disabled={busy || !email}
                className="mt-3 w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Send a new link'}
              </button>
            </div>
          </>
        )}

        <Link
          to="/auth"
          className="mt-6 block text-center text-xs text-muted hover:text-text hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}