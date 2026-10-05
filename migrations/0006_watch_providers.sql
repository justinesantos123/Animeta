-- Lets a title keep its link back to TMDB, and record where it can legally be
-- watched.
--
-- external_id / external_source remember which TMDB record a title came from,
-- so availability can be refreshed later without staff retyping the id.
-- external_source is stored rather than inferred from `type`, because staff can
-- retype a title after posting and a series sourced from a TMDB *movie* record
-- would otherwise be re-queried against the wrong namespace.
--
-- watch_providers is a snapshot of TMDB's JustWatch-backed availability, taken
-- when staff run a lookup and refreshed on demand. Stored rather than resolved
-- per page view so browsing the public catalog never spends TMDB quota.
--
-- NULL watch_providers means availability has not been looked up for that title,
-- which the UI reports as unknown rather than as "unavailable".
ALTER TABLE titles ADD COLUMN external_id TEXT;
ALTER TABLE titles ADD COLUMN external_source TEXT;
ALTER TABLE titles ADD COLUMN watch_providers TEXT;