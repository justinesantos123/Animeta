import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth, preferredName } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import SignOutDialog from './SignOutDialog';

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
        className="rounded-lg bg-cta px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
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
        className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-white/10 transition hover:bg-surface-2"
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
            className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl bg-surface ring-1 ring-white/10"
          >
            <div className="border-b border-white/5 px-4 py-2.5">
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
              className="block w-full px-4 py-2 text-left text-sm text-cta transition hover:bg-surface-2"
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
    <header className="sticky top-0 z-40 border-b border-white/5 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link to="/" className="shrink-0 text-lg font-extrabold tracking-tight">
          <span className="text-accent">ANI</span>
          <span className="text-text">META</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/search"
            className="hidden rounded-lg bg-surface px-3 py-1.5 text-sm text-muted transition hover:text-text sm:block"
          >
            Search titles…
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-bg/95 backdrop-blur-md md:hidden"
    >
      <div className="grid grid-cols-4">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition ${
                isActive ? 'text-accent' : 'text-muted'
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
