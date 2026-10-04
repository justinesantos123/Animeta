import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

/**
 * HTML5 video with HLS support.
 *
 * Browsers split into three cases, and all three have to be handled or the
 * player fails silently on some browsers:
 *   1. Native HLS (Safari, iOS)  -> assign src directly, no JS needed.
 *   2. MSE + Hls.isSupported()   -> attach hls.js.
 *   3. Neither                    -> surface a real error instead of hanging.
 */
export default function VideoPlayer({ src, poster, subtitlesUrl, title }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setStatus('loading');
    setError(null);

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');

    if (nativeHls) {
      video.src = src;
      setStatus('ready');
    } else if (Hls.isSupported()) {
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
    } else {
      setError('Your browser cannot play HLS video.');
      setStatus('error');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
      <div className="aspect-video w-full">
        <video
          ref={videoRef}
          className="h-full w-full bg-black"
          controls
          playsInline
          crossOrigin="anonymous"
          poster={poster}
          aria-label={title ? `Video player for ${title}` : 'Video player'}
        >
          {subtitlesUrl && (
            <track
              kind="subtitles"
              src={subtitlesUrl}
              srcLang="en"
              label="English"
              default
            />
          )}
        </video>
      </div>

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="flex items-center gap-3 text-sm text-white/80">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading stream…
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-6 text-center">
          <p className="text-sm font-semibold text-cta">Playback failed</p>
          <p className="max-w-sm text-xs text-white/60">{error}</p>
        </div>
      )}
    </div>
  );
}