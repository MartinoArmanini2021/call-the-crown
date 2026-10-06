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

-- the same rule reaches a sign-up and a profile change
select t.setup_event();
select t.new_user(1, 'Fan One', true, true);
select t.as_user(t.uid(1));
select t.check('update_profile refuses an override name',
               t.err($$select public.update_profile(chr(8238) || 'nimda')$$) = 'display_name_length');
select t.as_service();

select * from t.report();
rollback;
