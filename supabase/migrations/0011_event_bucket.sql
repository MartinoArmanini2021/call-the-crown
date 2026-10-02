-- =====================================================================================================
-- 0011 — the storage bucket for the event's images (organiser-supplied player artwork, logo, prizes,
-- sponsors). The app reads them from `event` by path (publicImage in src/lib/api.ts).
-- Public to read, so the images load without signing in; nobody but the operator (service role,
-- which bypasses storage policies) can upload, replace or delete: there are no write policies.
-- Images only, at most 5 MB each.
-- =====================================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event', 'event', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
