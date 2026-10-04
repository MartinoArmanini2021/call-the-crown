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

-- A poller run every 2 minutes from p_from to p_to, each reading the same thing; the last outcome.
-- (The real poller reads a match whose result is waiting on every run, once a minute: 0016.)
create function t.read_run(p_match int, p_from timestamptz, p_to timestamptz, p_status text,
                           p_winner text, p_sets text) returns text
language plpgsql
as $$
declare ts timestamptz := p_from; o text;
begin
  while ts <= p_to loop
    perform public.dev_set_now(ts);
    o := t.feed(p_match, p_status, p_winner, p_sets, false, 'wikipedia')->>'outcome';
    ts := ts + interval '2 minutes';
  end loop;
  return o;
end;
$$;

-- QF1: the page shows C winning 6-4 6-4 from 18:00 and keeps showing it.
select public.dev_set_now('2026-10-21 18:00+00');
select t.check('18:00 first reading of a final: awaiting stability, not settled',
  t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select t.check('… the match is still unsettled and the pick unscored',
  (select status from public.matches where match_no = 1) = 'scheduled' and t.pts(t.uid(1), 1) = '');
select t.check('… and it is marked to be read on every run until confirmed (F-09)',
  (select refetch_requested_at is not null from public.matches where match_no = 1));
select t.check('18:02–18:08 same reading: still awaiting',
  t.read_run(1, '2026-10-21 18:02+00', '2026-10-21 18:08+00', 'completed', 'c', '6-4 6-4') = 'awaiting_stability');
select public.dev_set_now('2026-10-21 18:10+00');
select t.check('18:10 same reading, 10 minutes after the first: settled',
  t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'settled');
select t.check('… and the pick is scored', t.pts(t.uid(1), 1) = '8/4/4/16');

-- QF2, F-09: two readings 10 minutes apart are not 10 minutes of watching.
select public.dev_set_now('2026-10-21 18:00+00');
select t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia');
select public.dev_set_now('2026-10-21 18:10+00');
select t.check('F-09 a reading 10 minutes after the last one (nothing seen in between): the clock restarts',
  t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
-- QF2: the reading is interrupted (the bold removed at 18:14), so the clock restarts at 18:16.
select t.read_run(2, '2026-10-21 18:12+00', '2026-10-21 18:12+00', 'completed', 'd', '6-4 6-4');
select public.dev_set_now('2026-10-21 18:14+00');
select t.check('an interrupted reading (no winner shown) is logged as not final',
  t.feed(2, 'live', 'd', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'not_final');
select t.check('18:16–18:24: 24 minutes after the first reading but only 8 since the interruption: awaiting',
  t.read_run(2, '2026-10-21 18:16+00', '2026-10-21 18:24+00', 'completed', 'd', '6-4 6-4') = 'awaiting_stability');
select public.dev_set_now('2026-10-21 18:26+00');
select t.check('18:26: 10 minutes of the restarted run: settled',
  t.feed(2, 'completed', 'd', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'settled');

-- QF1 is vandalised after settlement, then reverted.
select public.dev_set_now('2026-10-21 18:20+00');
select t.check('a vandal edit on a settled match: awaiting stability, nothing changes',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select t.check('… the settled result stands', (select winner_id from public.matches where match_no = 1) = 'c');
select t.check('… and the operator is alerted at once', (select count(*) from public.ops_alerts where kind = 'result_change_pending') = 1);
select public.dev_set_now('2026-10-21 18:22+00');
select t.check('the edit is reverted: unchanged', t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'unchanged');
select public.dev_set_now('2026-10-21 18:30+00');
select t.check('the vandal edit again at 18:30: awaiting (its clock restarted after the revert)',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'awaiting_stability');
select t.check('18:32–18:38 still the edit: awaiting, and no second alert for the same run',
  t.read_run(1, '2026-10-21 18:32+00', '2026-10-21 18:38+00', 'completed', 'f', '4-6 4-6') = 'awaiting_stability'
  and (select count(*) from public.ops_alerts where kind = 'result_change_pending') = 2);
select t.check('… the settled result still stands, the pick still scores',
  (select winner_id from public.matches where match_no = 1) = 'c' and t.pts(t.uid(1), 1) = '8/4/4/16');

-- A change that holds for 10 minutes is a correction.
select public.dev_set_now('2026-10-21 18:40+00');
select t.check('the change held 10 minutes: re-settled as a correction',
  t.feed(1, 'completed', 'f', '4-6 4-6', false, 'wikipedia')->>'outcome' = 'resettled');
select t.check('… the pick is rescored', t.pts(t.uid(1), 1) = '0/0/0/0');

-- F-09, the audit's case: in the slow watch, an edit seen at 18:50 and again at 19:00 never re-settles.
select public.dev_set_now('2026-10-21 18:50+00');
select t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia');
select public.dev_set_now('2026-10-21 19:00+00');
select t.check('F-09 two readings 10 minutes apart do not re-settle a short-lived edit',
  t.feed(1, 'completed', 'c', '6-4 6-4', false, 'wikipedia')->>'outcome' = 'awaiting_stability'
  and (select winner_id from public.matches where match_no = 1) = 'f');

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
