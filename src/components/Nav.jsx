import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LINKS = [
  { to: '/', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V21H15v-6H9v6H3z' },
  { to: '/search', label: 'Search', icon: 'M10 4a6 6 0 104.47 10.03l4.25 4.25 1.41-1.41-4.25-4.25A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z' },
  { to: '/watchlist', label: 'Library', icon: 'M4 4h3v16H4zm6.5 0h3v16h-3zM17 4h3v16h-3z' },
];

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

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
          {user.email.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.email}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl bg-surface ring-1 ring-white/10"
          >
            <p className="border-b border-white/5 px-4 py-2.5 text-xs text-muted">
              {user.role === 'admin' && (
                <span className="mb-1 inline-block rounded bg-accent/20 px-1.5 py-0.5 font-semibold text-accent">
                  admin
                </span>
              )}
              {user.displayName || user.email}
            </p>
            {user.role === 'admin' && (
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm transition hover:bg-surface-2"
                role="menuitem"
              >
                Admin: manage titles
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await logout();
                navigate('/');
              }}
              className="block w-full px-4 py-2 text-left text-sm transition hover:bg-surface-2"
            >
              Sign out
            </button>
          </div>
        </>
      )}
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