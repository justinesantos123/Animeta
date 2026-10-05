import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UserAdmin from './UserAdmin';
import AdminDashboard from '../components/AdminDashboard';
import CatalogAdmin from '../components/CatalogAdmin';
import TicketsPanel from '../components/TicketsPanel';
import { AnnouncementManager } from '../components/Announcements';
import { useNotifications } from '../context/NotificationsContext';

const STAFF = ['admin', 'moderator'];

/**
 * Which permission each tab requires.
 *
 * Tabs are hidden rather than shown-then-refused, so a moderator sees the parts
 * of the console they can actually use instead of five tabs that mostly 403.
 * This is presentation only: every action is re-checked server-side, so
 * widening the client gains nothing.
 *
 * Members and Staff are separate tabs because they are different jobs. One
 * combined "Users" list puts four staff accounts at the top of a page about
 * members, and makes it ambiguous whether a permission toggle on screen applies
 * to the person or to the row.
 */
const TABS = [
  { id: 'dashboard', label: 'Dashboard', permission: null, role: 'admin' },
  { id: 'catalog', label: 'Catalog', permission: 'catalog' },
  { id: 'members', label: 'Members', permission: 'users' },
  { id: 'staff', label: 'Staff', permission: 'users' },
  { id: 'tickets', label: 'Tickets', permission: 'tickets' },
  { id: 'announcements', label: 'Announcements', permission: 'announcements' },
];

/**
 * Admin console. Server-side authorization is the real gate (see worker/api.js);
 * this only hides the UI from non-admins.
 */
export default function Admin() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const { refresh: refreshNotifications } = useNotifications();
  const [tab, setTab] = useState('dashboard');

  // Keep this page out of search indexes.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    if (ready && !user) navigate('/auth', { replace: true });
  }, [ready, user, navigate]);

  if (!ready || !user || !STAFF.includes(user.role)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <p className="text-sm text-muted">Checking access…</p>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';

  // Admins hold every permission implicitly; the server sends the resolved list
  // so the two cannot disagree about who can do what.
  const granted = new Set(user.permissions || []);

  // Whether the viewer is the site owner. The server decides this from
  // OWNER_EMAIL and reports it via /api/admin/users, so it is not something to
  // infer from the role: a promoted admin is not the owner.
  const visibleTabs = TABS.filter((t) => {
    if (t.role === 'admin') return isAdmin;
    return !t.permission || granted.has(t.permission);
  });

  // A moderator demoted or un-permissioned mid-session must not keep viewing the
  // tab they were on, so fall back to whatever they can actually open.
  const fallbackTab = visibleTabs.some((t) => t.id === 'dashboard')
    ? 'dashboard'
    : (visibleTabs[0]?.id ?? null);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : fallbackTab;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-bold">Staff console</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {user.email} ·{' '}
        <span className={isAdmin ? 'text-accent' : 'text-muted'}>
          {isAdmin ? 'admin' : 'moderator'}
        </span>
      </p>

      {/* A moderator's reach is a grant list, so show it rather than implying
          "moderator" means one fixed set of abilities. */}
      {!isAdmin && (
        <p className="mt-1 text-xs text-muted">
          {granted.size
            ? `You can: ${[...granted].join(', ')}.`
            : 'You have no permissions yet. An admin can grant you some.'}
        </p>
      )}

      <div className="mt-6 flex gap-1 border-b border-[var(--color-line-strong)]" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              activeTab === t.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'announcements' ? (
        <div className="mt-6">
          <AnnouncementManager onChanged={refreshNotifications} />
        </div>
      ) : activeTab === 'dashboard' ? (
        <div className="mt-6">
          <AdminDashboard />
        </div>
      ) : activeTab === 'tickets' ? (
        <div className="mt-6">
          <TicketsPanel mode="staff" canClose={isAdmin} />
        </div>
      ) : activeTab === 'members' || activeTab === 'staff' ? (
        <div className="mt-6">
          <UserAdmin
            scope={activeTab}
            canManage={granted.has('users')}
            canEditRoles={isAdmin}
          />
        </div>
      ) : (
        <div className="mt-6">
          <CatalogAdmin />
        </div>
      )}
    </div>
  );
}
