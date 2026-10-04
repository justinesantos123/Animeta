# Animeta

A cinematic streaming interface for anime, movies and series. Dark theme, responsive layout, and
an embedded HLS video player.

## Stack

- React 18 + Vite 6
- React Router 6
- Tailwind CSS 4
- hls.js for HLS playback
- Cloudflare Workers Static Assets

## Design tokens

Defined in `src/index.css` via Tailwind 4 `@theme`:

| Token | Value |
| --- | --- |
| `--color-bg` | `#0D0D0F` |
| `--color-surface` | `#16161A` |
| `--color-accent` | `#7B61FF` |
| `--color-cta` | `#FF3B3B` |
| `--color-text` | `#E8E8EF` |
| `--color-muted` | `#8A8A99` |

## Getting started

```bash
npm install
npm run dev      # dev server
npm run build    # production build to dist/
npm run preview  # serve the production build locally
```

## Routes

| Route | Description |
| --- | --- |
| `/` | Hero, Continue Watching rail, Trending grid, New Releases |
| `/search` | Live search with genre and type filters |
| `/watchlist` | Saved titles (localStorage) |
| `/title/:id` | Detail page with the video player |

## Video playback

`src/components/VideoPlayer.jsx` handles all three HLS cases, which is required because browsers
differ:

1. **Native HLS** (Safari, iOS) — assigns `video.src` directly.
2. **MSE + `Hls.isSupported()`** (Chrome, Firefox, Edge) — attaches `hls.js`.
3. **Neither** — surfaces a visible error instead of hanging on a blank player.

`hls.js` fatal errors self-heal where possible: network errors call `startLoad()`, media errors call
`recoverMediaError()`.

Subtitles load from `public/subtitles/sample.vtt` via a `<track>` element. Swap that file for real
per-title timed subtitles.

Video URLs in `src/data/titles.js` point at public HLS test streams so playback works with no
backend. Replace `videoUrl` with your own manifests.

## Deploying to Cloudflare

`wrangler.jsonc` is configured for Workers Static Assets:

```jsonc
{
  "name": "animeta",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

`not_found_handling: "single-page-application"` is required — without it, refreshing a client-side
route such as `/title/solaris-requiem` returns 404 instead of serving `index.html`.

```bash
npx wrangler login     # once
npm run build
npx wrangler deploy
```

## Accessibility

- Skip-to-content link
- Visible focus rings, WCAG AA intent on muted text
- `prefers-reduced-motion` respected
- Captions via `<track>`, `aria-label` on the player, `aria-pressed` on toggles

## Status

Placeholder content only. All titles, synopses and artwork are fictional and images come from
`picsum.photos`. Auth, admin tooling and billing from the architecture spec are not implemented.