-- =====================================================================================================
-- Display names (clean_display_name): what a fan types is what every other fan sees on the boards, so a
-- name may not be invisible, flip the direction of the text around it, carry control characters or
-- stack combining marks over its neighbours. Ordinary names in any script, accents and emoji still pass.
-- Runs inside begin … rollback (bun run test:sql display_name).
-- =====================================================================================================
begin;

create function pg_temp.c(p text) returns text language sql as $$ select public.clean_display_name(p) $$;

-- ordinary names
select t.check('plain name kept',            pg_temp.c('Fan One') = 'Fan One');
select t.check('spaces collapsed',           pg_temp.c(E'  Fan \t\n One ') = 'Fan One');
select t.check('accents kept',               pg_temp.c('José Núñez') = 'José Núñez');
select t.check('Arabic kept',                pg_temp.c('محمد العتيبي') = 'محمد العتيبي');
select t.check('Arabic with harakat kept',   pg_temp.c('مُحَمَّد') = 'مُحَمَّد');
select t.check('emoji kept',                 pg_temp.c(chr(128081) || ' King') = chr(128081) || ' King');
select t.check('2 and 24 chars accepted',    pg_temp.c('Ab') = 'Ab' and pg_temp.c(repeat('x', 24)) = repeat('x', 24));
select t.check('1 and 25 chars refused',     pg_temp.c('A') is null and pg_temp.c(repeat('x', 25)) is null);
select t.check('only spaces refused',        pg_temp.c('     ') is null);
select t.check('only no-break spaces refused', pg_temp.c(repeat(chr(160), 3)) is null
                                             and pg_temp.c(repeat(chr(12288), 3)) is null);
select t.check('no-break space collapsed',   pg_temp.c('Fan' || chr(160) || 'One') = 'Fan One');

-- invisible names
select t.check('zero-width spaces refused',  pg_temp.c(chr(8203) || chr(8203)) is null);
select t.check('word joiner + BOM refused',  pg_temp.c(chr(8288) || chr(65279)) is null);
select t.check('LRM + RLM refused',          pg_temp.c(chr(8206) || chr(8207)) is null);
select t.check('Arabic letter mark refused', pg_temp.c(chr(1564) || chr(1564)) is null);
select t.check('Hangul filler refused',      pg_temp.c(chr(12644) || chr(12644)) is null);
select t.check('zero-width joiner inside a word refused', pg_temp.c('Ad' || chr(8205) || 'min') is null);

-- direction overrides and isolates
select t.check('RTL override refused',       pg_temp.c(chr(8238) || 'nimda') is null);
select t.check('override + pop refused',     pg_temp.c('Fan ' || chr(8238) || 'drowssap' || chr(8236)) is null);
select t.check('isolates refused',           pg_temp.c(chr(8295) || 'Fan' || chr(8297)) is null);

-- control characters
select t.check('BEL refused',                pg_temp.c('Fan' || chr(7) || chr(7)) is null);
select t.check('DEL / C1 refused',           pg_temp.c('Fan' || chr(127)) is null and pg_temp.c('Fan' || chr(150) || 'x') is null);
select t.check('next-line (U+0085) is only a space', pg_temp.c('Fan' || chr(133) || 'x') = 'Fan x');

-- stacked combining marks
select t.check('Zalgo refused',              pg_temp.c('Z' || repeat(chr(822) || chr(851) || chr(769) || chr(860), 5) || 'a') is null);
select t.check('marks only refused',         pg_temp.c(chr(769) || chr(769) || chr(769)) is null);

-- names that imitate the game's own staff (decision 6 Oct 2026, 0051): compared by what they look like
select t.check('Admin refused',                pg_temp.c('Admin') is null and pg_temp.c('ADMIN') is null);
select t.check('Admin with spaces/dots refused', pg_temp.c('A d m i n') is null and pg_temp.c('admin.') is null);
select t.check('Admin + a name refused',       pg_temp.c('Admin Tino') is null and pg_temp.c('Tino Admin') is null);
select t.check('digit look-alikes refused',    pg_temp.c('4dm1n') is null);
select t.check('fullwidth ADMIN refused',
  pg_temp.c(chr(65313) || chr(65316) || chr(65325) || chr(65321) || chr(65326)) is null);
select t.check('Cyrillic look-alike Call the Crown refused',
  pg_temp.c('C' || chr(1072) || 'll the Cr' || chr(1086) || 'wn') is null);
select t.check('the app name in any case or spacing refused',
  pg_temp.c('Call the Crown') is null and pg_temp.c('callthecrown') is null and pg_temp.c('Call The Crown HQ') is null);
select t.check('staff words refused',
  pg_temp.c('Staff') is null and pg_temp.c('Moderator') is null and pg_temp.c('Support') is null
  and pg_temp.c('Official') is null and pg_temp.c('Official Tips') is null and pg_temp.c('Organiser') is null);
select t.check('the operator name refused',    pg_temp.c('Grand Slam GM') is null);
select t.check('the Arabic app name refused',  pg_temp.c('توقّع التاج') is null and pg_temp.c('توقع التاج') is null);
select t.check('Arabic staff words refused',   pg_temp.c('مشرف') is null and pg_temp.c('الإدارة') is null);
select t.check('real names that merely contain the letters pass',
  pg_temp.c('Badminton Bob') = 'Badminton Bob' and pg_temp.c('Staffan') = 'Staffan'
  and pg_temp.c('Crown Prince') = 'Crown Prince' and pg_temp.c('Supporter 7') = 'Supporter 7'
  and pg_temp.c('Mod Squad') = 'Mod Squad' and pg_temp.c('Teamwork') = 'Teamwork');
select t.check('Arabic names pass',            pg_temp.c('مدير الكرة') = 'مدير الكرة' and pg_temp.c('تاج') = 'تاج');

-- the same rule reaches a sign-up and a profile change
select t.setup_event();
select t.new_user(1, 'Fan One', true, true);
select t.as_user(t.uid(1));
select t.check('update_profile refuses an override name',
               t.err($$select public.update_profile(chr(8238) || 'nimda')$$) = 'display_name_length');
select t.check('update_profile says why a staff name is refused',
  t.err($$select public.update_profile('Call the Crown')$$) = 'display_name_reserved');
select t.as_service();

select * from t.report();
rollback;
