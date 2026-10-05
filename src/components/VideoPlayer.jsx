import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

/**
 * HTML5 video with HLS support.
 *
 * Browsers split into three cases, and all three have to be handled or the
 * player fails silently on some browsers:
 *   1. Progressive file (.mp4, .webm) -> native playback, hls.js bypassed.
 *   2. Native HLS (Safari, iOS)       -> assign src directly, no JS needed.
 *   3. MSE + Hls.isSupported()        -> attach hls.js.
 *   4. Neither                         -> surface a real error instead of hanging.
 *
 * No crossOrigin attribute: it forces a CORS media request, and a same-origin
 * stream route would then have to send Access-Control-Allow-Origin for no
 * benefit. Nothing here reads pixels or audio, so it is not needed.
 */
/**
 * True for a progressive file the browser can play directly.
 *
 * hls.js exists to fetch and transmux playlists (.m3u8). Handing it a plain
 * .mp4 makes it spin up an MSE pipeline that never completes, leaving the video
 * stuck at readyState 0 with no error. Progressive files must bypass hls.js
 * entirely and go straight to <video src>.
 *
 * `kind` matters as much as the extension, because a streamed upload has no
 * extension to go on: it is served from /api/stream/<id>, and the file's real
 * type lives in the uploads table. Judging it by URL alone sent every upload
 * through hls.js, where it hung silently at readyState 0.
 */
function isProgressive(src, kind) {
  if (kind === 'upload' || kind === 'file') return true;
  if (!src) return false;
  const path = String(src).split(/[?#]/)[0].toLowerCase();
  // Ignore a playlist extension on the path; an .mp4 extension is decisive.
  return /\.(mp4|m4v|webm|mov|ogv|ogg)$/.test(path);
}

export default function VideoPlayer({ src, kind, poster, subtitlesUrl, title, onProgress }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setStatus('loading');
    setError(null);

    // Progressive file: the browser already knows how to play it. Safari plays
    // HLS natively too, so both cases skip hls.js.
    if (isProgressive(src, kind) || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      setStatus('ready');

      const onLoaded = () => setStatus('ready');
      const onError = () => {
        setError('This video could not be loaded.');
        setStatus('error');
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);

      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        video.removeAttribute('src');
        video.load();
      };
    }

    if (!Hls.isSupported()) {
      setError('Your browser cannot play this stream.');
      setStatus('error');
      return undefined;
    }

    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hlsRef.current = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, () => setStatus('ready'));

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          setError('This video could not be loaded.');
          setStatus('error');
          hls.destroy();
          hlsRef.current = null;
      }
    });

    hls.loadSource(src);
    hls.attachMedia(video);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  // Report playback position periodically for signed-in viewers.
  useEffect(() => {
    if (!onProgress) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    const id = setInterval(() => {
      if (video.currentTime > 0) onProgress(video.currentTime);
    }, 10000);
    return () => clearInterval(id);
  }, [onProgress]);

  return (
    <div className="relative w-full overflow-hidden rounded-[var(--radius-card)] bg-black ring-1 ring-[var(--color-line)]">
      <div className="aspect-video w-full">
        <video
          ref={videoRef}
          className="h-full w-full bg-black"
          controls
          playsInline
          poster={poster}
          aria-label={title ? `Video player for ${title}` : 'Video player'}
        >
          {subtitlesUrl && (
            <track kind="subtitles" src={subtitlesUrl} srcLang="en" label="English" default />
          )}
        </video>
      </div>

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="flex items-center gap-2.5 text-xs text-white/70">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
            Loading stream
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/85 p-6 text-center">
          <p className="text-sm font-semibold text-[var(--color-danger)]">Playback failed</p>
          <p className="max-w-sm text-xs text-white/60">{error}</p>
        </div>
      )}
    </div>
  );
}