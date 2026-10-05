/**
 * Where a title can legally be watched, linking out rather than playing.
 *
 * This is deliberately not a player. Availability comes from TMDB's
 * JustWatch-backed data, which lists the services a title is on but carries no
 * rights for Animeta to stream any of it, and TMDB issues no direct links to
 * the services themselves — only to its own watch page. So this is an honest
 * "go and watch it somewhere legal" row, never a proxy for someone else's
 * catalogue.
 *
 * Availability is regional. The region that produced the list is always shown,
 * because a title being on Netflix in the US says nothing about whether it is
 * available to the visitor.
 */
import { regionName } from '../lib/regions';

/**
 * @param {object|null} providers snapshot stored on the title
 */
export default function WatchProviders({ providers }) {
  if (!providers) return null;

  const groups = Array.isArray(providers.groups) ? providers.groups : [];
  const region = providers.region;
  const place = regionName(region);
  const fellBack = region && providers.regionRequested && region !== providers.regionRequested;
  const link = providers.link;

  // Known title, but nothing available where we looked. Worth saying plainly:
  // silence would read as "we never checked".
  if (groups.length === 0) {
    return (
      <section aria-labelledby="where-to-watch-heading" className="pt-1">
        <div className="section-head">
          <h2 id="where-to-watch-heading" className="section-head__title">
            Where to watch
          </h2>
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          Not currently available to stream
          {place ? ` in the ${place}` : ''}.
          {link && (
            <>
              {' '}
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-[var(--color-accent-strong)] hover:underline"
              >
                Check other regions
              </a>
              .
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="where-to-watch-heading" className="pt-1">
      <div className="section-head">
        <h2 id="where-to-watch-heading" className="section-head__title">
          Where to watch
        </h2>
        {place && <span className="section-head__meta">{place}</span>}
      </div>

      <ul className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface)] ring-1 ring-[var(--color-line)]">
        {groups.map((group) => (
          <li
            key={group.key}
            className="flex flex-col gap-1.5 border-b border-[var(--color-line)] px-3.5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="shrink-0 text-xs font-medium text-[var(--color-faint)] sm:w-28">
              {group.label}
            </span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {group.items.map((item) => (
                <li key={item.id ?? item.name} className="flex items-center gap-1.5">
                  {item.logoUrl && (
                    <img
                      src={item.logoUrl}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      className="h-4 w-4 shrink-0 rounded-[3px] object-contain"
                    />
                  )}
                  <span className="text-[13px] text-[var(--color-text)]">{item.name}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--color-faint)]">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-[var(--color-accent-strong)] hover:underline"
          >
            View availability details
          </a>
        )}
        {fellBack && (
          <span>
            No data for {regionName(providers.regionRequested)}, showing {place}.
          </span>
        )}
        {/* Required attribution: TMDB's availability data is supplied via JustWatch. */}
        <span>
          Availability via TMDB &amp; JustWatch. Animeta does not host these titles.
        </span>
      </div>
    </section>
  );
}