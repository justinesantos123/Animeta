import { readFileSync } from 'node:fs';

const d = readFileSync('src/pages/TitleDetail.jsx', 'utf8');
let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; };

// The bug: episodes arrive snake_case, the title arrives camelCase. Reading one
// spelling only made an embed on an episode silently undefined.
check('embedKind accepts either casing', /\(source\.videoKind \?\? source\.video_kind\)/.test(d));
check('embedProvider accepts either casing', /source\.embedProvider \?\? source\.embed_provider/.test(d));
check('embedId accepts either casing', /source\.embedId \?\? source\.embed_id/.test(d));
check('VideoPlayer kind accepts either casing', /source\.videoKind \?\? source\.video_kind\)/.test(d));

// A series has no title-level video, so pre-roll has to consider episodes or an
// imported series can never show an advert.
check('pre-roll eligibility considers episodes', /episodes\.some\(\(e\) => e\.video_manifest_url \|\| e\.embed_id\)/.test(d));

// Every read of these off `source` must carry the fallback, so no one re-adds a
// bare camelCase access and reintroduces the bug on a different branch.
const bareReads = [...d.matchAll(/source\.(embedId|embedProvider|videoKind)\b(?!\s*\?\?)/g)];
check(
  'every embed field read off source carries the fallback',
  bareReads.length === 0,
  bareReads.map((m) => `source.${m[1]}`).join(', '),
);

console.log('');
if (failed) { console.log(`${failed} casing check(s) failed.`); process.exit(1); }
console.log('Episode field casing is handled at the boundary.');