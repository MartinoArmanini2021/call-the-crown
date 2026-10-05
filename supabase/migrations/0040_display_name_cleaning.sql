-- =====================================================================================================
-- 0040 - display names that cannot hide, flip or smear the boards (audit 5 Oct 2026, finding L4)
-- 0005's clean_display_name only collapsed \s and checked 2-24 characters, so a name made of zero-width
-- characters, one that starts with a right-to-left override, one carrying control characters, or one
-- with dozens of stacked combining marks was stored and shown to every fan. Now:
--   * every kind of space (incl. no-break U+00A0 and ideographic U+3000) collapses to one space;
--   * a name with a control character (C0, DEL, C1) or an invisible format character (soft hyphen,
--     Arabic letter mark, Hangul fillers, Mongolian vowel separator, zero-width and direction marks,
--     embeddings/overrides U+202A-202E, word joiner and isolates U+2060-206F, BOM) is refused;
--   * three or more combining marks in a row are refused (Arabic harakat and accents use one or two).
-- Refused means NULL, exactly as a wrong length always did: update_profile raises display_name_length
-- and a sign-up keeps no name. The patterns are written as regex escapes on purpose: no invisible
-- character in this file.
-- =====================================================================================================
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
           else n
         end
    from (select btrim(regexp_replace(coalesce(p_name, ''),
                                      '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+', ' ', 'g')) as n) s
$$;
