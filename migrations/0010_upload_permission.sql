-- Adds the `upload` permission to the catalogue.
--
-- Deliberately separate from `catalog`: a moderator who can add titles is not
-- automatically someone who should be able to put a file on the server.
-- Uploading is the action that costs storage, burns bandwidth and needs
-- moderation attention, so it is granted on its own rather than riding along
-- with metadata editing.
--
-- Admins hold every permission implicitly, so nothing is granted to them here.
-- Regular users get no upload path at all: the endpoint requires this
-- permission, which a `user` role can never satisfy.
--
-- Existing moderator grants are untouched, so nobody gains upload access by
-- this migration. The admin grants it deliberately from the staff console.
INSERT OR IGNORE INTO permissions (id, label, description, sort_order) VALUES
  ('upload', 'Upload video',
   'Send a video file to the site and publish it to the catalog.', 50);
