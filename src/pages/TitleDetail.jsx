import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import VideoPlayer from '../components/VideoPlayer';
import PlaybackGate from '../components/PlaybackGate';
import { titleTypeLabel, isEpisodic } from '../lib/titleTypes';
import TitleCard from '../components/TitleCard';

export default function TitleDetail() {
  const { slug } = useParams();
  const { titles, has, toggle } = useCatalog();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeEpisode, setActiveEpisode] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActiveEpisode(null);
    api
      .getTitle(slug)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Persist progress for signed-in users so "continue watching" is real.
  const onProgress = useCallback(
    (seconds) => {
      if (!user || !slug) return;
      api.startPlayback(slug, Math.floor(seconds)).catch(() => {});
    },
    [user, slug],
  );

  // Group episodes under their season so a multi-season show reads correctly.
  const episodesBySeason = useMemo(() => {
    const order = new Map((data?.seasons || []).map((s) => [s.id, s.season_number]));
    const groups = new Map();
    for (const ep of data?.episodes || []) {
      const key = ep.season_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ep);
    }
    return [...groups.entries()]
      .map(([seasonId, list]) => ({
        seasonId,
        number: order.get(seasonId) ?? 1,
        description: data.seasons?.find((s) => s.id === seasonId)?.description,
        episodes: list,
      }))
      .sort((a, b) => a.number - b.number);
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (error || !data?.title) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="text-xl font-bold">Title not found</h1>
        <Link to="/browse" className="mt-4 inline-block text-sm text-accent hover:underline">
          Browse the catalog
        </Link>
      </div>
    );
  }

  const item = data.title;
  const saved = has(item.slug);
  const locked = Boolean(data.locked);
  const episodic = isEpisodic(item.type);

  // With no episode chosen, fall back to the title-level stream.
  const episode = activeEpisode || null;
  const streamUrl = episode ? episode.video_manifest_url : item.videoUrl;
  const subtitleUrl = episode ? episode.subtitles_url : item.subtitlesUrl;
  const nowPlaying = episode ? `${item.title} — E${episode.episode_number}` : item.title;

  const related = titles
    .filter((t) => t.slug !== item.slug && (t.genres || []).some((g) => item.genres?.includes(g)))
    .slice(0, 5);

  return (
    <div className="pb-24 md:pb-16">
      <section className="relative">
        <img
          src={item.backdropUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20" />
        <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-8 md:pt-24">
          <h1 className="max-w-3xl text-2xl font-extrabold md:text-4xl">{item.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="font-semibold text-accent">{Number(item.rating).toFixed(1)}</span>
            <span>{item.releaseDate}</span>
            <span>{item.runtime}</span>
            <span className="uppercase tracking-wide">{titleTypeLabel(item.type)}</span>
            {data.episodeCount > 0 && <span>{data.episodeCount} episodes</span>}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-4">
        {locked ? (
          <PlaybackGate title={item.title} episodeCount={data.episodeCount ?? 0} />
        ) : streamUrl ? (
          <VideoPlayer
            key={episode ? episode.id : 'title'}
            src={streamUrl}
            poster={item.backdropUrl}
            subtitlesUrl={subtitleUrl}
            title={nowPlaying}
            onProgress={onProgress}
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-surface text-sm text-muted ring-1 ring-white/10">
            No video available for this title yet.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-bold">
            {episode ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  S{episodesBySeason.find((g) => g.episodes.includes(episode))?.number ?? 1} · E
                  {episode.episode_number}
                </span>
                <span className="text-base font-semibold text-muted">{episode.title}</span>
              </span>
            ) : (
              item.title
            )}
          </h2>
          {episode && (
            <button
              type="button"
              onClick={() => setActiveEpisode(null)}
              className="rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-muted ring-1 ring-white/10 transition hover:bg-surface-2"
            >
              Back to title
            </button>
          )}
          <button
            type="button"
            onClick={() => toggle(item.slug)}
            aria-pressed={saved}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              saved
                ? 'bg-surface-2 text-accent ring-1 ring-accent/50'
                : 'bg-surface text-text ring-1 ring-white/10 hover:bg-surface-2'
            }`}
          >
            {saved ? '✓ In watchlist' : '+ Add to watchlist'}
          </button>
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-muted">{item.synopsis}</p>

        <div className="flex flex-wrap gap-2">
          {(item.genres || []).map((g) => (
            <span
              key={g}
              className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-white/10"
            >
              {g}
            </span>
          ))}
        </div>

        {episodesBySeason.length > 0 && (
          <section aria-labelledby="episodes-heading">
            <h2 id="episodes-heading" className="mb-4 text-lg font-bold">
              Episodes
            </h2>

            <div className="space-y-6">
              {episodesBySeason.map((group) => (
                <div key={group.seasonId}>
                  <h3 className="mb-2 text-sm font-semibold text-muted">
                    Season {group.number}
                    {group.description ? (
                      <span className="ml-2 font-normal">{group.description}</span>
                    ) : null}
                  </h3>
                  <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-surface ring-1 ring-white/5">
                    {group.episodes.map((ep) => {
                      const isActive = episode?.id === ep.id;
                      return (
                        <li key={ep.id}>
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => setActiveEpisode(ep)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`flex w-full items-center gap-4 px-4 py-3 text-left transition ${
                              locked
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-surface-2'
                            } ${isActive ? 'bg-surface-2' : ''}`}
                          >
                            <span className="w-8 shrink-0 text-center text-xs font-semibold text-accent">
                              {ep.episode_number}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{ep.title}</span>
                            </span>
                            {locked && (
                              <span className="shrink-0 rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                                Sign in
                              </span>
                            )}
                            {ep.runtime && (
                              <span className="shrink-0 text-xs text-muted">{ep.runtime}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {!episodic && (
          <p className="text-xs text-muted">
            Movies play without an account. Series, anime and AI titles need a sign-in to watch.
          </p>
        )}

        <section aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-4 text-lg font-bold">
            Related Titles
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {related.map((t) => (
              <TitleCard key={t.slug} item={t} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}