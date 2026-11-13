-- =====================================================================================================
-- 0054 - the new app name is reserved too (Tino, 13 Nov 2026: the game is renamed "The Final Prediction"
-- for the ATP Finals). As 0051, with "The Final Prediction" and its Arabic name "التوقع النهائي" added
-- to the names a fan's display name may not contain. The old name stays reserved. Nothing else changes;
-- src/lib/displayName.ts mirrors the list and tests/displayName.test.ts keeps the two in agreement.
-- Existing profiles are not renamed.
-- =====================================================================================================
create or replace function public.display_name_reserved(p text) returns boolean
language sql immutable
set search_path = public
as $$
  with s(k) as (select public.name_skeleton(p)),
  words(w) as (
    select public.name_skeleton(x) from unnest(array[
      'admin', 'admins', 'administrator', 'moderator', 'mod team', 'staff', 'support', 'official',
      'system', 'operator', 'organiser', 'organizer', 'team', 'the team', 'host',
      'مشرف', 'المشرف', 'إدارة', 'الإدارة', 'مدير', 'المدير', 'مسؤول', 'المسؤول', 'دعم', 'الدعم']) x),
  inside(w) as (
    select public.name_skeleton(x) from unnest(array[
      'The Final Prediction', 'التوقع النهائي',
      'Call the Crown', 'توقع التاج', 'Grand Slam GM', 'administrator', 'moderator']) x)
  select k <> '' and (
           exists (select 1 from words where w = k)
        or exists (select 1 from inside where position(w in k) > 0)
        or k ~ '^(admin|official)' or k ~ '(admin|official)$')
    from s
$$;
revoke all on function public.display_name_reserved(text) from public, anon, authenticated, service_role;
