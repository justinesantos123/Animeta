import { Link } from 'react-router-dom';
import { titleTypeLabel, isSponsored } from '../lib/titleTypes';

/**
 * Poster card. The most repeated element in the app, so the hover treatment and
 * the title clamp live here rather than being re-decided per page.
 *
 * Metadata is deliberately kept to type and rating. Genre lines on every card
 * made the grid read as a wall of text and pushed the titles out of alignment.
 *
 * A sponsored title gets a permanent "Sponsored" badge rather than only the Ads
 * type label, because the type label can be scrolled past or missed and a paid
 * placement presented as editorial is the failure that matters.
 */
export default function TitleCard({ item, priority = false }) {
  const sponsored = isSponsored(item.type);

  return (
    <Link
      to={`/title/${item.slug}`}
      className="group relative flex flex-col rounded-[var(--radius-card)] bg-surface ring-1 ring-[var(--color-line)] transition duration-200 hover:ring-[var(--color-line-strong)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
    >
      <div className="relative aspect-2/3 overflow-hidden rounded-t-[var(--radius-card)]">
        <img
          src={item.posterUrl}
          alt={`${item.title} poster`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
        />

        {/* Darken only on hover, so the resting grid stays clean. */}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/45" />

        <span className="absolute left-2 top-2 rounded-[3px] bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-text)]">
          {Number(item.rating).toFixed(1)}
        </span>

        <span className="absolute right-2 top-2 rounded-[3px] bg-black/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
          {sponsored ? 'Ad' : titleTypeLabel(item.type)}
        </span>

        {/* The advert label sits at the foot of the artwork rather than
            competing with the type chip in the corner, because it is the one
            piece of information a visitor has to be able to see without
            interacting. */}
        {sponsored && (
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-black/0 px-2 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-wider text-white">
            Sponsored
          </span>
        )}

        {/* Hover only. On touch there is no hover state, and showing it on every
            card at once buried the posters under a wall of play buttons. The
            card itself is the tap target. */}
        <span
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 fill-current">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      </div>

      {/* Fixed height so titles of one and two lines keep the grid even. */}
      <div className="flex min-h-[3.25rem] flex-col gap-0.5 p-2.5">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--color-text)]">
          {item.title}
        </h3>
        <p className="truncate text-[11px] text-[var(--color-faint)]">{item.releaseDate?.slice(0, 4)}</p>
      </div>
    </Link>
  );
}