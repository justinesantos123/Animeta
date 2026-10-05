import { useCallback, useRef, useState } from 'react';

/**
 * Uploads a video to R2 through the Worker.
 *
 * Reports progress from the XHR upload event, which is the only way to get real
 * progress on a fetch upload. The file is sent as the raw request body with the
 * name in the query string, rather than as multipart form data: the Worker has to
 * be able to stream the body straight to R2, and building a multipart body would
 * mean holding the whole video in memory first.
 */
export default function VideoUploader({ onUploaded, disabled }) {
  const inputRef = useRef(null);
  const xhrRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = useCallback(
    (file) => {
      setBusy(true);
      setError(null);
      setProgress(0);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.open(
        'POST',
        `/api/uploads?filename=${encodeURIComponent(file.name)}`,
        true,
      );
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');

      // upload.onprogress is the only event that reports bytes sent rather than
      // bytes received, which is what an upload needs.
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = async () => {
        setBusy(false);
        let payload = null;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          // A non-JSON body means the Worker failed before reaching a handler,
          // which is worth reporting plainly rather than as "unknown error".
          setError('The upload could not be completed.');
          return;
        }
        if (xhr.status >= 400) {
          setError(payload.error || 'The upload was rejected.');
          return;
        }
        onUploaded?.(payload.upload);
      };

      xhr.onerror = () => {
        setBusy(false);
        setError('The upload failed. Check your connection and try again.');
      };
      // Fires on an explicit abort as well as a timeout, so the message has to
      // say which happened.
      xhr.onabort = () => {
        setBusy(false);
        setError('Upload cancelled.');
      };

      xhr.send(file);
    },
    [onUploaded],
  );

  const onPick = (e) => {
    const file = e.target.files?.[0];
    // Cleared so re-picking the same file fires a change event again.
    e.target.value = '';
    if (!file) return;
    send(file);
  };

  const onCancel = () => xhrRef.current?.abort();

  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]">
      <p className="text-xs font-medium text-[var(--color-muted)]">Your own video</p>

      {busy ? (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
          >
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-[var(--color-faint)]">
              {progress}% uploaded
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="text-[11px] font-medium text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            id="video-file"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            onChange={onPick}
            disabled={disabled}
            aria-describedby="upload-help"
            className="mt-2 block w-full text-xs text-[var(--color-muted)] file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-[var(--color-surface-2)] file:px-3 file:py-2 file:text-xs file:font-medium file:text-[var(--color-text)] hover:file:bg-[var(--color-surface-3)]"
          />
          <p id="upload-help" className="mt-1.5 text-[11px] text-[var(--color-faint)]">
            MP4, WebM or MOV, up to 500MB. The file is stored on the site and plays
            for everyone, so only upload video you have the right to publish.
          </p>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2.5 rounded-[var(--radius-control)] bg-[var(--color-danger)]/12 px-3 py-2 text-xs text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/30"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Reads duration and dimensions out of the file, locally, before it is sent.
 *
 * Done in the browser because the browser is the only thing here that can decode
 * the header without a server-side ffprobe. The values are reported to the server
 * for display only and are never trusted for anything that matters.
 */
export async function probeVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const done = (result) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };

    video.onloadedmetadata = () => {
      done({
        durationSecs: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    };
    // A codec the browser cannot decode leaves metadata unreadable. The upload
    // still proceeds; the fields simply stay empty.
    video.onerror = () => done({ durationSecs: null, width: null, height: null });

    video.src = url;
  });
}
