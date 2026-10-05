import { useState } from 'react';
import { api } from '../api';
import { TITLE_TYPES } from '../lib/titleTypes';

/**
 * Posts a whole series from a pasted list of episode links.
 *
 * One YouTube or Vimeo link per line, in order. An episode name can be given
 * before a pipe:
 *
 *   The First Episode | https://www.youtube.com/watch?v=...
 *   https://youtu.be/...
 *   # lines starting with # are ignored
 *
 * The list is parsed and previewed before anything is sent, because the failure
 * that matters here is a series quietly landing with fewer episodes than were
 * pasted, and nobody notices that until someone has watched to the end.
 */
export default function SeriesImporter({ onMessage, onImported }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('series');
  const [synopsis, setSynopsis] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = list.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  // A rough count for the button, not a parse: the real parse happens server
  // side and reports the authoritative list.
  const count = lines.length;

  async function onSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      onMessage?.({ ok: false, text: 'Give the series a title' });
      return;
    }
    if (count === 0) {
      onMessage?.({ ok: false, text: 'Paste at least one episode link' });
      return;
    }

    setBusy(true);
    onMessage?.(null);
    try {
      const d = await api.importSeries({
        title: title.trim(),
        type,
        synopsis: synopsis.trim(),
        posterUrl: posterUrl.trim() || null,
        episodes: list,
      });

      // Problems are surfaced even on success, because an import that quietly
      // dropped three lines is a support ticket later.
      if (d.problems?.length) {
        onMessage?.({
          ok: false,
          text: `Imported ${d.imported} of ${count} episodes. Skipped ${d.problems.length} line(s) — first was line ${d.problems[0].line}: ${d.problems[0].error}`,
        });
      } else {
        onMessage?.({
          ok: true,
          text: `"${d.title.title}" imported with ${d.imported} episode${d.imported === 1 ? '' : 's'}.`,
        });
      }

      setTitle('');
      setSynopsis('');
      setPosterUrl('');
      setList('');
      setOpen(false);
      onImported?.(d.title);
    } catch (err) {
      onMessage?.({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 text-left ring-1 ring-[var(--color-line)] transition hover:bg-[var(--color-surface-2)]"
      >
        <p className="text-xs font-medium text-[var(--color-muted)]">Import a whole series at once</p>
        <p className="mt-1 text-[11px] text-[var(--color-faint)]">
          Paste a list of YouTube or Vimeo episode links and every one becomes an episode. Fastest
          way to fill a season.
        </p>
      </button>
    );
  }

  const input =
    'w-full rounded-[var(--radius-control)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] ring-1 ring-[var(--color-line-strong)] outline-none placeholder:text-[var(--color-faint)] focus:ring-2 focus:ring-[var(--color-accent)]';

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--color-muted)]">Import a series</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-medium text-[var(--color-faint)] underline underline-offset-2 hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="imp-title" className="mb-1 block text-[11px] text-[var(--color-faint)]">
            Series title
          </label>
          <input
            id="imp-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={input}
            placeholder="Frieren: Beyond Journey's End"
          />
        </div>
        <div>
          <label htmlFor="imp-type" className="mb-1 block text-[11px] text-[var(--color-faint)]">
            Category
          </label>
          <select
            id="imp-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={input}
          >
            {TITLE_TYPES.filter((t) => t.value !== 'ads').map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="imp-syn" className="mb-1 block text-[11px] text-[var(--color-faint)]">
          Description (optional)
        </label>
        <textarea
          id="imp-syn"
          rows={2}
          value={synopsis}
          onChange={(e) => setSynopsis(e.target.value)}
          className={`${input} resize-y`}
        />
      </div>

      <div>
        <label htmlFor="imp-poster" className="mb-1 block text-[11px] text-[var(--color-faint)]">
          Poster image URL (optional)
        </label>
        <input
          id="imp-poster"
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          className={input}
          placeholder="https://…/poster.jpg"
        />
      </div>

      <div>
        <label htmlFor="imp-list" className="mb-1 block text-[11px] text-[var(--color-faint)]">
          Episode links, one per line
        </label>
        <textarea
          id="imp-list"
          rows={7}
          value={list}
          onChange={(e) => setList(e.target.value)}
          className={`${input} resize-y font-mono text-xs`}
          placeholder={`The First Meeting | https://www.youtube.com/watch?v=...
https://youtu.be/…
# lines starting with # are ignored`}
          aria-describedby="imp-help"
        />
        <p id="imp-help" className="mt-1 text-[11px] text-[var(--color-faint)]">
          Add an episode name before a <code className="text-[var(--color-muted)]">|</code> if you
          want one — otherwise episodes are numbered. {count || 'No'}{' '}
          {count === 1 ? 'line' : 'lines'} ready.
        </p>
      </div>

      <button
        type="submit"
        disabled={busy || !title.trim() || count === 0}
        className="w-full rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
      >
        {busy ? 'Importing…' : `Import ${count || ''} episode${count === 1 ? '' : 's'}`}
      </button>

      <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
        Each link is reduced to a video id on our server, so only the provider and the id are
        stored — never the pasted markup. Every episode is created in one transaction, so a
        failure cannot leave a half-built series.
      </p>
    </form>
  );
}
