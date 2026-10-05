import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import VideoPlayer from '../components/VideoPlayer';
import PlaybackGate from '../components/PlaybackGate';
import { titleTypeLabel, isEpisodic } from '../lib/titleTypes';
import TitleCard from '../components/TitleCard';
import EmbedPlayer from '../components/EmbedPlayer';
import PreRollAd from '../components/PreRollAd';
import { isSponsored } from '../lib/titleTypes';

export default function TitleDetail() {
  const { slug } = useParams();
  const { titles, has, toggle } = useCatalog();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chosenId, setChosenId] = useState(null);

  // Pre-roll state. An advert plays in place of the film and is replaced by it,
  // so the visitor never has to click a second play button.
  const [preRollDone, setPreRollDone] = useState(false);

  // Reset per title: a new film means a new chance at a pre-roll, and a
  // different title means the cap should be re-evaluated from scratch.
  useEffect(() => {
    setPreRollDone(false);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setChosenId(null);
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

  // Stable identity so the useMemo dependencies below are not rebuilt each render.
  const episodes = useMemo(() => data?.episodes || [], [data]);
  const episodic = data?.title ? isEpisodic(data.title.type) : false;

  // Which episode is playable without an account. The Worker marks every
  // locked episode, so the first unlocked one is the free preview.
  const freeEpisode = useMemo(() => episodes.find((e) => !e.locked) ?? null, [episodes]);

  // Defaults to the free episode on an episodic title so the player is never
  // an empty box; otherwise falls back to the title-level stream.
  const chosenEpisode = useMemo(() => {
    if (chosenId) return episodes.find((e) => e.id === chosenId) ?? null;
    return freeEpisode;
  }, [chosenId, episodes, freeEpisode]);

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
  const episode = chosenEpisode;
  const sponsored = isSponsored(item.type);

  // An advert must never pre-roll an advert, and pre-rolling a page with
  // nothing to play would be an advert in front of nothing.
  //
  // Episodes count as playable here. A series carries no video of its own, so
  // checking only the title meant an imported series could never show a pre-roll
  // — the one title shape the importer produces.
  const preRollEligible =
    !sponsored &&
    Boolean(
      data.title.videoUrl ||
        data.title.streamUrl ||
        data.title.embedId ||
        episodes.some((e) => e.video_manifest_url || e.embed_id),
    );

  // A locked episode that was picked shows the gate instead of playing.
  const gatedEpisode = episode?.locked ? episode : null;
  const playableEpisode = gatedEpisode ? null : episode;

  // An embed is identified by provider plus id, an upload by a stream URL the
  // Worker issues per request. Episodes can carry either too, which is why this
  // reads off whichever item is actually being played.
  const source = playableEpisode ?? item;

  // The two shapes disagree on casing: the title arrives camelCase from the
  // title endpoint, episodes arrive snake_case from the episode rows. Reading
  // only one of the two spellings meant an embed on an episode was always
  // undefined, so imported episode embeds rendered no player at all.
  const embedKind = (source.videoKind ?? source.video_kind) === 'embed';
  const embedProvider = source.embedProvider ?? source.embed_provider;
  const embedId = source.embedId ?? source.embed_id;

  const streamUrl = playableEpisode
    ? playableEpisode.video_manifest_url
    : (item.streamUrl ?? item.videoUrl);
  const subtitleUrl = playableEpisode ? playableEpisode.subtitles_url : item.subtitlesUrl;
  const nowPlaying = playableEpisode
    ? `${item.title} — E${playableEpisode.episode_number}`
    : item.title;

  // Nothing playable at all: an episodic title with no free episode. An embed or
  // an upload counts as playable, so both have to be part of this test or a title
  // whose only video is one of those would show the sign-in gate instead.
  const nothingPlayable =
    Boolean(data.locked) ||
    (episodic && !streamUrl && !freeEpisode && !embedKind);

  function pickEpisode(ep) {
    setChosenId(ep.id);
  }

  // Related is editorial only. An advert never appears here, however well it
  // happens to match the genres.
  const related = titles
    .filter(
      (t) =>
        t.slug !== item.slug &&
        !isSponsored(t.type) &&
        (t.genres || []).some((g) => item.genres?.includes(g)),
    )
    .slice(0, 5);

  // The hero falls back to the captured poster frame when there is no separate
  // backdrop, which is the common case for an upload: staff upload a video and
  // never paste a backdrop URL.
  const hero = item.backdropUrl || item.posterUrl;

  return (
    <div className="pb-24 md:pb-16">
      <section className="relative">
        {hero && (
          <img
            src={hero}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/85 to-[var(--color-bg)]/40" />
        <div className="relative mx-auto flex min-h-[15rem] max-w-5xl flex-col justify-end px-4 pb-8 md:min-h-[19rem] md:pb-12">
          {/* Above the title, not in the metadata line: a visitor must not have
              to read the type to work out this is a paid placement. */}
          {sponsored && (
            <p className="mb-2 w-fit rounded-[3px] bg-[var(--color-accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              Sponsored · paid placement
            </p>
          )}
          <h1 className="max-w-3xl text-2xl font-bold leading-[1.15] tracking-[-0.02em] md:text-4xl">
            {item.title}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--color-faint)]">
            <span className="font-semibold tabular-nums text-[var(--color-text)]">
              {Number(item.rating).toFixed(1)}
            </span>
            <span aria-hidden="true">/</span>
            <span className="tabular-nums">{item.releaseDate}</span>
            <span aria-hidden="true">/</span>
            <span>{item.runtime}</span>
            <span aria-hidden="true">/</span>
            <span>{titleTypeLabel(item.type)}</span>
            {data.episodeCount > 0 && (
              <>
                <span aria-hidden="true">/</span>
                <span className="tabular-nums">{data.episodeCount} episodes</span>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-7 px-4">
        {/* While an advert is due, the film player is NOT mounted. Mounting both
            means two <video> elements at once: the film can be seen behind the
            advert, and if it has autoplay both play, so audio doubles up. The
            player is swapped in only once the advert is finished or skipped. */}
        {!preRollDone && preRollEligible ? (
          <PreRollAd
            key={slug}
            titleSlug={item.slug}
            onDone={() => setPreRollDone(true)}
            onFail={() => setPreRollDone(true)}
          />
        ) : (
          <>
            {gatedEpisode ? (
              <PlaybackGate
                title={item.title}
                episodeTitle={gatedEpisode.title}
                firstEpisodeIsFree={Boolean(freeEpisode)}
              />
            ) : nothingPlayable ? (
              <PlaybackGate title={item.title} firstEpisodeIsFree={false} />
            ) : embedKind ? (
              <EmbedPlayer
                key={playableEpisode ? `embed-${playableEpisode.id}` : 'embed-title'}
                provider={embedProvider}
                videoId={embedId}
                title={nowPlaying}
              />
            ) : streamUrl ? (
              <VideoPlayer
                key={playableEpisode ? playableEpisode.id : 'title'}
                src={streamUrl}
                // Decides whether the browser can play this directly or hls.js has
                // to be involved. A streamed upload has no file extension, so the
                // kind is the only way to tell it apart from a real .m3u8.
                kind={source.videoKind ?? source.video_kind}
                poster={item.backdropUrl || item.posterUrl}
                subtitlesUrl={subtitleUrl}
                title={nowPlaying}
                onProgress={onProgress}
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-[var(--radius-card)] bg-[var(--color-surface)] px-6 text-center text-sm text-[var(--color-muted)] ring-1 ring-[var(--color-line)]">
                {/* Distinguished from "not published yet": the upload was recorded
                    but the file is gone from storage, which staff need to see
                    rather than have it look like a typo. */}
                {item.missingVideo
                  ? 'The video for this title is no longer available.'
                  : 'No video available for this title yet.'}
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="mr-auto flex flex-wrap items-baseline gap-2 text-base font-semibold">
            {playableEpisode ? (
              <>
                <span className="tabular-nums text-[var(--color-faint)]">
                  S
                  {episodesBySeason.find((g) => g.episodes.includes(playableEpisode))?.number ?? 1}
                  {' · '}E{playableEpisode.episode_number}
                </span>
                <span className="text-sm font-normal text-[var(--color-muted)]">
                  {playableEpisode.title}
                </span>
              </>
            ) : (
              item.title
            )}
          </h2>
          {playableEpisode && chosenId && (
            <button
              type="button"
              onClick={() => setChosenId(null)}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Back to episode 1
            </button>
          )}
          <button
            type="button"
            onClick={() => toggle(item.slug)}
            aria-pressed={saved}
            className={`rounded-[var(--radius-control)] px-3.5 py-1.5 text-xs font-medium transition ${
              saved
                ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent-strong)] ring-1 ring-[var(--color-accent)]/40'
                : 'text-[var(--color-muted)] ring-1 ring-[var(--color-line-strong)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
            }`}
          >
            {saved ? '✓ In watchlist' : '+ Add to watchlist'}
          </button>
        </div>

        <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
          {item.synopsis}
        </p>

        <div className="flex flex-wrap gap-2">
          {(item.genres || []).map((g) => (
            <span
              key={g}
              className="rounded-full bg-surface px-3 py-1 text-xs text-muted ring-1 ring-[var(--color-line-strong)]"
            >
              {g}
            </span>
          ))}
        </div>

        {episodesBySeason.length > 0 && (
          <section aria-labelledby="episodes-heading">
            <div className="section-head">
              <h2 id="episodes-heading" className="section-head__title">
                Episodes
              </h2>
              <span className="section-head__meta">{data.episodeCount} total</span>
            </div>

            <div className="space-y-7">
              {episodesBySeason.map((group) => (
                <div key={group.seasonId}>
                  <h3 className="mb-2 flex items-baseline gap-2 text-xs font-medium text-[var(--color-faint)]">
                    <span>Season {group.number}</span>
                    {group.description && (
                      <span className="font-normal text-[var(--color-faint)]">{group.description}</span>
                    )}
                  </h3>
                  <ul className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-surface)] ring-1 ring-[var(--color-line)]">
                    {group.episodes.map((ep) => {
                      const isActive = playableEpisode?.id === ep.id;
                      return (
                        <li
                          key={ep.id}
                          className="border-b border-[var(--color-line)] last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() => pickEpisode(ep)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`flex w-full items-center gap-3.5 px-3.5 py-2.5 text-left transition ${
                              isActive
                                ? 'bg-[var(--color-surface-2)]'
                                : 'hover:bg-[var(--color-surface-2)]/60'
                            }`}
                          >
                            <span
                              className={`w-6 shrink-0 text-right text-xs tabular-nums ${
                                isActive
                                  ? 'font-semibold text-[var(--color-accent)]'
                                  : 'text-[var(--color-faint)]'
                              }`}
                            >
                              {ep.episode_number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text)]">
                              {ep.title}
                            </span>
                            {ep.locked ? (
                              <span
                                data-episode-access="locked"
                                className="shrink-0 text-[11px] text-[var(--color-faint)]"
                              >
                                Sign up
                              </span>
                            ) : (
                              <span
                                data-episode-access="free"
                                className="shrink-0 rounded-[3px] bg-[var(--color-accent)]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent-strong)]"
                              >
                                Free
                              </span>
                            )}
                            {ep.runtime && (
                              <span className="shrink-0 text-xs tabular-nums text-[var(--color-faint)]">
                                {ep.runtime}
                              </span>
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

        {episodic && freeEpisode && !user && (
          <p className="text-xs text-[var(--color-faint)]">
            Episode 1 plays free. An account is needed from episode 2 onwards.
          </p>
        )}
        {!episodic && (
          <p className="text-xs text-[var(--color-faint)]">This movie plays without an account.</p>
        )}

        <section aria-labelledby="related-heading">
          <div className="section-head">
            <h2 id="related-heading" className="section-head__title">
              More like this
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {related.map((t) => (
              <TitleCard key={t.slug} item={t} />
            ))}
          </div>
          </section>
        </div>
      </div>
    );
  }