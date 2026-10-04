import { NavLink, Link } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V21H15v-6H9v6H3z' },
  { to: '/search', label: 'Search', icon: 'M10 4a6 6 0 104.47 10.03l4.25 4.25 1.41-1.41-4.25-4.25A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z' },
  { to: '/watchlist', label: 'Library', icon: 'M4 4h3v16H4zm6.5 0h3v16h-3zM17 4h3v16h-3z' },
];

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
          <button
            type="button"
            className="rounded-lg bg-cta px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Sign In
          </button>
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