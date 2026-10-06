-- =====================================================================================================
-- A match that really started long before its schedule (e.g. a start time typed in the wrong time zone):
-- the poller's first look is already the final, refused as "final result before the scheduled start"
-- (picks are still open). A fan who picks after that, knowing the result, must not score once the
-- operator has confirmed the early start with lock_match_now (audit 5-6 Oct 2026, F-03 residue;
-- decided by Tino on 6 Oct 2026). Without that confirmation an early final stays bad data (security.sql
-- section 6 feeds a bogus final a day early and expects the honest pick to score).
-- Runs inside begin … rollback (bun run test:sql early_final).
-- =====================================================================================================
begin;

select t.setup_event();                                   -- QF1 C v F scheduled 21 Oct 16:30
select t.new_user(n) from generate_series(1, 2) n;        -- 1 = W (honest), 2 = V (late)

select public.dev_set_now('2026-10-21 12:00+00');
select t.check('W picks QF1 in the morning', t.pick(t.uid(1), 1, 'c', '6-4 6-3') is null);

-- QF1 really started at 13:30; the poll window opens at 15:30 and the first reading is the final
select public.dev_set_now('2026-10-21 15:30+00');
select t.check('the early final is refused (picks are still open)',
  t.feed(1, 'completed', 'c', '6-4 6-3')->>'outcome' = 'rejected_invalid');

-- V picks the winner the page already shows
select public.dev_set_now('2026-10-21 15:35+00');
select t.check('V can still save a pick (the scheduled lock is 16:30)', t.pick(t.uid(2), 1, 'c', '6-4 6-3') is null);

-- the operator confirms the early start, then the next reading settles
select public.dev_set_now('2026-10-21 15:40+00');
select t.as_service();
select public.lock_match_now(1);
select t.as_owner();
select public.dev_set_now('2026-10-21 15:45+00');
select t.check('QF1 settles after the lock', t.feed(1, 'completed', 'c', '6-4 6-3')->>'outcome' = 'settled');

select t.check('the real start is the first reading of the final (15:30)',
  (select started_at from public.matches where match_no = 1) = '2026-10-21 15:30+00',
  (select started_at::text from public.matches where match_no = 1));
select t.check('W, who picked before the match, scores in full', t.pts(t.uid(1), 1) = '8/4/4/16', t.pts(t.uid(1), 1));
select t.check('V, who picked after the result was public, scores nothing', t.pts(t.uid(2), 1) = '0/0/0/0', t.pts(t.uid(2), 1));

select * from t.report();
rollback;
