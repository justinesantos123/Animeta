import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import EmbedPlayer from './EmbedPlayer';

/**
 * A pre-roll advert that plays before the title someone asked for.
 *
 * Design rules, in priority order:
 *
 *  1. It must never trap the viewer. Skip appears immediately, becomes active
 *     after SKIP_AFTER_SECONDS, and the whole thing is gone if the ad fails to
 *     load, errors, or the pool is empty. There is no path where a visitor
 *     cannot reach the film.
 *  2. It is muted. Browsers block unmuted autoplay anyway, and an advert that
 *     makes noise before anyone has touched anything is hostile. The visitor can
 *     unmute it themselves if they want to hear it.
 *  3. It is labelled, permanently and not dismissibly, while it plays.
 *  4. It is not something you browse to. Nothing links here, and adverts are
 *     excluded from every catalog listing, so the only way to see one is to play.
 *
 * Frequency: an ad on every single video makes a site unwatchable, so one is
 * shown at most once per FREQUENCY_MS per browser. That is a judgement call and
 * is the one number worth changing.
 */

const SKIP_AFTER_SECONDS = 5;

/** Once per this window. Fifteen minutes. */
const FREQUENCY_MS = 15 * 60 * 1000;

const SEEN_KEY = 'animeta:preroll:last-seen';
const COUNT_KEY = 'animeta:preroll:count';

/**
 * Read from localStorage, which is a guess rather than a record.
 *
 * Deliberately not server-side: tying an ad to a session would need a cookie or
 * an account, and this is not worth the complexity for a slot that plays. A
 * visitor who clears storage sees one more ad, which is an acceptable failure
 * mode; a fingerprinting identifier to prevent that is not.
 */
function readSeen() {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Private browsing, or storage disabled. Treat as not seen.
    return 0;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, String(Date.now()));
    const n = Number(window.localStorage.getItem(COUNT_KEY) || '0') + 1;
    window.localStorage.setItem(COUNT_KEY, String(n));
  } catch {
    // Nothing to do: the worst case is one more pre-roll next time.
  }
}

/** Picks an advert, preferring one the visitor has not just seen. */
function pickAd(ads, lastSlug) {
  if (ads.length === 0) return null;
  const others = ads.filter((a) => a.slug !== lastSlug);
  const pool = others.length ? others : ads;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * @param {string} titleSlug  the title about to be played; an advert never
 *                             pre-rolls itself
 * @param {Function} onDone    called when the advert is finished or skipped
 * @param {Function} onFail    called if the pool is empty, so the caller can
 *                             go straight to the film without a flash
 */
export default function PreRollAd({ titleSlug, onDone, onFail }) {
  const videoRef = useRef(null);
  const [ad, setAd] = useState(null);
  const [skippable, setSkippable] = useState(false);
  const [remaining, setRemaining] = useState(SKIP_AFTER_SECONDS);
  // Set once the pool is known to be empty, so the caller stops rendering it.
  const [givenUp, setGivenUp] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .listAds()
      .then((d) => {
        if (cancelled) return;

        const ads = (d.ads || []).filter((a) => a.slug !== titleSlug);
        if (ads.length === 0) {
          setGivenUp(true);
          onFail?.();
          return;
        }

        // The frequency cap. Checked here rather than in the component so a
        // remount cannot replay it.
        const last = readSeen();
        if (Date.now() - last < FREQUENCY_MS) {
          setGivenUp(true);
          onFail?.();
          return;
        }

        setAd(pickAd(ads, titleSlug));
        markSeen();
      })
      // A failure here must not block playback, so it falls through to the film.
      .catch(() => {
        if (!cancelled) {
          setGivenUp(true);
          onFail?.();
        }
      });

    return () => {
      cancelled = true;
    };
    // Only re-run for a different title, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleSlug]);

  // Skip countdown, and the actual autoplay once the element is mounted.
  useEffect(() => {
    if (!ad) return undefined;

    const video = videoRef.current;
    if (video) {
      // Muted is what makes autoplay legal; the browser refuses otherwise.
      video.muted = true;
      video.play().catch(() => {
        // Autoplay refused. Do not make the visitor sit through a frozen frame:
        // hand over to the film and show the advert was skipped.
        setGivenUp(true);
        onDone?.();
      });
    }

    const tick = setInterval(() => {
      setRemaining((n) => {
        if (n <= 1) {
          clearInterval(tick);
          setSkippable(true);
          return 0;
        }
        return n - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad]);

  if (givenUp || !ad) return null;

  const finish = () => {
    setGivenUp(true);
    onDone?.();
  };

  return (
    <div
      data-preroll="true"
      className="space-y-2"
      role="region"
      aria-label="Advertisement"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black ring-1 ring-[var(--color-line-strong)]">
        {ad.kind === 'embed' ? (
          <div className="h-full w-full [&>div]:h-full">
            <EmbedPlayer provider={ad.provider} videoId={ad.videoId} title={ad.title} />
          </div>
        ) : (
          <video
            ref={videoRef}
            src={ad.src}
            // Muted autoplay with controls: the visitor can unmute or scrub, and
            // nothing plays that they did not start.
            autoPlay
            muted
            playsInline
            controls
            controlsList="nodownload"
            onEnded={finish}
            onError={finish}
            className="h-full w-full"
          >
            <track kind="captions" />
          </video>
        )}

        {/* The label is not dismissible and does not expire. An advert that can
            be made to look editorial by clicking once is not an advert anyone
            should accept. */}
        <span className="pointer-events-none absolute left-2 top-2 rounded-[3px] bg-black/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          Advertisement
        </span>

        {/* Skip is on screen from the first second, greyed until it becomes
            usable. Never a spinner, never a countdown nobody can escape. */}
        <button
          type="button"
          onClick={finish}
          disabled={!skippable}
          className={`absolute bottom-3 right-3 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            skippable
              ? 'bg-white text-black hover:bg-white/90'
              : 'cursor-not-allowed bg-black/70 text-white/60'
          }`}
        >
          {skippable ? 'Skip ad' : `Skip in ${remaining}`}
        </button>
      </div>

      <p className="text-[11px] text-[var(--color-faint)]">
        Advertisement. Skipping takes you straight to {ad.title ? 'the film' : 'the video'}.
      </p>
    </div>
  );
}
