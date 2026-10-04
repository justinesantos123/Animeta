import { Link } from 'react-router-dom';
import { featured, titles } from '../data/titles';
import TitleCard from '../components/TitleCard';

export default function Home() {
  const trending = titles.slice(0, 10);
  const fresh = titles.slice(4, 9);

  return (
    <div className="pb-24 md:pb-16">
      {/* Hero */}
      <section className="relative">
        <img
          src={featured.backdropUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 md:py-32">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            Featured {featured.type}
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl font-extrabold leading-tight md:text-5xl">
            {featured.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted md:text-base">{featured.synopsis}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="font-semibold text-accent">{featured.rating.toFixed(1)}</span>
            <span>{featured.releaseDate.slice(0, 4)}</span>
            <span>{featured.runtime}</span>
            <span>{featured.genres.join(' · ')}</span>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to={`/title/${featured.id}`}
              className="rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Watch Now
            </Link>
            <Link
              to={`/title/${featured.id}`}
              className="rounded-lg bg-surface-2/80 px-5 py-2.5 text-sm font-semibold text-text ring-1 ring-white/10 transition hover:bg-surface-2"
            >
              More Info
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-12 px-4">
        {/* Continue watching rail */}
        <section aria-labelledby="continue-heading">
          <h2 id="continue-heading" className="mb-4 text-lg font-bold">
            Continue Watching
          </h2>
          <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {titles.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                to={`/title/${t.id}`}
                className="group w-56 shrink-0 overflow-hidden rounded-xl bg-surface ring-1 ring-white/5"
              >
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src={t.backdropUrl}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                    <div className="h-full bg-accent" style={{ width: '42%' }} />
                  </div>
                </div>
                <p className="truncate p-2.5 text-sm font-medium">{t.title}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Trending grid */}
        <section aria-labelledby="trending-heading">
          <h2 id="trending-heading" className="mb-4 text-lg font-bold">
            Trending Now
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {trending.map((t) => (
              <TitleCard key={t.id} item={t} />
            ))}
          </div>
        </section>

        {/* New releases */}
        <section aria-labelledby="new-heading">
          <h2 id="new-heading" className="mb-4 text-lg font-bold">
            New Releases
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {fresh.map((t) => (
              <TitleCard key={t.id} item={t} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}