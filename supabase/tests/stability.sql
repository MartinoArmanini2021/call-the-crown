-- =====================================================================================================
-- Stability: a crowd-edited source (provider "wikipedia", 10 minutes in event_config.results_policy)
-- settles a result only after it has read the same, without interruption, for 10 minutes. A vandal edit
-- that is reverted never settles; a change that holds is a correction and re-settles.
-- Runs inside begin … rollback (bun run test:sql stability).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(1);
select t.pick(t.uid(1), 1, 'c', '6-4 6-4');

-- Wikipedia uses the same ids as the fixture provider in this test.
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'wikipedia', kind, provider_ref, our_ref from public.provider_map where provider = 'fixture';

select t.check('the policy: wikipedia waits 10 minutes, other providers do not',
  (select results_policy->'stable_minutes'->>'wikipedia' from public.event_config) = '10'
  and (select results_policy->'stable_minutes'->'fixture' from public.event_config) is null);

-- QF1: the page shows C winning 6-4 6-4 from 18:00 and keeps showing it.
select public.dev_set_now('2026-10-21 18:00+00');
select t.check('18:00 first reading of a final: awaiting stability, not settled',
  t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select t.check('… the match is still unsettled and the pick unscored',
  (select status from public.matches where match_no = 1) = 'scheduled' and t.pts(t.uid(1), 1) = '');
select public.dev_set_now('2026-10-21 18:05+00');
select t.check('18:05 same reading: still awaiting',
  t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select public.dev_set_now('2026-10-21 18:10+00');
select t.check('18:10 same reading, 10 minutes after the first: settled',
  t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'settled');
select t.check('… and the pick is scored', t.pts(t.uid(1), 1) = '8/4/4/16');

-- QF2: the reading is interrupted (the bold removed at 18:04), so the clock restarts at 18:08.
select public.dev_set_now('2026-10-21 18:00+00');
select t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia');
select public.dev_set_now('2026-10-21 18:04+00');
select t.check('an interrupted reading (no winner shown) is logged as not final',
  t.feed(2, 'live', 'd', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'not_final');
select public.dev_set_now('2026-10-21 18:08+00');
select t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia');
select public.dev_set_now('2026-10-21 18:15+00');
select t.check('18:15: 15 minutes after the first reading but only 7 since the interruption: awaiting',
  t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select public.dev_set_now('2026-10-21 18:18+00');
select t.check('18:18: 10 minutes of the restarted run: settled',
  t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'settled');

-- QF1 is vandalised after settlement, then reverted.
select public.dev_set_now('2026-10-21 18:20+00');
select t.check('a vandal edit on a settled match: awaiting stability, nothing changes',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select t.check('… the settled result stands', (select winner_id from public.matches where match_no = 1) = 'c');
select t.check('… and the operator is alerted at once', (select count(*) from public.ops_alerts where kind = 'result_change_pending') = 1);
select public.dev_set_now('2026-10-21 18:23+00');
select t.check('the edit is reverted: unchanged', t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'unchanged');
select public.dev_set_now('2026-10-21 18:30+00');
select t.check('the vandal edit again at 18:30: awaiting (its clock restarted after the revert)',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select public.dev_set_now('2026-10-21 18:35+00');
select t.check('18:35 still the edit: awaiting, and no second alert for the same run',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'awaiting_stability'
  and (select count(*) from public.ops_alerts where kind = 'result_change_pending') = 2);
select t.check('… the settled result still stands, the pick still scores',
  (select winner_id from public.matches where match_no = 1) = 'c' and t.pts(t.uid(1), 1) = '8/4/4/16');

-- A change that holds for 10 minutes is a correction.
select public.dev_set_now('2026-10-21 18:40+00');
select t.check('the change held 10 minutes: re-settled as a correction',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'resettled');
select t.check('… the pick is rescored', t.pts(t.uid(1), 1) = '0/0/0/0');

-- The same rejection alerts once an hour, not on every poll.
select public.dev_set_now('2026-10-22 17:00+00');
select t.feed(4, 'completed', 'b', '7-3 6-4', false, 'wikipedia');
select public.dev_set_now('2026-10-22 17:01+00');
select t.feed(4, 'completed', 'b', '7-3 6-4', false, 'wikipedia');
select t.check('a repeated rejection is logged each time but alerted once',
  (select count(*) from public.result_log where match_no = 4 and outcome = 'rejected_invalid') = 2
  and (select count(*) from public.ops_alerts where kind = 'result_rejected' and detail->>'match_ref' = 'fx-m4') = 1);

select t.check('every valid final reading is logged with its canonical result (the audit trail)',
  not exists (select 1 from public.result_log
               where outcome in ('awaiting_stability', 'settled', 'resettled', 'unchanged') and canonical is null));

select * from t.report();
rollback;
