-- =====================================================================================================
-- Security and integrity: the definition-of-done list in the brief, plus the guards that keep a result
-- out of human hands. Runs inside begin … rollback (bun run test:sql security).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(1, 'Fan One', true, false);
select t.new_user(2, 'Fan Two', false, true);
select t.new_user(3, 'Fan Three', true, true);
select t.new_user(4, 'Fan Four', true, true, false);   -- never verified their email

-- ---------------------------------------------------------------------------------------------------
-- 1. anon cannot write anything (and neither can a signed-in fan, directly)
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.direct_writes_refused(p_role text) returns text
language plpgsql
as $$
declare
  r      record;
  v_col  text;
  v_bad  text[] := '{}';
  v_err  text;
  v_stmt text;
begin
  for r in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' order by 2 loop
    -- an ordinary column: an identity column refuses "set x = x" before the permission check
    select attname into v_col from pg_attribute
     where attrelid = r.oid and attnum > 0 and not attisdropped and attidentity = '' order by attnum limit 1;
    foreach v_stmt in array array[
      format('insert into public.%I default values', r.relname),
      format('update public.%I set %I = %I where false', r.relname, v_col, v_col),
      format('delete from public.%I where false', r.relname),
      format('truncate public.%I', r.relname)] loop
      if p_role = 'anon' then perform t.as_anon(); else perform t.as_user(t.uid(1)); end if;
      v_err := t.err(v_stmt);
      perform t.as_owner();
      if v_err is null or v_err not like 'permission denied%' then
        v_bad := v_bad || (split_part(v_stmt, ' ', 1) || ' ' || r.relname || ': ' || coalesce(v_err, 'allowed'));
      end if;
    end loop;
  end loop;
  return nullif(array_to_string(v_bad, '; '), '');
end;
$$;

select t.check('anon: insert, update, delete and truncate refused on every table',
  pg_temp.direct_writes_refused('anon') is null, pg_temp.direct_writes_refused('anon'));
select t.check('signed-in fan: insert, update, delete and truncate refused on every table',
  pg_temp.direct_writes_refused('authenticated') is null, pg_temp.direct_writes_refused('authenticated'));
select t.check('anon can execute no function except the clock',
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')) = array['app_now']);
select t.as_anon();
select t.check('anon cannot save a pick',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]') $$)
  like 'permission denied%');
select t.check('anon sees event data but no picks, profiles or standings',
  (select count(*) from public.matches) = 6
  and t.err('select count(*) from public.picks') like 'permission denied%'
  and t.err('select count(*) from public.profiles') like 'permission denied%'
  and t.err('select count(*) from public.standings') like 'permission denied%');
select t.as_owner();

-- ---------------------------------------------------------------------------------------------------
-- 2. save_pick validation and the lock
-- ---------------------------------------------------------------------------------------------------
select t.as_user(t.uid(1));
select t.check('save_pick rejects a missing set score',
  t.err($$ select public.save_pick(1, 'c', 3, '[{"p1_games":6,"p2_games":4},{"p1_games":3,"p2_games":6}]') $$) = 'set_scores_incomplete');
select t.check('save_pick rejects a set with a missing number',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":6}]') $$) = 'set_scores_incomplete');
select t.check('save_pick rejects no set scores at all',
  t.err($$ select public.save_pick(1, 'c', 2, null) $$) = 'set_scores_required');
select t.check('save_pick rejects an illegal set (7-3)',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":7,"p2_games":3},{"p1_games":6,"p2_games":4}]') $$) = 'illegal_set_score');
select t.check('save_pick rejects a drawn set (6-6)',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":6,"p2_games":6},{"p1_games":6,"p2_games":4}]') $$) = 'illegal_set_score');
select t.check('save_pick rejects a third set after a 2-0',
  t.err($$ select public.save_pick(1, 'c', 3, '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]') $$) = 'third_set_after_two_nil');
select t.check('save_pick rejects a score where the chosen winner loses (2 sets)',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":4,"p2_games":6},{"p1_games":4,"p2_games":6}]') $$) = 'winner_must_win_two_sets');
select t.check('save_pick rejects a score where the chosen winner loses (3 sets)',
  t.err($$ select public.save_pick(1, 'c', 3, '[{"p1_games":6,"p2_games":4},{"p1_games":4,"p2_games":6},{"p1_games":4,"p2_games":6}]') $$) = 'winner_must_win_two_sets');
select t.check('save_pick rejects a split score sent as 2 sets',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":4,"p2_games":6}]') $$) = 'winner_must_win_two_sets');
select t.check('save_pick rejects 4 sets',
  t.err($$ select public.save_pick(1, 'c', 4, '[]') $$) = 'sets_must_be_2_or_3');
select t.check('save_pick rejects a winner who is not in the match',
  t.err($$ select public.save_pick(1, 'a', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]') $$) = 'winner_not_in_match');
select t.check('save_pick refuses a match whose players are not known yet',
  t.err($$ select public.save_pick(3, 'a', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]') $$) = 'players_unknown');
select t.as_owner();

select t.check('a valid pick is saved', t.pick(t.uid(1), 1, 'c', '6-4 6-4') is null);
select public.dev_set_now('2026-10-21 16:30+00');   -- QF1's start, to the second
select t.check('a pick at its lock time is refused (server clock)', t.pick(t.uid(1), 1, 'f', '4-6 4-6') = 'locked');
select t.check('a pick after its lock is refused', t.pick(t.uid(2), 1, 'c', '6-4 6-4') = 'locked');
select t.check('another match still before its lock can be picked', t.pick(t.uid(2), 2, 'd', '6-4 6-4') is null);
select public.dev_set_now('2026-10-20 12:00+00');

-- ---------------------------------------------------------------------------------------------------
-- 3. picks are private until the match starts
-- ---------------------------------------------------------------------------------------------------
select t.as_user(t.uid(2));
select t.check('another fan''s pick is invisible before the match starts',
  (select count(*) from public.picks where user_id = t.uid(1)) = 0);
select t.check('my own pick is visible to me', (select count(*) from public.picks where user_id = t.uid(2)) = 1);
select t.as_owner();
select public.dev_set_now('2026-10-21 16:31+00');
select t.as_user(t.uid(2));
select t.check('another fan''s pick is visible once the match has started',
  (select count(*) from public.picks where user_id = t.uid(1) and match_no = 1) = 1);
select t.as_owner();
select public.dev_set_now('2026-10-20 12:00+00');

-- ---------------------------------------------------------------------------------------------------
-- 4. activity days (the billing record)
-- ---------------------------------------------------------------------------------------------------
-- So far fan 1 has one pick (match 1), made on 20 Oct (15:00 in Riyadh).
select t.check('a new pick writes an activity day',
  (select array_agg(day) from public.activity_days where user_id = t.uid(1)) = array['2026-10-20'::date]);
-- (Each action and its count are separate statements: in one expression Postgres may run the count first.)
select t.check('a second new pick the same day is saved', t.pick(t.uid(1), 2, 'd', '6-4 6-4') is null);
select t.check('… and there is still one row for that day',
  (select count(*) from public.activity_days where user_id = t.uid(1)) = 1);
select public.dev_set_now('2026-10-20 21:30+00');   -- 00:30 on 21 Oct in Riyadh, still 20 Oct in UTC
select t.check('an identical save on a new day is accepted', t.pick(t.uid(1), 2, 'd', '6-4 6-4') is null);
select t.check('… and writes no activity day', (select count(*) from public.activity_days where user_id = t.uid(1)) = 1);
select t.as_user(t.uid(1));
select t.check('an identical save reports changed = false',
  (public.save_pick(2, 'd', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]')->>'changed')::boolean = false);
select t.check('extra keys or number formatting do not count as a change',
  (public.save_pick(2, 'd', 2, '[{"p1_games":6.0,"p2_games":4,"x":1},{"p2_games":4,"p1_games":6}]')->>'changed')::boolean = false);
select t.as_owner();
select t.check('a changed pick is saved', t.pick(t.uid(1), 2, 'd', '6-4 7-5') is null);
select t.check('… and writes an activity day', (select count(*) from public.activity_days where user_id = t.uid(1)) = 2);
select t.check('the activity day is the server''s Riyadh date (21 Oct), not the UTC date (20 Oct)',
  exists (select 1 from public.activity_days where user_id = t.uid(1) and day = '2026-10-21'));
select t.check('save_pick takes no user and no day from the caller',
  (select proargnames from pg_proc where oid = 'public.save_pick(int, text, int, jsonb)'::regprocedure)
  = array['p_match', 'p_winner', 'p_sets', 'p_set_scores']);
select public.dev_set_now('2026-10-20 12:00+00');

-- ---------------------------------------------------------------------------------------------------
-- 5. leagues are owner-guarded and capped
-- ---------------------------------------------------------------------------------------------------
select t.as_user(t.uid(1));
create temp table lg as select public.create_league('Office') as l;
grant select on lg to public;
select t.check('a league gets a 6-character code', (select char_length(l->>'code') = 6 from lg));
select t.as_user(t.uid(2));
select t.check('a fan joins by code (lower case and spaces accepted)',
  (public.join_league(' ' || lower((select l->>'code' from lg)) || ' ')->>'ok')::boolean);
select t.as_user(t.uid(3));
select public.join_league((select l->>'code' from lg));
select t.as_user(t.uid(2));
select t.check('a member cannot remove another member',
  t.err(format('select public.remove_member(%L, %L)', (select l->>'id' from lg), t.uid(3))) = 'not_league_owner');
select t.check('a member cannot delete the league',
  t.err(format('select public.delete_league(%L)', (select l->>'id' from lg))) = 'not_league_owner');
select t.check('a member sees the league and its members',
  (select count(*) from public.league_members where league_id = (select (l->>'id')::uuid from lg)) = 3);
select t.check('a member can leave', t.err(format('select public.leave_league(%L)', (select l->>'id' from lg))) is null);
select t.check('after leaving, the league is no longer visible',
  (select count(*) from public.leagues where id = (select (l->>'id')::uuid from lg)) = 0);
select t.as_user(t.uid(1));
select t.check('the owner cannot leave (deletes instead)',
  t.err(format('select public.leave_league(%L)', (select l->>'id' from lg))) = 'owner_cannot_leave');
select t.check('the owner can remove a member',
  t.err(format('select public.remove_member(%L, %L)', (select l->>'id' from lg), t.uid(3))) is null);
select t.as_owner();
update public.event_config set league_limits = '{"max_leagues_per_user": 10, "max_members": 1}';
select t.as_user(t.uid(2));
select t.check('a full league refuses new members',
  public.join_league((select l->>'code' from lg))->>'error' = 'league_full');
select t.as_owner();
update public.event_config set league_limits = '{"max_leagues_per_user": 2, "max_members": 200}';
select t.as_user(t.uid(1));
select public.create_league('Second');
select t.check('a fan cannot be in more leagues than the limit',
  t.err($$ select public.create_league('Third') $$) = 'too_many_leagues');
select t.as_owner();
update public.event_config set league_limits = '{"max_leagues_per_user": 10, "max_members": 200}';
select t.as_user(t.uid(3));
select public.join_league('ZZZZZ' || n) from generate_series(1, 10) n;
select t.check('wrong codes are throttled (10 per 10 minutes), even before a right one',
  public.join_league((select l->>'code' from lg))->>'error' = 'too_many_attempts');
select t.as_user(t.uid(1));
select t.check('the owner can delete the league', t.err(format('select public.delete_league(%L)', (select l->>'id' from lg))) is null);
select t.as_owner();
select t.check('a deleted league is gone with its members',
  not exists (select 1 from public.league_members where league_id = (select (l->>'id')::uuid from lg)));

-- ---------------------------------------------------------------------------------------------------
-- 6. ingest_result: refuses inconsistent payloads, settles once, re-settles a correction and logs it
-- ---------------------------------------------------------------------------------------------------
select t.pick(t.uid(3), 1, 'c', '6-4 6-4');
select public.dev_set_now('2026-10-21 18:30+00');
select t.check('ingest rejects a payload whose winner loses on the sets',
  t.feed(1, 'completed', 'c', '4-6 4-6')->>'outcome' = 'rejected_invalid');
select t.check('ingest rejects an illegal set (7-3)', t.feed(1, 'completed', 'c', '7-3 6-4')->>'outcome' = 'rejected_invalid');
select t.check('ingest rejects a third set after a 2-0', t.feed(1, 'completed', 'c', '6-4 6-4 6-4')->>'outcome' = 'rejected_invalid');
select t.check('ingest rejects a winner who is not in the match', t.feed(1, 'completed', 'a', '6-4 6-4')->>'outcome' = 'rejected_invalid');
select t.as_service();
select t.check('ingest rejects a match id that is not mapped',
  public.ingest_result('fixture', '{"match_ref": "nope", "status": "completed"}', '{}')->>'outcome' = 'rejected_unmapped');
select t.check('ingest rejects the wrong pair of players',
  public.ingest_result('fixture', '{"match_ref": "fx-m1", "status": "completed", "players": ["fx-a", "fx-b"], "winner": "fx-a",
    "set_scores": [{"p1_games": 6, "p2_games": 4}, {"p1_games": 6, "p2_games": 4}]}', '{}')->>'outcome' = 'rejected_invalid');
select t.check('ingest rejects text where a number belongs',
  public.ingest_result('fixture', '{"match_ref": "fx-m1", "status": "completed", "players": ["fx-c", "fx-f"], "winner": "fx-c",
    "set_scores": [{"p1_games": "6", "p2_games": 4}, {"p1_games": 6, "p2_games": 4}]}', '{}')->>'outcome' = 'rejected_invalid');
select t.check('a live (not final) payload is logged but not settled',
  public.ingest_result('fixture', '{"match_ref": "fx-m1", "status": "live", "players": ["fx-c", "fx-f"],
    "set_scores": [{"p1_games": 6, "p2_games": 4}]}', '{}')->>'outcome' = 'not_final');
select t.as_owner();
select t.check('after all of that the match is still unsettled',
  (select m.status = 'scheduled' and m.winner_id is null and p.pts_total is null
     from public.matches m join public.picks p on p.match_no = m.match_no and p.user_id = t.uid(3) where m.match_no = 1));
select t.check('every rejected payload is in result_log with its raw copy and hash',
  (select count(*) from public.result_log where outcome like 'rejected%' and raw is not null and raw_sha256 ~ '^[0-9a-f]{64}$') = 7);
select t.check('every rejection queued an ops alert', (select count(*) from public.ops_alerts where kind = 'result_rejected') = 7);

select t.check('a valid final payload settles', t.feed(1, 'completed', 'c', '6-4 6-4')->>'outcome' = 'settled');
select t.check('the provider listing the players the other way round is understood',
  t.feed(1, 'completed', 'c', '6-4 6-4', true)->>'outcome' = 'unchanged');
select t.check('the same result again changes nothing', t.feed(1, 'completed', 'c', '6-4 6-4')->>'outcome' = 'unchanged');
select t.check('after settling: fan 3 scored 16, the SF has player C',
  t.pts(t.uid(3), 1) = '8/4/4/16' and (select p2_id from public.matches where match_no = 3) = 'c');

-- An SF pick on C, then the provider corrects QF1 to F (before the SF starts)
select t.pick(t.uid(3), 3, 'c', '4-6 4-6');
select t.pick(t.uid(2), 3, 'a', '6-4 6-4');
select t.check('a corrected result re-settles', t.feed(1, 'completed', 'f', '4-6 4-6')->>'outcome' = 'resettled');
select t.check('re-settling rescored the old pick from scratch (fan 3 now 0)', t.pts(t.uid(3), 1) = '0/0/0/0');
select t.check('the change is logged with before and after',
  (select diff->'before'->>'winner' = 'c' and diff->'after'->>'winner' = 'f'
     from public.result_log where outcome = 'resettled'));
select t.check('a changed result raised an alert', exists (select 1 from public.ops_alerts where kind = 'result_changed'));
select t.check('the SF slot was refilled, the pick naming the removed player dropped, the other kept',
  (select p2_id from public.matches where match_no = 3) = 'f'
  and not exists (select 1 from public.picks where user_id = t.uid(3) and match_no = 3)
  and exists (select 1 from public.picks where user_id = t.uid(2) and match_no = 3)
  and exists (select 1 from public.ops_alerts where kind = 'bracket_refilled'));
select t.check('re-settled standings match the stored breakdowns',
  (select points from public.standings where user_id = t.uid(3)) = 0);
select t.check('settlement stamped the result revision on every pick',
  not exists (select 1 from public.picks p join public.matches m using (match_no)
               where m.match_no = 1 and p.scored_rev is distinct from m.result_rev));

-- Pause and refetch
select t.as_service();
select public.pause_settlement(2, true);
select public.request_refetch(2);
select t.as_owner();
select t.check('a refetch request is recorded', (select refetch_requested_at is not null from public.matches where match_no = 2));
select t.check('a payload for a paused match is logged as paused', t.feed(2, 'completed', 'd', '6-4 6-4')->>'outcome' = 'paused');
select t.check('… and the match is not settled', (select status from public.matches where match_no = 2) = 'scheduled');
select t.check('the payload that arrived while paused clears the refetch request',
  (select refetch_requested_at is null from public.matches where match_no = 2));
select t.as_service();
select public.pause_settlement(2, false);
select t.as_owner();
select t.check('after resuming, the same payload settles', t.feed(2, 'completed', 'd', '6-4 6-4')->>'outcome' = 'settled');

-- ---------------------------------------------------------------------------------------------------
-- 7. no path for a person to enter or edit a result
-- ---------------------------------------------------------------------------------------------------
-- Every function a fan or the operator can call, whose INPUT arguments could carry a score. The only
-- two allowed: save_pick (a fan's prediction) and ingest_result (the provider's payload, service role).
create temp view score_inputs as
  select distinct p.proname::text as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral unnest(coalesce(p.proargnames, '{}'), coalesce(p.proargmodes::text[], '{}')) a(name, mode)
   where n.nspname = 'public'
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'))
     and coalesce(a.mode, 'i') in ('i', 'b', 'v')
     and (a.name ~* '(score|winner|result|status|games|normalised|point|sets)' or p.proargtypes::oid[] && array['jsonb'::regtype::oid]);
select t.check('no function a fan or the operator can call takes a result, except ingest_result (operator side)',
  (select array_agg(fn order by fn) from score_inputs) = array['ingest_result', 'save_pick', 'set_players'],
  (select array_to_string(array_agg(fn order by fn), ',') from score_inputs));
select t.check('set_players (the only other jsonb input) takes names, seeds, ranks and the bracket, no result',
  (select prosrc not ilike '%winner_id =%' and prosrc not ilike '%set_scores%' and prosrc not ilike '%settle%'
     from pg_proc where oid = 'public.set_players(jsonb, jsonb)'::regprocedure));
select t.check('save_pick writes predictions only: it never touches a match',
  (select prosrc not ilike '%update public.matches%' and prosrc not ilike '%settle_match%'
     from pg_proc where oid = 'public.save_pick(int, text, int, jsonb)'::regprocedure));
select t.check('ingest_result is not callable by a fan or anon',
  not has_function_privilege('authenticated', 'public.ingest_result(text, jsonb, jsonb, int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ingest_result(text, jsonb, jsonb, int)', 'EXECUTE'));
select t.check('settle_match is callable by nobody but its owner',
  not has_function_privilege('service_role', 'public.settle_match(int, text, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.settle_match(int, text, text, jsonb)', 'EXECUTE'));
select t.as_service();
select t.check('the operator (service role) cannot update a match directly',
  t.err($$ update public.matches set winner_id = 'e' where match_no = 2 $$) like 'permission denied%');
select t.check('the operator cannot update a pick''s points directly',
  t.err($$ update public.picks set pts_total = 99 $$) like 'permission denied%');
select t.check('the operator cannot write to result_log directly',
  t.err($$ insert into public.result_log (provider, outcome) values ('x', 'settled') $$) like 'permission denied%');
select t.as_owner();
select t.check('even the database owner cannot change a result outside settlement',
  t.err($$ update public.matches set winner_id = 'e', set_scores = '[]' where match_no = 2 $$) = 'result_columns_are_settlement_only');
select t.check('even the database owner cannot settle an unplayed match by hand',
  t.err($$ update public.matches set status = 'walkover', winner_id = 'a' where match_no = 3 $$) = 'result_columns_are_settlement_only');
select t.check('even the database owner cannot edit a pick''s points',
  t.err($$ update public.picks set pts_total = 99 where match_no = 1 $$) = 'scores_are_settlement_only');
select t.check('even the database owner cannot edit the standings',
  t.err($$ update public.standings set points = 999 $$) = 'scores_are_settlement_only');
select t.check('result_log cannot be edited or deleted',
  t.err($$ update public.result_log set outcome = 'x' $$) = 'result_log_is_append_only'
  and t.err($$ delete from public.result_log $$) = 'result_log_is_append_only'
  and t.err($$ truncate public.result_log $$) = 'result_log_is_append_only');

-- ---------------------------------------------------------------------------------------------------
-- 8. operator schedule rules
-- ---------------------------------------------------------------------------------------------------
select t.as_service();
select t.check('a start time cannot be moved once the match has started',
  t.err($$ select public.set_match_start(1, '2026-10-30 12:00+00') $$) = 'match_started');
select t.check('a start time cannot be set in the past',
  t.err($$ select public.set_match_start(6, '2026-10-01 12:00+00') $$) = 'start_must_be_future');
select t.check('a start time can be moved before the match starts',
  t.err($$ select public.set_match_start(6, '2026-10-24 19:00+00') $$) is null);
select t.check('players cannot be changed once the event has started',
  t.err($$ select public.set_players('[{"id":"a","name":"X","rank":1}]') $$) = 'event_started');
select t.as_owner();

-- ---------------------------------------------------------------------------------------------------
-- 9. billing_report and export_optins: service role only, and right
-- ---------------------------------------------------------------------------------------------------
select t.as_user(t.uid(1));
select t.check('billing_report is refused to a signed-in fan', t.err('select public.billing_report()') like 'permission denied%');
select t.check('export_optins is refused to a signed-in fan', t.err($$ select * from public.export_optins('organiser') $$) like 'permission denied%');
select t.as_anon();
select t.check('billing_report is refused to anon', t.err('select public.billing_report()') like 'permission denied%');
select t.check('export_optins is refused to anon', t.err($$ select * from public.export_optins('gsgm') $$) like 'permission denied%');
select t.as_owner();

-- Pick days so far, from save_pick itself (Riyadh dates):
--   fan 1: 20 Oct and 21 Oct → qualified
--   fan 2: 21 Oct, plus 22 Oct added below → two days, but flagged staff → excluded
--   fan 3: 20 Oct and 21 Oct (its SF pick was later dropped; making it still counted) → qualified
--   fan 4: 21 and 22 Oct added below, but never verified their email → not qualified
insert into public.activity_days values (t.uid(2), '2026-10-22'), (t.uid(4), '2026-10-21'), (t.uid(4), '2026-10-22')
on conflict do nothing;
select t.as_service();
update public.profiles set is_staff = true where user_id = t.uid(2);
create temp table br as select public.billing_report() as r;
select t.as_owner();
select t.check('billing: registered excludes staff (3), verified 2, qualified 2',
  (select (r->>'registered')::int = 3 and (r->>'verified')::int = 2 and (r->>'qualified')::int = 2 from br),
  (select r::text from br));
update public.event_config set billing_close_at = '2026-10-20 23:59:59+03';
select t.check('billing: days after the close do not count (close moved to 20 Oct → nobody qualifies)',
  (public.billing_report()->>'qualified')::int = 0);
update public.event_config set billing_close_at = '2026-10-24 23:59:59+03';
select t.as_service();
select t.check('a billing snapshot is taken', (public.snapshot_billing()->>'qualified')::int = 2);
select t.check('… and stored with a hash of its content',
  (select sha256 = encode(sha256(convert_to(report::text, 'UTF8')), 'hex')
     from public.billing_snapshots order by id desc limit 1));
select t.check('export_optins(organiser) lists the verified fans who said yes to the organiser',
  (select array_agg(email order by email) from public.export_optins('organiser'))
  = array['fan1@example.test', 'fan3@example.test']);
select t.check('export_optins(gsgm) lists the verified fans who said yes to Grand Slam GM',
  (select array_agg(email order by email) from public.export_optins('gsgm'))
  = array['fan2@example.test', 'fan3@example.test']);
select t.as_user(t.uid(1));
select public.update_consents(false, true, 'test-2');
select t.as_service();
select t.check('a withdrawn consent leaves the list; a new one joins it, with the new text version',
  not exists (select 1 from public.export_optins('organiser') where email = 'fan1@example.test')
  and exists (select 1 from public.export_optins('gsgm') where email = 'fan1@example.test' and text_version = 'test-2'));
select t.as_owner();
select t.check('consent history is kept (fan 1: 4 rows)', (select count(*) from public.consents where user_id = t.uid(1)) = 4);

-- ---------------------------------------------------------------------------------------------------
-- 10. account deletion
-- ---------------------------------------------------------------------------------------------------
select t.as_user(t.uid(3));
create temp table lg2 as select public.create_league('Kept') as l;
grant select on lg2 to public;
select t.as_user(t.uid(1));
select public.join_league((select l->>'code' from lg2));
select t.as_user(t.uid(3));
select t.check('a fan can delete their own account', t.err('select public.delete_account()') is null);
select t.as_owner();
select t.check('deletion removes the account and everything personal',
  not exists (select 1 from auth.users where id = t.uid(3))
  and not exists (select 1 from public.profiles where user_id = t.uid(3))
  and not exists (select 1 from public.picks where user_id = t.uid(3))
  and not exists (select 1 from public.consents where user_id = t.uid(3))
  and not exists (select 1 from public.activity_days where user_id = t.uid(3))
  and not exists (select 1 from public.standings where user_id = t.uid(3)));
select t.check('a league the deleted fan owned passes to its longest-standing member',
  (select owner_id from public.leagues where id = (select (l->>'id')::uuid from lg2)) = t.uid(1));

select * from t.report();
rollback;
