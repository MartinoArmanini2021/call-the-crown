-- =====================================================================================================
-- Italian as a fan language (0060, 13 Nov 2026): a profile can hold 'it', set by the profile switch,
-- while any other code is still refused. Runs inside begin … rollback (bun run test:sql italian).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(1, 'Fan One', true, true);
select t.as_user(t.uid(1));
select t.check('update_profile accepts Italian',
  t.err($$select public.update_profile('Fan One', 'it')$$) is null);
select t.as_service();
select t.check('the profile now says it',
  (select locale from public.profiles where user_id = t.uid(1)) = 'it');
select t.as_user(t.uid(1));
select t.check('back to English works',
  t.err($$select public.update_profile('Fan One', 'en')$$) is null);
select t.check('an unknown language is still refused',
  t.err($$select public.update_profile('Fan One', 'fr')$$) = 'bad_locale');
select t.as_service();
select t.check('the table refuses an unknown language too',
  t.err($$update public.profiles set locale = 'xx' where user_id = t.uid(1)$$) is not null);

select * from t.report();
rollback;
