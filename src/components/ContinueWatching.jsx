import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { titleTypeLabel } from '../lib/titleTypes';

/**
 * Titles the signed-in viewer has actually started, most recent first.
 *
 * Replaces a rail that used to show the first six titles in the catalog with a
 * hardcoded 42% progress bar, which was fiction dressed as a feature. Returns
 * nothing signed out, since progress is only stored for signed-in accounts.
 */
export default function ContinueWatching({ limit = 8 }) {
  const [items, setItems] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .continueWatching()
      .then((d) => {
        if (!cancelled) setItems(d.titles || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Wait for the response before rendering nothing, otherwise the section
  // flashes empty on every load.
  if (!loaded || !items?.length) return null;

  return (
    <section aria-labelledby="continue-heading">
      <div className="section-head">
        <h2 id="continue-heading" className="section-head__title">
          Continue watching
        </h2>
        <span className="section-head__meta">
          {items.length} in progress
        </span>
      </div>

      <ul className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4">
        {items.slice(0, limit).map((t) => (
          <li key={t.slug} className="w-56 shrink-0">
            <Link
              to={`/title/${t.slug}`}
              className="group block overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line)] transition hover:ring-[var(--color-line-strong)]"
            >
              <div className="relative aspect-video overflow-hidden">
                <img
                  src={t.backdropUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/40" />
                <span className="absolute bottom-2 left-2 rounded-[3px] bg-black/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  {titleTypeLabel(t.type)}
                </span>
              </div>

              <div className="p-2.5">
                <p className="truncate text-[13px] font-medium">{t.title}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}