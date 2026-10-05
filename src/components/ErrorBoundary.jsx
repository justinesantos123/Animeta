import { Component } from 'react';

/**
 * Catches render-time crashes and shows a message instead of a blank panel.
 *
 * This exists because of a bug that shipped a completely empty Users tab: a
 * component referenced a constant that was never defined, React threw during
 * render, and there was nothing above it to catch that. Anything below this
 * boundary can now fail without taking the page with it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The full stack is for the console; the UI only gets a plain message.
    console.error('Render crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <div role="alert" className="rounded-[var(--radius-card)] bg-surface p-8 ring-1 ring-[var(--color-line-strong)]">
          <h1 className="text-lg font-bold">This section failed to load</h1>
          <p className="mt-2 text-sm text-muted">
            Something went wrong while drawing this page. Reloading usually clears it. If it keeps
            happening, the details are in the browser console.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}