// Public HLS test streams so the player has something real to play.
const HLS_SAMPLES = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://test-streams.mux.dev/test_001/stream.m3u8',
];

// A public WebVTT track. Kept same-origin-agnostic; the player tolerates load failure.
const SUBS = '/subtitles/sample.vtt';

export const titles = [
  {
    id: 'solaris-requiem',
    type: 'series',
    title: 'Solaris Requiem',
    synopsis:
      'A deep-space salvage crew unearths a derelict listening station that has been broadcasting a name for thirty years — one of them.',
    genres: ['Sci-Fi', 'Mystery', 'Space'],
    releaseDate: '2025-04-11',
    runtime: '2h 04m',
    rating: 8.7,
    posterUrl: 'https://picsum.photos/seed/animeta1/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta1b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
  },
  {
    id: 'neon-courier',
    type: 'movie',
    title: 'Neon Courier',
    synopsis:
      'A bicycle courier in a flooded megacity takes one last package across town and discovers it was never meant to arrive.',
    genres: ['Thriller', 'Noir'],
    releaseDate: '2024-09-27',
    runtime: '1h 47m',
    rating: 7.9,
    posterUrl: 'https://picsum.photos/seed/animeta2/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta2b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
  },
  {
    id: 'paper-tigers',
    type: 'series',
    title: 'Paper Tigers',
    synopsis:
      'Three childhood rivals, now strangers, are forced back together by a championship that should never have been scheduled.',
    genres: ['Drama', 'Sport'],
    releaseDate: '2025-01-30',
    runtime: '10 ep',
    rating: 8.2,
    posterUrl: 'https://picsum.photos/seed/animeta3/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta3b/1600/900',
    videoUrl: HLS_SAMPLES[1],
    subtitlesUrl: SUBS,
  },
  {
    id: 'the-long-quiet',
    type: 'movie',
    title: 'The Long Quiet',
    synopsis:
      'After a solar storm blacks out the coast, a lighthouse keeper and a stranded physicist work out who is sending the signal.',
    genres: ['Sci-Fi', 'Drama'],
    releaseDate: '2023-11-14',
    runtime: '2h 21m',
    rating: 8.4,
    posterUrl: 'https://picsum.photos/seed/animeta4/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta4b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
  },
  {
    id: 'kite-season',
    type: 'series',
    title: 'Kite Season',
    synopsis:
      'A street racer trades her sponsor for a quiet year on a mountain pass, and finds the pass has other plans.',
    genres: ['Action', 'Drama'],
    releaseDate: '2025-06-02',
    runtime: '8 ep',
    rating: 7.6,
    posterUrl: 'https://picsum.photos/seed/animeta5/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta5b/1600/900',
    videoUrl: HLS_SAMPLES[1],
    subtitlesUrl: SUBS,
  },
  {
    id: 'glass-orchard',
    type: 'movie',
    title: 'Glass Orchard',
    synopsis:
      'A conservatory of artificial trees begins producing fruit that remembers every conversation held beneath it.',
    genres: ['Fantasy', 'Mystery'],
    releaseDate: '2024-03-08',
    runtime: '1h 58m',
    rating: 7.4,
    posterUrl: 'https://picsum.photos/seed/animeta6/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta6b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
  },
  {
    id: 'ferry-at-dusk',
    type: 'series',
    title: 'Ferry at Dusk',
    synopsis:
      'The last ferry of the night carries commuters, smugglers and one passenger who refuses to give a destination.',
    genres: ['Crime', 'Drama'],
    releaseDate: '2025-08-19',
    runtime: '6 ep',
    rating: 8.1,
    posterUrl: 'https://picsum.photos/seed/animeta7/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta7b/1600/900',
    videoUrl: HLS_SAMPLES[1],
    subtitlesUrl: SUBS,
  },
  {
    id: 'harrow-moons',
    type: 'movie',
    title: 'Harrow Moons',
    synopsis:
      'Two cartographers map a country that rearranges itself every time they sleep.',
    genres: ['Fantasy', 'Adventure'],
    releaseDate: '2022-12-16',
    runtime: '2h 09m',
    rating: 7.8,
    posterUrl: 'https://picsum.photos/seed/animeta8/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta8b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
  },
  {
    id: 'copper-verdict',
    type: 'series',
    title: 'Copper Verdict',
    synopsis:
      'A union lawyer takes a case she is certain will be settled by noon, in a city that never settles anything before dark.',
    genres: ['Legal', 'Crime'],
    releaseDate: '2025-05-07',
    runtime: '12 ep',
    rating: 8.6,
    posterUrl: 'https://picsum.photos/seed/animeta9/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta9b/1600/900',
    videoUrl: HLS_SAMPLES[1],
    subtitlesUrl: SUBS,
  },
  {
    id: 'salt-and-static',
    type: 'movie',
    title: 'Salt & Static',
    synopsis:
      'A pirate radio host broadcasting from a decommissioned offshore rig keeps answering a caller who died ten years ago.',
    genres: ['Horror', 'Mystery'],
    releaseDate: '2023-07-21',
    runtime: '1h 39m',
    rating: 7.2,
    posterUrl: 'https://picsum.photos/seed/animeta10/400/600',
    backdropUrl: 'https://picsum.photos/seed/animeta10b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
  },
  {
    id: 'lantern-of-lost-things',
    type: 'ai',
    title: 'Lantern of Lost Things',
    synopsis:
      'Generated end-to-end by a diffusion model and a fine-tuned voice set: a lighthouse keeper catalogues every object the tide returns, until one entry is her own name.',
    genres: ['Sci-Fi', 'Drama', 'Experimental'],
    releaseDate: '2026-02-18',
    runtime: '1h 31m',
    rating: 8.2,
    posterUrl: 'https://picsum.photos/seed/animetaai1/400/600',
    backdropUrl: 'https://picsum.photos/seed/animetaai1b/1600/900',
    videoUrl: HLS_SAMPLES[1],
    subtitlesUrl: SUBS,
  },
];

export const featured = titles[0];

export function getById(id) {
  return titles.find((t) => t.id === id);
}