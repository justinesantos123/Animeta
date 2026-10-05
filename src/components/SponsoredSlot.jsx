import { Link } from 'react-router-dom';
import TitleCard from './TitleCard';

/**
 * The one place an advert appears outside its own category.
 *
 * Placement rules, and the reasoning behind them:
 *
 *   - Never in search results. Someone searched for a title, not for an
 *     advertiser, and an advert in those results reads as a broken search.
 *   - Never between related titles. "More like this" is a claim about taste;
 *     putting a paid placement inside it is a lie about what the recommender
 *     thinks.
 *   - Never on the page of the advert being promoted elsewhere. It has its own
 *     category for that.
 *   - One card, not a row. A rail of adverts would outnumber the content.
 *   - Below the player on a title page, and at the end of Browse. Both are
 *     places a visitor reaches having finished what they came for.
 *
 * It never autoplays, never has sound, and never interrupts playback.
 */
export default function SponsoredSlot({ items, heading = 'Sponsored' }) {
  // Defensive: the caller filters, but an advert rendering unlabelled is the
  // one failure this component exists to prevent, so it refuses rather than
  // trusts.
  const ads = (items || []).filter((t) => t.type === 'ads').slice(0, 1);
  if (ads.length === 0) return null;

  return (
    <section
      aria-label={heading}
      data-sponsored-slot="true"
      className="rounded-[var(--radius-card)] bg-surface/60 p-4 ring-1 ring-[var(--color-line-strong)]"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-[3px] bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-strong)]">
          Ad
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-faint)]">
          {heading}
        </h2>
        <span className="text-[11px] text-[var(--color-faint)]">
          Paid placement, not editorial
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {ads.map((ad) => (
          <div key={ad.slug} className="max-w-[12rem]">
            <TitleCard item={ad} />
            <Link
              to={`/title/${ad.slug}`}
              className="mt-1.5 block text-[11px] text-[var(--color-faint)] underline underline-offset-2 hover:text-[var(--color-text)]"
            >
              Why am I seeing this?
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
