-- =====================================================================================================
-- A final pick that is void because it was saved after the final really started (0018) does not count
-- in the tiebreakers either (audit 5-6 Oct 2026, finding M4). How to play: "If a match starts earlier
-- than scheduled, a pick saved after it really started does not count." README: "With no call on the
-- final, the fan ranks after everyone who has one."
-- Fan 1 (V) picks the final DURING it, knowing the score so far, with the exact total (gap 0); fan 2 (W)
-- picked before anything happened, wrong winner, gap 2. Both score 0 on the final.
-- Runs inside begin … rollback (bun run test:sql void_final_pick).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(n) from generate_series(1, 2) n;

select public.dev_set_now('2026-10-21 20:00+00');
select t.feed(1, 'completed', 'c', '6-4 6-3');
select t.feed(2, 'completed', 'd', '6-4 6-3');
select public.dev_set_now('2026-10-22 20:30+00');
select t.feed(3, 'completed', 'a', '6-4 6-4');
select t.feed(4, 'completed', 'b', '6-3 6-3');

-- W: before the final, wrong winner, 22 games (gap 2 from the real 20)
select public.dev_set_now('2026-10-24 17:00+00');
select t.check('W''s final pick is saved before the start', t.pick(t.uid(2), 6, 'b', '5-7 4-6') is null);

-- the final really starts at 18:00, 40 minutes before its scheduled 18:40
select public.dev_set_now('2026-10-24 18:00+00');
select t.feed(6, 'live', null, '3-2');

-- V picks during the match (picks stay open until the scheduled 18:40): the right winner, 20 games
select public.dev_set_now('2026-10-24 18:10+00');
select t.check('V''s pick during the final is still accepted by the scheduled lock',
  t.pick(t.uid(1), 6, 'a', '6-4 6-4') is null);

select public.dev_set_now('2026-10-24 21:00+00');
select t.feed(6, 'completed', 'a', '6-4 6-4');

select t.check('the final''s real start is the first in-play reading',
  (select started_at from public.matches where match_no = 6) = '2026-10-24 18:00+00');
select t.check('V''s late final pick scores nothing (0018)',
  (select pts_total from public.picks where user_id = t.uid(1) and match_no = 6) = 0);
select t.check('V''s late final pick gives no games gap (tiebreaker 3)',
  (select final_games_gap from public.standings where user_id = t.uid(1)) is null,
  (select final_games_gap::text from public.standings where user_id = t.uid(1)));
select t.check('V''s late final pick gives no pick time (tiebreaker 4)',
  (select final_pick_at from public.standings where user_id = t.uid(1)) is null);
select t.check('W''s pick before the start still counts for the gap',
  (select final_games_gap from public.standings where user_id = t.uid(2)) = 2);
select t.check('at equal points, W (a call on the final) ranks ahead of V (none that counts)',
  (select rank from public.standings where user_id = t.uid(2)) < (select rank from public.standings where user_id = t.uid(1)),
  (select string_agg(right(user_id::text, 2) || '=' || rank || '/' || points || '/' || coalesce(final_games_gap::text, '-'), ' ')
     from public.standings));

select * from t.report();
rollback;
