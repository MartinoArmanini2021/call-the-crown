-- =====================================================================================================
-- 0051 - names that imitate the game's own staff are refused (decided by Tino on 6 Oct 2026; audit L4)
-- The board shows names with no badge, so a fan called "Admin", "Call the Crown" or "Official Tips" looked
-- like the operator. Names are compared by what they look like, not how they are typed: name_skeleton
-- folds wide letters (NFKC), Cyrillic/Greek look-alikes, digit tricks (4dm1n), Arabic letter variants
-- and diacritics, then drops everything but letters. A name is reserved when its skeleton is a staff
-- word ("admin", "staff", "support", "official", "moderator", their Arabic equivalents ...), contains the
-- app or operator name ("Call the Crown", "توقع التاج", "Grand Slam GM") or a long staff word, or starts
-- or ends with "admin"/"official". Real names that only contain the letters ("Badminton Bob",
-- "Staffan", "Crown Prince", "Supporter 7") pass. The look-alike table is written as code points (no
-- look-alike characters in this file). src/lib/displayName.ts mirrors it so Join can say so before the
-- code is sent; tests/displayName.test.ts keeps the two in agreement.
-- clean_display_name (0040) refuses reserved names on every path; update_profile (0005) now says why
-- ('display_name_reserved'). Existing profiles are not renamed.
-- =====================================================================================================
create function public.name_skeleton(p text) returns text
language sql immutable
set search_path = public
as $$
  select regexp_replace(
           lower(translate(normalize(coalesce(p, ''), nfkc),
                           chr(48) || chr(49) || chr(51) || chr(52) || chr(53) || chr(55) || chr(64) || chr(36) || chr(1072) || chr(1077) || chr(1082) || chr(1084) || chr(1086) || chr(1088) || chr(1089) || chr(1091) || chr(1093) || chr(1110) || chr(1112) || chr(1109) || chr(1281) || chr(1231) || chr(1040) || chr(1045) || chr(1050) || chr(1052) || chr(1053) || chr(1054) || chr(1056) || chr(1057) || chr(1058) || chr(1059) || chr(1061) || chr(1030) || chr(1032) || chr(1029) || chr(945) || chr(949) || chr(953) || chr(954) || chr(957) || chr(959) || chr(961) || chr(964) || chr(965) || chr(967) || chr(913) || chr(914) || chr(917) || chr(918) || chr(919) || chr(921) || chr(922) || chr(924) || chr(925) || chr(927) || chr(929) || chr(932) || chr(933) || chr(935) || chr(305) || chr(593) || chr(1571) || chr(1573) || chr(1570) || chr(1572) || chr(1574) || chr(1609) || chr(1577),
                           'o' || 'i' || 'e' || 'a' || 's' || 't' || 'a' || 's' || 'a' || 'e' || 'k' || 'm' || 'o' || 'p' || 'c' || 'y' || 'x' || 'i' || 'j' || 's' || 'd' || 'l' || 'a' || 'e' || 'k' || 'm' || 'h' || 'o' || 'p' || 'c' || 't' || 'y' || 'x' || 'i' || 'j' || 's' || 'a' || 'e' || 'i' || 'k' || 'v' || 'o' || 'p' || 't' || 'u' || 'x' || 'a' || 'b' || 'e' || 'z' || 'h' || 'i' || 'k' || 'm' || 'n' || 'o' || 'p' || 't' || 'y' || 'x' || 'i' || 'a' || chr(1575) || chr(1575) || chr(1575) || chr(1608) || chr(1610) || chr(1610) || chr(1607))),
           '[^a-z' || chr(1569) || '-' || chr(1610) || ']|' || chr(1600), '', 'g')
$$;
revoke all on function public.name_skeleton(text) from public, anon, authenticated, service_role;

create function public.display_name_reserved(p text) returns boolean
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
      'Call the Crown', 'توقع التاج', 'Grand Slam GM', 'administrator', 'moderator']) x)
  select k <> '' and (
           exists (select 1 from words where w = k)
        or exists (select 1 from inside where position(w in k) > 0)
        or k ~ '^(admin|official)' or k ~ '(admin|official)$')
    from s
$$;
revoke all on function public.display_name_reserved(text) from public, anon, authenticated, service_role;

-- As 0040, plus the reserved-name refusal.
create or replace function public.clean_display_name(p_name text) returns text
language sql immutable
set search_path = public
as $$
  select case
           when char_length(n) not between 2 and 24 then null
           when n ~ '[\u0001-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]'
             then null
           when n ~ '[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{3,}'
             then null
           when public.display_name_reserved(n) then null
           else n
         end
    from (select btrim(regexp_replace(coalesce(p_name, ''),
                                      '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+', ' ', 'g')) as n) s
$$;

-- As 0005, but a refused name says whether it was the length or a staff name.
create or replace function public.update_profile(p_display_name text, p_locale text default null) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := public.clean_display_name(p_display_name);
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if v_name is null then
    if public.display_name_reserved(p_display_name) then raise exception 'display_name_reserved'; end if;
    raise exception 'display_name_length';
  end if;
  if p_locale is not null and p_locale not in ('en', 'ar') then raise exception 'bad_locale'; end if;
  update public.profiles
     set display_name = v_name, locale = coalesce(p_locale, locale)
   where user_id = v_uid;
end;
$$;
