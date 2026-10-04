-- =====================================================================================================
-- The results feed: audit fixes F-03, F-05, F-06, F-07 and F-08 (migration 0016). F-09 is in
-- stability.sql. Runs inside begin … rollback (bun run test:sql feed).
-- =====================================================================================================
begin;

select t.setup_event();   -- QF1 C v F starts 21 Oct 16:30 UTC, QF2 D v E 17:40, SF1 A v winner QF1 22 Oct 16:30
select t.new_user(1);
select t.pick(t.uid(1), 1, 'c', '6-4 6-4');

-- F-05: a payload no longer writes the poller's health (the poller writes it once per run).
delete from public.ops_health;
-- F-03: the provider shows QF1 under way ten minutes before our scheduled start.
select public.dev_set_now('2026-10-21 16:20+00');
select t.check('a live reading before the scheduled start is logged as not final',
  t.feed(1, 'live', 'c', '')->>'outcome' = 'not_final');
select t.check('F-05 ingest_result leaves the poller''s health alone',
  not exists (select 1 from public.ops_health where key = 'poll-results'));
select t.check('F-03 the operator is alerted at once that the match is under way before its start',
  (select count(*) from public.ops_alerts
    where kind = 'started_before_schedule' and (detail->>'match_no')::int = 1) = 1);
select public.dev_set_now('2026-10-21 16:21+00');
select t.feed(1, 'live', 'c', '');
select t.check('… once, not on every poll',
  (select count(*) from public.ops_alerts where kind = 'started_before_schedule') = 1);
select t.as_user(t.uid(1));
select t.check('… picks are still open until the operator acts',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":6,"p2_games":3},{"p1_games":6,"p2_games":3}]') $$) is null);
select t.check('lock_match_now is not callable by a fan',
  t.err('select public.lock_match_now(1)') like '%permission denied%');
select t.as_service();
select public.lock_match_now(1);
select t.as_owner();
select t.check('F-03 lock_match_now makes the start this moment',
  (select starts_at = public.app_now() from public.matches where match_no = 1));
select t.as_user(t.uid(1));
select t.check('… and picks for that match are refused from then on',
  t.err($$ select public.save_pick(1, 'f', 2, '[{"p1_games":3,"p2_games":6},{"p1_games":3,"p2_games":6}]') $$) like '%locked%');
select t.as_service();
select t.check('… a second lock of a started match is refused',
  t.err('select public.lock_match_now(1)') like '%match_started%');
select t.as_owner();

-- F-06: a walkover announced before the start is alerted the same way.
select public.dev_set_now('2026-10-21 17:00+00');
select t.feed(2, 'walkover', 'd', '');
select t.check('F-06 a walkover reported before the start alerts the operator',
  exists (select 1 from public.ops_alerts
           where kind = 'started_before_schedule' and (detail->>'match_no')::int = 2));

-- F-07: retirement and walkover payloads are checked.
select public.dev_set_now('2026-10-21 20:00+00');
select t.check('F-07 a walkover that carries set scores is refused',
  t.feed(2, 'walkover', 'd', '6-4 6-4')->>'reason' = 'a walkover carries no set scores');
select t.check('F-07 a retirement with an impossible first set (7-3) is refused',
  t.feed(2, 'retired', 'd', '7-3 2-1')->>'outcome' = 'rejected_invalid');
select t.check('F-07 a retirement with an unfinished set before the last (6-6 6-4) is refused',
  t.feed(2, 'retired', 'd', '6-6 6-4')->>'reason' = 'only the last set of a retirement can be unfinished');
select t.check('F-07 a retirement with four sets is refused',
  t.feed(2, 'retired', 'd', '6-4 6-4 6-4 6-4')->>'reason' = 'a retirement has at most 3 sets');
select t.check('F-07 a retirement with an impossible unfinished set (99-0) is refused',
  t.feed(2, 'retired', 'd', '99-0')->>'outcome' = 'rejected_invalid');
select t.check('F-07 a "retirement" after the retiring player had already won is refused',
  t.feed(2, 'retired', 'd', '4-6 4-6 1-0')->>'reason' = 'the retiring player had already won the match');
select t.check('F-07 a "retirement" after the winner had already won is refused (it was completed)',
  t.feed(2, 'retired', 'd', '6-4 6-4')->>'reason' = 'the winner had already won the match: not a retirement');
select t.check('a plausible retirement (6-4 2-1) settles',
  t.feed(2, 'retired', 'd', '6-4 2-1')->>'outcome' = 'settled');

-- F-08: a correction after the next match started pauses it; the operator re-seats it.
select t.check('QF1 settles: C wins', t.feed(1, 'completed', 'c', '6-4 6-4')->>'outcome' = 'settled');
select public.dev_set_now('2026-10-22 17:00+00');   -- SF1 (A v C) is under way
select t.check('a correction (F won QF1) after SF1 started is re-settled',
  t.feed(1, 'completed', 'f', '4-6 4-6')->>'outcome' = 'resettled');
select t.check('… and SF1 is paused with its old players',
  (select settlement_paused and p2_id = 'c' from public.matches where match_no = 3));
select t.as_user(t.uid(1));
select t.check('reseat_paused_match is not callable by a fan',
  t.err('select public.reseat_paused_match(3)') like '%permission denied%');
select t.as_service();
select t.check('a match that is not paused cannot be re-seated',
  t.err('select public.reseat_paused_match(4)') like '%not_paused%');
select public.reseat_paused_match(3);
select t.as_owner();
select t.check('F-08 re-seating takes the players from the corrected bracket and resumes settlement',
  (select p1_id = 'a' and p2_id = 'f' and not settlement_paused from public.matches where match_no = 3));
select t.check('… with their potential winner points stored',
  (select p1_win_points is not null and p2_win_points is not null from public.matches where match_no = 3));
select public.dev_set_now('2026-10-22 19:00+00');
select t.check('… and the provider''s result for A v F now settles SF1',
  t.feed(3, 'completed', 'a', '6-4 6-4')->>'outcome' = 'settled');

select * from t.report();
rollback;
