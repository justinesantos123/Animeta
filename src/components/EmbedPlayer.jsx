import { useMemo } from 'react';

/**
 * An embedded video, rendered as an iframe on the provider's own player.
 *
 * Deliberately not built from a stored URL. The title row holds a provider and
 * an id, and the src is reconstructed here from a fixed template, so nothing a
 * member of staff pasted can reach the DOM as markup. That is the whole reason
 * the paste is parsed server-side and thrown away rather than saved.
 *
 * YouTube's embed is the provider's own supported way to put a video on another
 * site, which is why this is not the same as what a link-out does: the video
 * plays inside the provider's player, with its own terms, attribution and
 * controls intact.
 */

/** Per-provider allow-lists for the iframe sandbox and permissions. */
const PROVIDERS = {
  youtube: {
    // rel=0 stops the player suggesting unrelated videos, and the host is the
    // privacy-preserving nocookie variant so a view here is not reported to
    // Google as a view on the origin.
    src: (id) => `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    watchUrl: (id) => `https://www.youtube.com/watch?v=${id}`,
    allow:
      'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
    // Autoplay is withheld on purpose: it is the one permission that lets the
    // player start making noise without the viewer asking.
    sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
    name: 'YouTube',
  },
  vimeo: {
    src: (id) => `https://player.vimeo.com/video/${id}`,
    watchUrl: (id) => `https://vimeo.com/${id}`,
    allow: 'autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media',
    sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
    name: 'Vimeo',
  },
};

/**
 * Last line of defence, mirroring the Worker's validation.
 *
 * The Worker already refuses a bad id on the way in, and rebuilds the URL on the
 * way out. This repeats the check in the client because the stored row could
 * predate that validation, and an iframe src is the one attribute here where a
 * stray quote would break out into markup.
 */
function idIsSafe(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && !/["'`\s<>\\/]/.test(id);
}

export default function EmbedPlayer({ provider, videoId, title }) {
  const config = useMemo(() => {
    const spec = PROVIDERS[provider];
    // Refuse rather than render a broken or unsafe frame.
    if (!spec || !idIsSafe(videoId)) return null;
    return spec;
  }, [provider, videoId]);

  if (!config) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--color-surface)] px-6 text-center text-sm text-[var(--color-muted)] ring-1 ring-[var(--color-line)]">
        <p>This title is marked as an embed, but its video reference is not valid.</p>
        <p className="text-xs text-[var(--color-faint)]">
          The link could not be rebuilt. Re-add it in the staff console.
        </p>
      </div>
    );
  }

  const src = config.src(videoId);

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black ring-1 ring-[var(--color-line)]">
        <iframe
          src={src}
          // Not user-controlled text, but title is still escaped by React.
          title={title ? `${title} — video` : 'Embedded video player'}
          // The provider's player needs its own scripts; the sandbox stops it
          // navigating the top-level page or reaching this origin's storage.
          className="h-full w-full border-0"
          allow={config.allow}
          allowFullScreen
          sandbox={config.sandbox}
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>

      {/* Attribution and a way out: some providers require it, and a viewer
          who cannot play the video should be able to reach the source. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-faint)]">
        <span>
          Plays on {config.name}.
        </span>
        <a
          href={config.watchUrl(videoId)}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="font-medium text-[var(--color-accent-strong)] hover:underline"
        >
          Watch on {config.name}
        </a>
      </p>
    </div>
  );
}