-- =====================================================================================================
-- How fans picked (0012): totals per match, only once the match has started, never names; counted once
-- at the first call after the start and kept.
-- Runs inside begin … rollback (bun run test:sql crowd).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(1);
select t.new_user(2);
select t.new_user(3);
select t.new_user(4);
select t.pick(t.uid(1), 1, 'c', '6-4 6-4');
select t.pick(t.uid(2), 1, 'c', '6-4 6-4');
select t.pick(t.uid(3), 1, 'f', '4-6 6-3 3-6');
select t.pick(t.uid(4), 2, 'd', '6-1 6-1');

-- Before the first ball: nothing, for anyone.
select t.as_user(t.uid(1));
select t.check('before QF1 starts a fan gets no totals',
  (select count(*) from public.get_match_crowd(1)) = 0);
select t.as_owner();
select t.check('… and nothing is kept yet', (select count(*) from public.match_crowd) = 0);

select public.dev_set_now((select starts_at + interval '1 minute' from public.matches where match_no = 1));

select t.as_anon();
select t.check('anon cannot call it',
  t.err('select * from public.get_match_crowd(1)') like '%permission denied%');
select t.check('anon cannot read the kept totals',
  t.err('select * from public.match_crowd') like '%permission denied%');

select t.as_user(t.uid(4));
select t.check('after the start: 3 picks, 2 for player 1 (C), 1 for player 2 (F)',
  (select (picks, p1_picks, p2_picks) = (3, 2, 1) from public.get_match_crowd(1)));
select t.check('… the most picked score is C 6-4 6-4, picked twice',
  (select top_score = t.ss('6-4 6-4') and top_count = 2 from public.get_match_crowd(1)));
select t.check('… a fan cannot read the kept table directly',
  t.err('select * from public.match_crowd') like '%permission denied%');
select t.check('… QF2 has not started: still nothing',
  (select count(*) from public.get_match_crowd(2)) = 0);

-- Kept: a pick the database receives later (impossible through save_pick after the lock) changes nothing.
select t.as_owner();
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
values (t.uid(4), 1, 'f', 2, t.ss('4-6 4-6'));
select t.as_user(t.uid(1));
select t.check('the totals are counted once and kept',
  (select picks from public.get_match_crowd(1)) = 3);
select t.as_owner();
select t.check('… one kept row for QF1', (select count(*) from public.match_crowd) = 1);

select * from t.report();
rollback;
