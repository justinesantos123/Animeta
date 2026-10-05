import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth, preferredName } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import SignOutDialog from './SignOutDialog';
import { TITLE_TYPES, typePath } from '../lib/titleTypes';

const STAFF = ['admin', 'moderator'];

const LINKS = [
  { to: '/', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V21H15v-6H9v6H3z' },
  { to: '/browse', label: 'Browse', icon: 'M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z' },
  { to: '/search', label: 'Search', icon: 'M10 4a6 6 0 104.47 10.03l4.25 4.25 1.41-1.41-4.25-4.25A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z' },
  { to: '/announcements', label: 'News', icon: 'M3 5h18v12H7l-4 4V5zm2 2v8.2L6.2 13H19V7H5z' },
  { to: '/watchlist', label: 'Library', icon: 'M4 4h3v16H4zm6.5 0h3v16h-3zM17 4h3v16h-3z' },
];

function RoleBadge({ role }) {
  if (role === 'admin') {
    return (
      <span className="mb-1 inline-block rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
        admin
      </span>
    );
  }
  if (role === 'moderator') {
    return (
      <span className="mb-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
        moderator
      </span>
    );
  }
  return null;
}

function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  if (!user) {
    return (
      <Link
        to="/auth"
        className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
      >
        Sign In
      </Link>
    );
  }

  const handle = user.username || user.email;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-[var(--radius-control)] bg-surface px-2.5 py-1.5 text-sm ring-1 ring-[var(--color-line-strong)] transition hover:bg-surface-2"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
          {handle.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{handle}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line-strong)]"
          >
            <div className="border-b border-[var(--color-line)] px-4 py-2.5">
              <RoleBadge role={user.role} />
              <p className="truncate text-xs font-semibold text-text">{preferredName(user)}</p>
              <p className="truncate text-[11px] text-muted">{user.email}</p>
            </div>

            <Link
              to="/profile"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm transition hover:bg-surface-2"
              role="menuitem"
            >
              Profile &amp; username
            </Link>

            {STAFF.includes(user.role) && (
              <Link
                to="/kaedeentrans"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm transition hover:bg-surface-2"
                role="menuitem"
              >
                Staff console
              </Link>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setConfirmSignOut(true);
              }}
              className="block w-full px-4 py-2 text-left text-sm text-[var(--color-danger)] transition hover:bg-surface-2"
            >
              Sign out
            </button>
          </div>
        </>
      )}

      <SignOutDialog open={confirmSignOut} onCancel={() => setConfirmSignOut(false)} />
    </div>
  );
}

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
        <Link
          to="/"
          className="mr-1 shrink-0 text-[15px] font-bold tracking-[-0.01em]"
          aria-label="Animeta home"
        >
          <span className="text-[var(--color-accent)]">ANI</span>
          <span className="text-[var(--color-text)]">META</span>
        </Link>

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] font-medium transition ${
                  isActive
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Categories, so they are one click from anywhere rather than only
              reachable through the Browse page. */}
          <nav
            aria-label="Categories"
            className="hidden items-center gap-0.5 lg:flex"
          >
            {TITLE_TYPES.map((t) => (
              <NavLink
                key={t.value}
                to={typePath(t.value)}
                className={({ isActive }) =>
                  `rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] font-medium transition ${
                    isActive
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-faint)] hover:text-[var(--color-text)]'
                  }`
                }
              >
                {/* "Ads" in the top nav would be advertising the advertising
                    to every visitor. It stays reachable from Browse, where
                    someone has already chosen to browse everything. */}
                {t.sponsored ? null : t.label}
              </NavLink>
            ))}
          </nav>
          <Link
            to="/search"
            className="hidden rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] text-[var(--color-faint)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] xl:block"
          >
            Search
          </Link>
          <UserMenu />
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line)] bg-[var(--color-bg)]/95 backdrop-blur-md md:hidden"
    >
      <div className="grid grid-cols-5">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition ${
                isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-faint)]'
              }`
            }
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
              <path d={l.icon} />
            </svg>
            {l.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
