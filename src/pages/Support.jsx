import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TicketsPanel from '../components/TicketsPanel';

/**
 * A member's support tickets.
 *
 * The open ticket lives in the URL (/support/:ticketId) rather than in component
 * state, so refreshing lands back in the conversation instead of the list. A
 * reload on a route that only exists in memory loses the place you were.
 *
 * Staff use the Tickets tab in the staff console instead, because they need the
 * requester's address alongside each ticket, which has no place on a page a member
 * can reach.
 */
export default function Support() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const { ticketId } = useParams();

  useEffect(() => {
    if (ready && !user) navigate(`/auth?next=${encodeURIComponent(`/support/${ticketId ?? ''}`)}`.replace(/\/$/, ''), { replace: true });
  }, [ready, user, navigate, ticketId]);

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-24 text-center">
        <p className="text-sm text-muted">Checking access…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-bold">Support</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Ask staff about anything wrong with your account or with a title. Replies arrive here and
        as a notification. Links are not allowed in a ticket, so keep it to the problem itself.
      </p>

      <div className="mt-6">
        <TicketsPanel
          mode="member"
          ticketId={ticketId ?? null}
          onSelect={(id) => navigate(id ? `/support/${id}` : '/support', { replace: false })}
        />
      </div>

      <p className="mt-8 text-xs text-muted">
        Need your username or password changed? Those are on{' '}
        <Link to="/profile" className="text-accent hover:underline">
          your profile
        </Link>
        .
      </p>
    </div>
  );
}