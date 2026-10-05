-- =====================================================================================================
-- Nights across midnight in Riyadh (0023, full debug F1; Tino signed off 5 Oct 2026): a night runs
-- 06:00 → 05:59 event time, so a match that starts after midnight belongs to the evening it closes.
-- Under 0022 (the Riyadh calendar date) a 21:30 UTC start (00:30 Riyadh) joined the next night, and
-- that night's reminder went out while the first night was still being played.
-- Runs inside begin … rollback (bun run test:sql nights).
-- =====================================================================================================
begin;

select t.setup_event();   -- QF1 21 Oct 16:30 UTC, QF2 17:40, SF 22 Oct, 3P 24 Oct 16:30, F 18:40

select t.check('the real schedule: 1, 1, 2, 2, 3, 3',
  (select array_agg(night_no order by match_no) from public.match_nights()) = array[1, 1, 2, 2, 3, 3]);

-- QF2 moved to 21:30 UTC = 00:30 on 22 Oct in Riyadh: still night 1
select t.as_service();
select public.set_match_start(2, '2026-10-21 21:30+00');
select t.as_owner();
select t.check('QF2 at 00:30 Riyadh (21:30 UTC) stays on night 1: 1, 1, 2, 2, 3, 3',
  (select array_agg(night_no order by match_no) from public.match_nights()) = array[1, 1, 2, 2, 3, 3]);

-- The reminders: at 19:45 UTC on 21 Oct, night 1 is under way (QF1 started). Nothing is due: QF2 is
-- night 1's, and night 2's first match (SF1, 22 Oct 16:30 UTC) is not within 2 hours.
select t.new_user(1);
select t.as_user(t.uid(1));
select public.set_reminder_optin(true);
select t.as_owner();
select public.dev_set_now('2026-10-21 19:45+00');
select t.as_service();
select t.check('while night 1 is being played, no reminder for another night',
  (select count(*) from public.reminder_candidates()) = 0);
select t.as_owner();
select public.dev_set_now('2026-10-20 12:00+00');

-- The cut-off itself: 05:59 Riyadh is the night before, 06:00 a new night
select t.as_service();
select public.set_match_start(2, '2026-10-22 02:59+00');   -- 05:59 Riyadh, 22 Oct
select t.as_owner();
select t.check('05:59 Riyadh still belongs to the night before (night 1)',
  (select night_no from public.match_nights() where match_no = 2) = 1);
select t.as_service();
select public.set_match_start(2, '2026-10-22 03:00+00');   -- 06:00 Riyadh, 22 Oct
select t.as_owner();
select t.check('06:00 Riyadh starts the next night (night 2)',
  (select night_no from public.match_nights() where match_no = 2) = 2);
select t.as_service();
select public.set_match_start(2, '2026-10-21 17:40+00');
select t.as_owner();

-- SF2 and the final after midnight: still 3 nights, the final still night 3
select t.as_service();
select public.set_match_start(4, '2026-10-22 21:30+00');
select public.set_match_start(6, '2026-10-24 21:30+00');
select t.as_owner();
select t.check('SF2 and the final at 00:30 Riyadh: 1, 1, 2, 2, 3, 3 (no night 4)',
  (select array_agg(night_no order by match_no) from public.match_nights()) = array[1, 1, 2, 2, 3, 3]);

select t.check('match_nights keeps its grants (no client can call it)',
  not has_function_privilege('authenticated', 'public.match_nights()', 'execute')
  and not has_function_privilege('anon', 'public.match_nights()', 'execute'));

select * from t.report();
rollback;
