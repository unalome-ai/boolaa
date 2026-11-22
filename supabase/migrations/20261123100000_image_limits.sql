-- Image limits for the public image buckets (docs/boolaa-spec.md, "Images").
--
-- Every client decodes the picked photo, applies its EXIF orientation, downsizes it (long edge
-- 1600 px, avatars 512 px) and re-encodes it as JPEG before upload. Re-encoding is what drops all
-- metadata (GPS location, camera, timestamps). These limits are the server-side backstop:
--   * file_size_limit: avatars 2 MB, food and marketplace photos 5 MB. A re-encoded photo is a few
--     hundred KB, so only a client that skips the pipeline hits them. Storage answers HTTP 413.
--   * allowed_mime_types: JPEG (what the clients send) and WebP (kept for a future client switch).
--     Anything else (PNG, GIF, HEIC, SVG, ...) is refused with HTTP 415 `invalid_mime_type`.
-- Storage checks both on upload only, so objects already stored keep loading.
-- No `_thumb` variants and no Supabase image transformations (paid feature): lists show the same
-- image, sized by CSS / native views.

update storage.buckets
set file_size_limit = case id when 'avatars' then 2 * 1024 * 1024 else 5 * 1024 * 1024 end,
    allowed_mime_types = array['image/jpeg', 'image/webp']
where id in ('avatars', 'food.images', 'market.images');
