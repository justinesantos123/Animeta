-- Embedded video, as distinct from a file or a stream URL.
--
-- An embed is stored as a provider plus a validated id, never as the pasted
-- markup and never as a ready-made iframe URL. Rebuilding the player URL from
-- those two values at render time is what keeps a pasted snippet from becoming
-- a stored cross-site-scripting vector: the stored string cannot be anything
-- other than one of two known hostnames plus an id matched against a strict
-- character class.
--
-- video_kind is what the player keys off:
--   'file'   a progressive .mp4 served directly (the default)
--   'hls'    an .m3u8 manifest, played by hls.js
--   'embed'  an external player rendered as an iframe
--
-- embed_provider and embed_id are only meaningful when video_kind = 'embed'.
ALTER TABLE titles ADD COLUMN video_kind TEXT;
ALTER TABLE titles ADD COLUMN embed_provider TEXT;
ALTER TABLE titles ADD COLUMN embed_id TEXT;

-- Episodes can be embeds too. Same three columns, same reasoning: an episodic
-- title's per-episode video is the common case for a pasted embed.
ALTER TABLE episodes ADD COLUMN video_kind TEXT;
ALTER TABLE episodes ADD COLUMN embed_provider TEXT;
ALTER TABLE episodes ADD COLUMN embed_id TEXT;