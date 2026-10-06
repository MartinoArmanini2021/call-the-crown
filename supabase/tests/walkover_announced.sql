-- =====================================================================================================
-- A walkover announced before the start (decision 7a, Tino 6 Oct 2026): the operator closes the picks
-- at once with lock_match_now, as the runbook says. Picks saved before the lock count as usual (winner
-- points only, as for any walkover); after it nobody can pick, so nobody scores off the news.
-- Runs inside begin … rollback (bun run test:sql walkover_announced).
-- =====================================================================================================
begin;

select t.setup_event();                                   -- QF1 C v F scheduled 21 Oct 16:30
select t.new_user(n) from generate_series(1, 2) n;

select public.dev_set_now('2026-10-21 10:00+00');
select t.check('fan 1 picks F in the morning', t.pick(t.uid(1), 1, 'f', '4-6 4-6') is null);

-- 12:00: the page shows C withdrawn (walkover to F) long before the start
select public.dev_set_now('2026-10-21 12:00+00');
select t.check('the early walkover is refused, picks stay open for now',
  t.feed(1, 'walkover', 'f', '')->>'outcome' = 'rejected_invalid');
select t.check('it raises started_before_schedule for the operator',
  exists (select 1 from public.ops_alerts where kind = 'started_before_schedule'
           and (detail->>'match_no')::int = 1));

-- 12:02: the operator locks the match (runbook)
select public.dev_set_now('2026-10-21 12:02+00');
select t.as_service();
select public.lock_match_now(1);
select t.as_owner();

-- 12:30: a fan who read the news tries to pick the walkover winner
select public.dev_set_now('2026-10-21 12:30+00');
select t.check('after the lock nobody can pick the match', t.pick(t.uid(2), 1, 'f', '4-6 4-6') = 'locked');

-- the next reading settles it
select public.dev_set_now('2026-10-21 12:31+00');
select t.check('the walkover settles after the lock', t.feed(1, 'walkover', 'f', '')->>'outcome' = 'settled');
-- F (no. 10) over C (no. 3) in a quarter-final: 8 × (1 + 7 / 37) = 9.51, rounded to 10; no set points
select t.check('the pick saved before the news scores the winner points only (walkover): 10/0/0/10',
  t.pts(t.uid(1), 1) = '10/0/0/10', t.pts(t.uid(1), 1));
select t.check('the fan refused after the lock has no pick',
  not exists (select 1 from public.picks where user_id = t.uid(2) and match_no = 1));

select * from t.report();
rollback;
