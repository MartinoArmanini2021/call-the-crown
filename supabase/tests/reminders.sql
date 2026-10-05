-- =====================================================================================================
-- Perfect Night and night reminders (0022, brief "bragging rights", Phase 5): the night grouping, the
-- badge (missing pick, wrong winner, retirement), the reminders consent, who gets a reminder (opted out,
-- all picked, players unknown, already sent, outside the window), the claim (exactly once), failures,
-- the unsubscribe, grants and the one new cron job.
-- Runs inside begin … rollback (bun run test:sql reminders).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(n) from generate_series(1, 9) n;

-- ---------------------------------------------------------------------------------------------------
-- Nights: the Riyadh date of starts_at, numbered in order (21, 22, 24 Oct → 1, 2, 3)
-- ---------------------------------------------------------------------------------------------------
select t.check('night grouping: QF1 QF2 → 1, SF1 SF2 → 2, 3rd place and final → 3',
  (select array_agg(night_no order by match_no) from public.match_nights()) = array[1, 1, 2, 2, 3, 3]);
select t.check('… 24 Oct is night 3, not night 4 (dense numbering, as the app numbers them)',
  (select max(night_no) from public.match_nights()) = 3);

-- ---------------------------------------------------------------------------------------------------
-- 20 Oct: picks and reminder answers
-- ---------------------------------------------------------------------------------------------------
select t.pick(t.uid(1), 1, 'f', '4-6 6-3 4-6');
select t.pick(t.uid(1), 2, 'd', '6-4 6-4');
select t.pick(t.uid(2), 1, 'f', '4-6 4-6');                -- no pick on QF2
select t.pick(t.uid(3), 1, 'c', '6-4 6-4');                -- wrong winner on QF1
select t.pick(t.uid(3), 2, 'd', '6-4 6-4');
select t.pick(t.uid(6), 1, 'c', '6-4 6-4');                -- fan 6 picks both
select t.pick(t.uid(6), 2, 'e', '4-6 4-6');
select t.pick(t.uid(8), 1, 'c', '6-4 6-4');                -- fan 8 picks one of two

select t.as_user(t.uid(4)); select public.set_reminder_optin(true);
select t.as_user(t.uid(5)); select public.set_reminder_optin(true); select pg_sleep(0.01); select public.set_reminder_optin(false);
select t.as_user(t.uid(6)); select public.set_reminder_optin(true);
select t.as_user(t.uid(8)); select public.set_reminder_optin(true);
select t.as_user(t.uid(9)); select public.set_reminder_optin(true);
select t.as_user(t.uid(4)); select public.set_reminder_optin(true);   -- the same answer again
select t.as_owner();
update auth.users set email_confirmed_at = null where id = t.uid(9); -- an unconfirmed address

select t.check('set_reminder_optin writes the reminders party with text version reminders-1',
  (select bool_and(party = 'reminders' and text_version = 'reminders-1')
     from public.consents where user_id = t.uid(4) and party = 'reminders'));
select t.check('… and the same answer twice adds no row', (select count(*) from public.consents
  where user_id = t.uid(4) and party = 'reminders') = 1);
select t.check('… a change of mind is a new row (history kept)', (select count(*) from public.consents
  where user_id = t.uid(5) and party = 'reminders') = 2);
select t.as_anon();
select t.check('anon cannot set it', t.err('select public.set_reminder_optin(true)') like '%permission denied%');
select t.as_owner();

-- ---------------------------------------------------------------------------------------------------
-- Who gets a reminder
-- ---------------------------------------------------------------------------------------------------
select public.dev_set_now('2026-10-21 14:00+00');            -- QF1 at 16:30: 2.5 hours away
select t.check('2.5 hours before the first match: nobody yet', (select count(*) from public.reminder_candidates()) = 0);

select public.dev_set_now('2026-10-21 15:00+00');            -- 1.5 hours away
create temp table cand on commit drop as select * from public.reminder_candidates();
select t.check('1.5 hours before: fan 4 (opted in, nothing picked) for night 1, 2 open of 2',
  (select (night_no, open_count, total_count, locale) = (1, 2, 2, 'en') from cand where user_id = t.uid(4)));
select t.check('… fan 8 (one of two picked): 1 open of 2',
  (select (open_count, total_count) = (1, 2) from cand where user_id = t.uid(8)));
select t.check('… not fan 5 (opted out), fan 6 (all picked), fan 7 (never asked) or fan 9 (address not confirmed)',
  not exists (select 1 from cand where user_id in (t.uid(5), t.uid(6), t.uid(7), t.uid(9))));
select t.check('… exactly two fans', (select count(*) from cand) = 2);
select t.check('… no league line before any result', (select bool_and(league_name is null) from cand));

select t.as_service();
select t.check('the first claim wins', public.claim_reminder(t.uid(4), 1, false));
select t.check('… a second claim (another run at the same time) gets nothing', not public.claim_reminder(t.uid(4), 1, false));
select t.as_owner();
select t.check('… one row, status sent', (select count(*) = 1 and bool_and(status = 'sent') from public.reminder_sends where user_id = t.uid(4)));
select t.check('already sent: fan 4 is no longer a candidate for night 1',
  not exists (select 1 from public.reminder_candidates() where user_id = t.uid(4)));
select t.as_service();
select t.check('a dry run claims the row', public.claim_reminder(t.uid(8), 1, true));
select public.reminder_failed(t.uid(4), 1, 'resend 500');
select t.as_owner();
select t.check('… as dry_run', (select status from public.reminder_sends where user_id = t.uid(8)) = 'dry_run');
select t.check('a failed send is marked failed (and never retried: the row stays)',
  (select status from public.reminder_sends where user_id = t.uid(4)) = 'failed'
  and not exists (select 1 from public.reminder_candidates() where user_id = t.uid(4)));
select t.check('… with one ops alert that carries no personal data',
  (select count(*) = 1 and bool_and(detail = '{"night": 1, "error": "resend 500"}'::jsonb)
     from public.ops_alerts where kind = 'reminder_failed'));

select public.dev_set_now('2026-10-21 16:31+00');
select t.check('after the first match of the night starts: nobody', (select count(*) from public.reminder_candidates()) = 0);

select public.dev_set_now('2026-10-24 15:30+00');            -- night 3, an hour away, semis not played
select t.check('players unknown (night 3 before the semis are played): nobody',
  (select count(*) from public.reminder_candidates()) = 0);

-- ---------------------------------------------------------------------------------------------------
-- Perfect Night
-- ---------------------------------------------------------------------------------------------------
select public.dev_set_now('2026-10-21 20:00+00');
select t.feed(1, 'completed', 'f', '4-6 6-3 4-6');
select t.as_user(t.uid(1));
select t.check('a night with a match still to settle is not returned',
  (select count(*) from public.get_my_badges()) = 0);
select t.as_owner();
select t.feed(2, 'completed', 'd', '6-4 6-3');

select t.as_user(t.uid(1));
select t.check('night 1 complete: every winner right → perfect',
  (select array_agg((night_no, perfect)::text) from public.get_my_badges()) = array['(1,t)']);
select t.as_user(t.uid(2));
select t.check('a missing pick → not perfect', (select perfect from public.get_my_badges() where night_no = 1) = false);
select t.as_user(t.uid(3));
select t.check('a wrong winner → not perfect', (select perfect from public.get_my_badges() where night_no = 1) = false);
select t.as_user(t.uid(7));
select t.check('no picks at all → not perfect', (select perfect from public.get_my_badges() where night_no = 1) = false);

select t.as_owner();
select public.dev_set_now('2026-10-22 10:00+00');
select t.pick(t.uid(1), 3, 'a', '6-4 6-4');
select t.pick(t.uid(1), 4, 'b', '6-4 6-4');
select public.dev_set_now('2026-10-22 21:00+00');
select t.feed(3, 'completed', 'a', '6-4 4-6 6-3');
select t.feed(4, 'retired', 'b', '6-4 2-1');
select t.as_user(t.uid(1));
select t.check('a retirement: the winner counts → night 2 perfect',
  (select perfect from public.get_my_badges() where night_no = 2));

select t.as_user(null);
select t.check('no signed-in user: no badges', (select count(*) from public.get_my_badges()) = 0);

-- ---------------------------------------------------------------------------------------------------
-- Unsubscribe (the edge function calls this after checking the token)
-- ---------------------------------------------------------------------------------------------------
select t.as_service();
select t.check('unsubscribe turns reminders off', public.unsubscribe_reminders(t.uid(8)));
select t.check('… and a second time changes nothing', not public.unsubscribe_reminders(t.uid(8)));
select t.as_owner();
select t.check('… the latest reminders consent is false, version reminders-1',
  (select (granted, text_version) = (false, 'reminders-1') from public.consents
    where user_id = t.uid(8) and party = 'reminders' order by changed_at desc limit 1));

-- ---------------------------------------------------------------------------------------------------
-- Grants, RLS, cron
-- ---------------------------------------------------------------------------------------------------
select t.check('reminder_sends: RLS on, no grant to anon or authenticated',
  (select relrowsecurity from pg_class where oid = 'public.reminder_sends'::regclass)
  and not has_table_privilege('authenticated', 'public.reminder_sends', 'select')
  and not has_table_privilege('anon', 'public.reminder_sends', 'select')
  and not has_table_privilege('authenticated', 'public.reminder_sends', 'insert'));
select t.check('get_my_badges and set_reminder_optin: authenticated only',
  has_function_privilege('authenticated', 'public.get_my_badges()', 'execute')
  and has_function_privilege('authenticated', 'public.set_reminder_optin(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_badges()', 'execute')
  and not has_function_privilege('anon', 'public.set_reminder_optin(boolean)', 'execute'));
select t.check('the sending functions: service role only',
  (select bool_and(has_function_privilege('service_role', f, 'execute')
               and not has_function_privilege('authenticated', f, 'execute')
               and not has_function_privilege('anon', f, 'execute'))
     from unnest(array['public.reminder_candidates()', 'public.claim_reminder(uuid, int, boolean)',
                       'public.reminder_failed(uuid, int, text)', 'public.reminders_heartbeat(boolean, text)',
                       'public.unsubscribe_reminders(uuid)']) f));
select t.check('kick_reminders and match_nights: no client can call them',
  not has_function_privilege('authenticated', 'public.kick_reminders()', 'execute')
  and not has_function_privilege('service_role', 'public.kick_reminders()', 'execute')
  and not has_function_privilege('authenticated', 'public.match_nights()', 'execute'));
select t.check('every new security definer function pins search_path = public',
  (select bool_and(proconfig @> array['search_path=public']) from pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef
      and proname in ('get_my_badges', 'set_reminder_optin', 'reminder_candidates', 'claim_reminder',
                      'reminder_failed', 'reminders_heartbeat', 'unsubscribe_reminders', 'kick_reminders')));
select t.check('cron: exactly poll-results, watchdog and the new send-reminders (every 5 minutes)',
  (select array_agg(jobname::text order by jobname) from cron.job) = array['poll-results', 'send-reminders', 'watchdog']
  and (select schedule from cron.job where jobname = 'send-reminders') = '*/5 * * * *'
  and (select command from cron.job where jobname = 'poll-results') = 'select public.kick_poller();'
  and (select command from cron.job where jobname = 'watchdog') = 'select public.watchdog();');

select * from t.report();
rollback;
