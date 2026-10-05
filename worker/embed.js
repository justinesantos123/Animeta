/**
 * YouTube and Vimeo embeds.
 *
 * Staff paste either an embed snippet or a share URL and the title is posted
 * with a real player. The important property of this module is what it does
 * NOT keep: the pasted markup is parsed for an ID and then discarded. Nothing
 * from the paste is ever stored or rendered, because storing arbitrary iframe
 * HTML and injecting it would be a stored cross-site-scripting hole - any
 * script, event handler or javascript: URL in a pasted snippet would run on
 * every visitor's page.
 *
 * So the pipeline is:
 *   paste -> pull out one provider + one opaque id -> build the iframe src from
 *   a template in this file -> render that
 *
 * The id is validated against a strict per-provider character class, and the
 * final URL is rebuilt rather than reused, so a crafted value cannot smuggle a
 * query string or a second host into the src.
 *
 * Embedding is the provider's own supported path: these players are what
 * YouTube and Vimeo hand out for a reason, and neither requires an API key for
 * a public video. What is refused here is proxying a provider's catalogue -
 * see worker/tmdb.js for the link-out route, which is the legitimate way to
 * show that a title is available elsewhere.
 */

/**
 * Each provider's id patterns, plus the hosts that must appear before any of
 * them is tried.
 *
 * The host check is not a shortcut, it is load-bearing. The `v/` and `live/`
 * patterns are short enough to match inside an unrelated hostname - `v/` occurs
 * in "clips.twitch.tv/SomeClip", so matching on the path alone turned a Twitch
 * clip into a YouTube video. Gating on the provider's own host first means an
 * id is only ever read out of a URL that is actually about that provider.
 */
const PROVIDERS = {
  youtube: {
    hosts: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'],
    patterns: [
      // youtu.be puts the id straight after the host, with no /v/ segment, so it
      // needs its own pattern. Safe to match literally here because the host
      // has already been confirmed.
      /youtu\.be\/([A-Za-z0-9_-]{6,})(?![A-Za-z0-9_-])/,
      // /embed/, /shorts/, /live/ and /v/ take the id as the next path segment.
      /\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})(?![A-Za-z0-9_-])/,
      // The ?v= parameter, which can appear after other parameters.
      /[?&]v=([A-Za-z0-9_-]{6,})(?![A-Za-z0-9_-])/,
    ],
  },
  vimeo: {
    hosts: ['vimeo.com', 'player.vimeo.com'],
    patterns: [
      /player\.vimeo\.com\/video\/(\d+)(?!\d)/,
      /vimeo\.com\/(\d+)(?!\d)/,
    ],
  },
};

/** Only these two are understood; anything else is refused by name. */
const SUPPORTED = Object.keys(PROVIDERS);

/** True when the input mentions one of the provider's own hosts. */
function mentionsProvider(provider, haystack) {
  const lower = haystack.toLowerCase();
  return PROVIDERS[provider].hosts.some((host) => lower.includes(host));
}

function extractId(provider, haystack) {
  for (const pattern of PROVIDERS[provider].patterns) {
    const match = haystack.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Rejects ids that are legal in a URL but wrong in an ID.
 *
 * A dotted-decimal id or anything with a dot could be read as a hostname by
 * some parsers, so it is refused rather than escaped.
 */
function idIsSane(id) {
  return Boolean(id) && !id.includes('.') && id.length <= 64;
}

/**
 * Builds the player URL for a provider and id.
 *
 * Rebuilt from scratch rather than taken from the paste: the id is validated
 * against a strict character class and interpolated into a known template, so
 * the result can only ever be a URL on the provider's own host.
 */
export function embedUrl(provider, id) {
  if (!SUPPORTED.includes(provider) || !idIsSane(String(id))) return null;
  const safe = String(id);

  if (provider === 'youtube') {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(safe)) return null;
    // nocookie is the privacy-preserving host YouTube offers, and rel=0 stops
    // it inferring anything from the referrer.
    return `https://www.youtube-nocookie.com/embed/${safe}?rel=0`;
  }
  if (!/^[0-9]{1,20}$/.test(safe)) return null;
  return `https://player.vimeo.com/video/${safe}`;
}

/** The human-facing page for a video, used for the "watch on" link. */
export function watchUrl(provider, id) {
  if (!SUPPORTED.includes(provider) || !idIsSane(String(id))) return null;
  const safe = String(id);
  if (provider === 'youtube' && /^[A-Za-z0-9_-]{6,64}$/.test(safe)) {
    return `https://www.youtube.com/watch?v=${safe}`;
  }
  if (provider === 'vimeo' && /^[0-9]{1,20}$/.test(safe)) {
    return `https://vimeo.com/${safe}`;
  }
  return null;
}

/**
 * Parses whatever staff pasted into a provider and an id.
 *
 * Accepts an `<iframe>` snippet, a share URL, a youtu.be short link, a Shorts
 * or live URL, or a bare id. Everything except the bare id has to contain the
 * provider's host, so a random string is not mistaken for a video.
 *
 * @returns {{error?: string, provider?: string, videoId?: string,
 *            embedUrl?: string, watchUrl?: string}}
 */
export function parseEmbed(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Paste an embed snippet or a share link' };

  // A bare id is only meaningful with the host present, so this only runs after
  // the host check has failed for everything else.
  for (const provider of SUPPORTED) {
    // The host has to be present. Without this, a Twitch clip resolves as a
    // YouTube video because "tv/" matches the /v/ id pattern.
    if (!mentionsProvider(provider, raw)) continue;

    const id = extractId(provider, raw);
    if (id && idIsSane(id)) {
      const embed = embedUrl(provider, id);
      if (!embed) return { error: `That does not look like a valid ${provider} video` };
      return { provider, videoId: id, embedUrl: embed, watchUrl: watchUrl(provider, id) };
    }
  }

  // Name the likely cause rather than "invalid", since "paste an embed" is the
  // most common mistake and it is not a formatting error.
  if (/<iframe/i.test(raw)) {
    return { error: 'Could not find a video id in that embed snippet' };
  }
  if (/vimeo\.com/i.test(raw)) return { error: 'Could not find a Vimeo video id' };
  if (/youtu/i.test(raw)) return { error: 'Could not find a YouTube video id' };

  return {
    error: 'Paste a YouTube or Vimeo embed snippet, or a share link to the video',
  };
}

/**
 * Fetches a title and thumbnail for a pasted video.
 *
 * Both providers expose a public oEmbed endpoint for this, needing no API key.
 * Best-effort: staff can always type the title by hand, so a failed lookup is
 * not an error, just fewer fields filled in.
 */
export async function fetchEmbedMetadata(provider, videoId) {
  const endpoints = {
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`,
    vimeo: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
      `https://vimeo.com/${videoId}`,
    )}`,
  };

  const url = endpoints[provider];
  if (!url) return {};

  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    // oEmbed answers 404 for a private, removed or non-existent video. That is
    // a normal outcome for a pasted link, not a failure worth surfacing.
    if (!res.ok) return {};

    const data = await res.json();
    return {
      title: typeof data.title === 'string' ? data.title.slice(0, 200) : undefined,
      author: typeof data.author_name === 'string' ? data.author_name.slice(0, 120) : undefined,
      thumbnailUrl:
        typeof data.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://')
          ? data.thumbnail_url
          : undefined,
      width: Number.isFinite(data.width) ? data.width : undefined,
      height: Number.isFinite(data.height) ? data.height : undefined,
    };
  } catch {
    // Offline, blocked or malformed JSON. The video still plays.
    return {};
  }
}

/**
 * A pastable embed snippet that would produce the same result.
 *
 * Shown to staff so they can see what "an embed link" means here, since what
 * people paste varies: a share URL, an iframe, a Shorts link, all work.
 */
export const EMBED_EXAMPLE =
  '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';