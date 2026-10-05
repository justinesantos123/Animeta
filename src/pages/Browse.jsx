import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import TitleCard from '../components/TitleCard';
import SponsoredSlot from '../components/SponsoredSlot';
import { TITLE_TYPES, titleTypeLabel, typePath } from '../lib/titleTypes';

/**
 * The full catalog, grouped by category.
 *
 * Browsing is open to signed-out visitors: every row is visible and every
 * detail page renders. Only playback of gated categories needs an account.
 */
export default function Browse() {
  const { titles, loading, error } = useCatalog();
  const [type, setType] = useState('all');

  const sections = useMemo(
    () =>
      TITLE_TYPES.map((meta) => ({
        ...meta,
        items: titles
          .filter((t) => t.type === meta.value)
          .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate))),
      })).filter((s) => s.items.length > 0),
    [titles],
  );

  const shown = type === 'all' ? sections : sections.filter((s) => s.value === type);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24">
        <h1 className="text-lg font-semibold">The catalog didn&rsquo;t load</h1>
        <p className="mt-1.5 text-sm text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 md:pb-16">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">Browse</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">
          {titles.length} {titles.length === 1 ? 'title' : 'titles'} across {TITLE_TYPES.length}{' '}
          categories. Browsing is open to everyone; an account is only needed to watch.
        </p>
      </header>

      <nav
        aria-label="Filter by category"
        className="mt-7 flex flex-wrap items-center gap-1.5"
      >
        <FilterChip active={type === 'all'} onClick={() => setType('all')}>
          All
          <span className="ml-1.5 tabular-nums text-[var(--color-faint)]">{titles.length}</span>
        </FilterChip>
        {sections.map((s) => (
          <FilterChip key={s.value} active={type === s.value} onClick={() => setType(s.value)}>
            {titleTypeLabel(s.value)}
            <span className="ml-1.5 tabular-nums text-[var(--color-faint)]">{s.items.length}</span>
          </FilterChip>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="py-20 text-sm text-muted">Nothing in this category yet.</p>
      ) : (
        <div className="mt-10 space-y-14">
          {shown.map((section) => (
            <section key={section.value} id={`type-${section.value}`} aria-labelledby={`h-${section.value}`}>
              <div className="section-head">
                <h2 id={`h-${section.value}`} className="section-head__title">
                  <Link to={typePath(section.value)} className="hover:text-[var(--color-accent)]">
                    {titleTypeLabel(section.value)}
                  </Link>
                </h2>
                <span className="section-head__meta">
                  {section.items.length} {section.items.length === 1 ? 'title' : 'titles'}
                </span>
                {section.gated && (
                  <span className="text-[11px] text-[var(--color-faint)]">sign-in to watch</span>
                )}
                <Link
                  to={typePath(section.value)}
                  className="ml-auto text-xs text-[var(--color-accent)] hover:underline"
                >
                  Open
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {section.items.map((t) => (
                  <TitleCard key={t.slug} item={t} />
                ))}
              </div>
            </section>
          ))}

          {/* After the organic sections, not among them, and only when browsing
              the whole catalog: someone filtering to a category has asked for
              that category and nothing else. */}
          {type === 'all' && (
            <div className="mt-10">
              <SponsoredSlot
                items={sections.find((s) => s.value === 'ads')?.items ?? []}
                heading="Sponsored on Animeta"
              />
            </div>
          )}
        </div>
      )}

      <p className="rule mt-14 pt-5 text-xs text-[var(--color-faint)]">
        Looking for something specific?{' '}
        <Link to="/search" className="text-[var(--color-accent)] hover:underline">
          Search
        </Link>{' '}
        filters by keyword and genre.
      </p>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-[var(--color-surface-3)] text-[var(--color-text)]'
          : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
      }`}
    >
      {children}
    </button>
  );
}