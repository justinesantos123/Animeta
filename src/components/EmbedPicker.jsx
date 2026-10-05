import { useState } from 'react';
import { api } from '../api';

/**
 * Paste an embed, get a playable title.
 *
 * Staff paste a share link or a full <iframe> snippet and this fills in the form
 * for them. The paste is sent to the server, which extracts the provider and
 * video id and throws the markup away; what comes back is a provider, an id and a
 * player URL the server rebuilt itself. The snippet is never stored, so it cannot
 * become stored XSS later.
 *
 * Every form of link that appears in the wild is accepted — share URL, youtu.be,
 * Shorts, live, or the raw iframe — because staff paste whatever the provider's
 * "share" button gave them, and telling them the format is wrong is a worse
 * answer than accepting it.
 */
export default function EmbedPicker({ onResolve, onMessage }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const url = value.trim();
    if (!url) {
      onMessage?.({ ok: false, text: 'Paste an embed snippet or a share link first' });
      return;
    }

    setBusy(true);
    onMessage?.(null);
    try {
      const d = await api.embedLookup(url);
      setValue('');
      onResolve(d);
      onMessage?.({
        ok: true,
        text: d.title
          ? `Found "${d.title}" on ${d.provider}. Fill in anything missing, then save.`
          : `Found a ${d.provider} video. Fill in the details, then save.`,
      });
      // oEmbed could not read the title, which is the usual sign the video is
      // private, unlisted or region-blocked. Worth saying separately, because the
      // result still posts and will show the viewer an error.
      if (d.hint) onMessage?.({ ok: true, text: d.hint, warn: true });
    } catch (err) {
      onMessage?.({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]"
    >
      <label htmlFor="embed-url" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
        Paste a YouTube or Vimeo embed
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <input
          id="embed-url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full min-w-56 flex-1 rounded-[var(--radius-control)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-[var(--color-faint)] focus:ring-2 focus:ring-[var(--color-accent)]"
          placeholder="https://www.youtube.com/watch?v=… or an &lt;iframe&gt; snippet"
          aria-describedby="embed-help"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
        >
          {busy ? 'Reading…' : 'Use this embed'}
        </button>
      </div>
      <p id="embed-help" className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
        Paste a share link, a youtu.be short link, or the whole{' '}
        <code className="text-[var(--color-muted)]">&lt;iframe&gt;</code> snippet from the
        provider&apos;s share dialog. The video plays on the provider&apos;s own player, so its
        terms and attribution apply.
      </p>
    </form>
  );
}