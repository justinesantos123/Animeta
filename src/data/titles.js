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
    seasons: [
      {
        description: 'The salvage crew answers the signal.',
        episodes: [
          { title: 'The Listening Station', runtime: '10:34' },
          { title: 'Salvage Rights', runtime: '09:58' },
          { title: 'Thirty Years of Names', runtime: '10:12' },
          { title: 'Approach Vector', runtime: '11:05' },
        ],
      },
      {
        description: 'The crew finds out who is calling.',
        episodes: [
          { title: 'Answering Position', runtime: '10:47' },
          { title: 'Decommission', runtime: '10:22' },
          { title: 'One of Them', runtime: '12:14' },
        ],
      },
    ],
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
    seasons: [
      {
        description: 'Season one: the folded ones.',
        episodes: [
          { title: 'Fold', runtime: '26:40' },
          { title: 'Origami at Dawn', runtime: '24:19' },
          { title: 'The Paper Museum', runtime: '27:03' },
          { title: 'Crease', runtime: '25:51' },
        ],
      },
    ],
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
    seasons: [
      {
        description: 'Every summer has a season.',
        episodes: [
          { title: 'Blow', runtime: '18:22' },
          { title: 'String', runtime: '17:48' },
          { title: 'The Tail', runtime: '19:05' },
        ],
      },
    ],
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
    seasons: [
      {
        description: 'Last crossing of the day.',
        episodes: [
          { title: 'Six Departures', runtime: '44:10' },
          { title: 'No Through Service', runtime: '46:55' },
        ],
      },
    ],
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
    seasons: [
      {
        description: 'The tribunal, season one.',
        episodes: [
          { title: 'The Filing', runtime: '51:12' },
          { title: 'Hostile Witness', runtime: '49:38' },
          { title: 'Reformation', runtime: '52:04' },
        ],
      },
    ],
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
    seasons: [
      {
        description: 'Generated frame sequences, scored from a synthetic stem.',
        episodes: [
          { title: 'Catalogue of Small Losses', runtime: '11:02' },
          { title: 'Entry Nine Is a Name', runtime: '09:48' },
          { title: 'The Tide Returns It', runtime: '10:15' },
        ],
      },
    ],
  },
  {
    id: 'tidefall-academy',
    type: 'anime',
    title: 'Tidefall Academy',
    synopsis:
      'A tidal magic school where every spell is a loan from the sea, and the final exam is billed directly to the students who cast it.',
    genres: ['Fantasy', 'School', 'Adventure'],
    releaseDate: '2025-10-03',
    runtime: '24m per episode',
    rating: 8.4,
    posterUrl: 'https://picsum.photos/seed/animetaan1/400/600',
    backdropUrl: 'https://picsum.photos/seed/animetaan1b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
    seasons: [
      {
        description: 'First term on the reef.',
        episodes: [
          { title: 'The Debt of a Single Wave', runtime: '24:11' },
          { title: 'Borrowed Tide', runtime: '23:47' },
          { title: 'What the Reef Remembers', runtime: '24:02' },
          { title: 'Reckoning in Shallows', runtime: '25:18' },
        ],
      },
      {
        description: 'The semester the sea starts collecting.',
        episodes: [
          { title: 'Undertow', runtime: '24:30' },
          { title: 'A Thousand Small Owes', runtime: '23:55' },
          { title: 'The Final Exam', runtime: '26:04' },
        ],
      },
    ],
  },
  {
    id: 'neon-kamisarai',
    type: 'anime',
    title: 'Neon Kamisarai',
    synopsis:
      'Cyberpunk samurai street sweepers hunt a ghost that only appears in reflections, three seconds after it has already happened.',
    genres: ['Action', 'Sci-Fi', 'Cyberpunk'],
    releaseDate: '2026-01-22',
    runtime: '22m per episode',
    rating: 8.1,
    posterUrl: 'https://picsum.photos/seed/animetaan2/400/600',
    backdropUrl: 'https://picsum.photos/seed/animetaan2b/1600/900',
    videoUrl: HLS_SAMPLES[1],
    subtitlesUrl: SUBS,
    seasons: [
      {
        description: 'Sweep logs.',
        episodes: [
          { title: 'Three Seconds Late', runtime: '22:36' },
          { title: 'Glass District', runtime: '22:04' },
          { title: 'The Sweeper Who Was Not There', runtime: '23:19' },
          { title: 'Rain on Neon', runtime: '22:48' },
          { title: 'Reflections and Debts', runtime: '24:01' },
        ],
      },
    ],
  },
  {
    id: 'paper-lantern-kids',
    type: 'anime',
    title: 'Paper Lantern Kids',
    synopsis:
      'Four children run a midnight festival float for the dead and slowly realise the festival is running them.',
    genres: ['Drama', 'Supernatural', 'Slice of Life'],
    releaseDate: '2024-11-08',
    runtime: '26m per episode',
    rating: 8.6,
    posterUrl: 'https://picsum.photos/seed/animetaan3/400/600',
    backdropUrl: 'https://picsum.photos/seed/animetaan3b/1600/900',
    videoUrl: HLS_SAMPLES[0],
    subtitlesUrl: SUBS,
    seasons: [
      {
        description: 'Lantern season.',
        episodes: [
          { title: 'The Float', runtime: '26:12' },
          { title: 'Paper and Saltwater', runtime: '25:44' },
          { title: 'Names on the River', runtime: '26:39' },
        ],
      },
    ],
  },
];

export const featured = titles[0];

export function getById(id) {
  return titles.find((t) => t.id === id);
}