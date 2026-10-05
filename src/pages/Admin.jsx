import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UserAdmin from './UserAdmin';
import AdminDashboard from '../components/AdminDashboard';
import CatalogAdmin from '../components/CatalogAdmin';
import { AnnouncementManager } from '../components/Announcements';
import { useNotifications } from '../context/NotificationsContext';

const STAFF = ['admin', 'moderator'];

const TABS = [
  { id: 'dashboard', label: 'Dashboard', staff: 'admin' },
  { id: 'catalog', label: 'Catalog', staff: 'admin' },
  { id: 'users', label: 'Users', staff: 'staff' },
  { id: 'announcements', label: 'Announcements', staff: 'staff' },
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
  const visibleTabs = TABS.filter((t) => (t.staff === 'admin' ? isAdmin : true));

  // A moderator demoted mid-session must not keep viewing the dashboard tab.
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : isAdmin ? 'dashboard' : 'users';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-24">
      <h1 className="text-2xl font-bold">Staff console</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {user.email} ·{' '}
        <span className={isAdmin ? 'text-accent' : 'text-muted'}>
          {isAdmin ? 'admin' : 'moderator'}
        </span>
        {!isAdmin && ' · catalog editing and account deletion are owner/admin only'}
      </p>

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
      ) : activeTab === 'users' ? (
        <div className="mt-6">
          <UserAdmin canDelete={isAdmin} />
        </div>
      ) : (
        <div className="mt-6">
          <CatalogAdmin />
        </div>
      )}
    </div>
  );
}
