-- =====================================================================================================
-- Standings: the maximum score, every tiebreaker in order, and strict ranks.
-- Order: points ↓ · sets called exactly ↓ · |games in the predicted final − games in the real final| ↑
-- (no call last) · time of the last change to the final pick ↑ (no pick last) · the published-seed draw.
-- Runs inside begin … rollback (bun run test:sql standings).
-- =====================================================================================================
begin;

select t.setup_event();

-- The draw seed: pick one that orders both tied pairs (6 v 7, 9 v 10) AGAINST account age, so the
-- test proves the draw decides, not who signed up first. Allowed now: no match has started.
create temp table draw as
  select s as seed from (select 'test-seed-' || g as s from generate_series(1, 200) g) x
   where md5(s || ':' || t.uid(7)::text)  < md5(s || ':' || t.uid(6)::text)
     and md5(s || ':' || t.uid(10)::text) < md5(s || ':' || t.uid(9)::text)
   limit 1;
update public.event_config set tiebreak_seed = (select seed from draw);

-- Results used throughout (no upsets, all two sets, so a perfect card scores the maximum):
--   QF1 C 6-4 6-3 · QF2 D 6-4 6-3 · SF1 A 6-4 6-4 · SF2 B 6-3 6-3 · 3P C 6-4 6-4 (C v D) · F A 6-4 6-4
--   The final therefore has 20 games.

-- Fan 1: a perfect card. Fans 2–9: built to separate only on one tiebreaker each. Fans 10–11: no picks.
--   fan 2  (Q): 20 points, 2 exact sets (two three-set calls, set 1 exact in each)
--   fan 3  (P): 20 points, 0 exact sets
--   fan 4  (S): 0 points, final called with 26 games (gap 6)
--   fan 5  (U): 0 points, final called with 24 games (gap 4), at 22 Oct 21:00
--   fan 6  (V): 0 points, final called with 24 games (gap 4), at 22 Oct 22:00
--   fan 7  (Y): same as V, same moment, created after V; the draw puts Y ahead (last resort)
--   fan 8  (R): 0 points, final called with 20 games but the wrong winner (gap 0) → points still 0
--   fan 9, 10: no picks at all; 9 created first, the draw puts 10 ahead
select t.new_user(n) from generate_series(1, 10) n;

select t.pick(t.uid(1), 1, 'c', '6-4 6-3');
select t.pick(t.uid(1), 2, 'd', '6-4 6-3');
select t.pick(t.uid(2), 1, 'c', '6-4 3-6 6-3');   -- 8 + 0 + 2 = 10, 1 exact
select t.pick(t.uid(2), 2, 'd', '6-4 3-6 6-3');   -- 10, 1 exact
select t.pick(t.uid(3), 1, 'c', '6-2 6-2');       -- 8 + 4 = 12
select t.pick(t.uid(3), 2, 'd', '6-2 3-6 6-2');   -- 8

select public.dev_set_now('2026-10-21 20:00+00');
select t.feed(1, 'completed', 'c', '6-4 6-3');
select t.feed(2, 'completed', 'd', '6-4 6-3');

select t.pick(t.uid(1), 3, 'a', '6-4 6-4');
select t.pick(t.uid(1), 4, 'b', '6-3 6-3');

select public.dev_set_now('2026-10-22 20:30+00');
select t.feed(3, 'completed', 'a', '6-4 6-4');
select t.feed(4, 'completed', 'b', '6-3 6-3');

select t.pick(t.uid(1), 5, 'c', '6-4 6-4');
select t.pick(t.uid(1), 6, 'a', '6-4 6-4');
select t.pick(t.uid(8), 6, 'b', '4-6 4-6');       -- wrong winner, 20 games

select public.dev_set_now('2026-10-22 21:00+00');
select t.pick(t.uid(4), 6, 'b', '6-7 6-7');       -- 26 games, gap 6
select t.pick(t.uid(5), 6, 'b', '5-7 5-7');       -- 24 games, gap 4
select public.dev_set_now('2026-10-22 22:00+00');
select t.pick(t.uid(6), 6, 'b', '5-7 5-7');       -- 24 games, gap 4, later than fan 5
select t.pick(t.uid(7), 6, 'b', '5-7 5-7');       -- identical to fan 6, same moment

select public.dev_set_now('2026-10-24 21:00+00');
select t.feed(5, 'completed', 'c', '6-4 6-4');
select t.feed(6, 'completed', 'a', '6-4 6-4');

select t.check('a perfect card with no upsets and all two-set matches scores the maximum, 128',
  (select points from public.standings where user_id = t.uid(1)) = 128,
  (select points::text from public.standings where user_id = t.uid(1)));
select t.check('the perfect card called all 12 sets exactly',
  (select exact_sets from public.standings where user_id = t.uid(1)) = 12);

select t.check('tiebreaker 2: equal points (20), more sets called exactly ranks higher',
  (select rank from public.standings where user_id = t.uid(2)) < (select rank from public.standings where user_id = t.uid(3)),
  (select string_agg(user_id::text || '=' || points || '/' || exact_sets, ' ') from public.standings where user_id in (t.uid(2), t.uid(3))));
select t.check('tiebreaker 3: closer total games in the final ranks higher (gap 4 over gap 6)',
  (select rank from public.standings where user_id = t.uid(5)) < (select rank from public.standings where user_id = t.uid(4)));
select t.check('tiebreaker 3 is only a tiebreaker: a gap of 0 with the wrong winner does not beat points',
  (select final_games_gap from public.standings where user_id = t.uid(8)) = 0
  and (select rank from public.standings where user_id = t.uid(8)) > (select rank from public.standings where user_id = t.uid(3)));
select t.check('tiebreaker 4: same gap, the earlier final pick ranks higher',
  (select rank from public.standings where user_id = t.uid(5)) < (select rank from public.standings where user_id = t.uid(6)));
select t.check('a draw seed exists that reverses account age for both pairs', exists (select 1 from draw));
select t.check('last resort: identical on everything, the published-seed draw decides (not account age)',
  (select final_pick_at from public.standings where user_id = t.uid(6)) = (select final_pick_at from public.standings where user_id = t.uid(7))
  and (select rank from public.standings where user_id = t.uid(7)) < (select rank from public.standings where user_id = t.uid(6)));
select t.check('no final call ranks after every final call at equal points',
  (select max(rank) from public.standings where user_id in (t.uid(4), t.uid(5), t.uid(6), t.uid(7), t.uid(8)))
  < (select min(rank) from public.standings where user_id in (t.uid(9), t.uid(10))));
select t.check('last resort with no picks at all: the draw decides',
  (select rank from public.standings where user_id = t.uid(10)) < (select rank from public.standings where user_id = t.uid(9)));
select t.check('the draw seed cannot change once play has started',
  t.err($$ update public.event_config set tiebreak_seed = 'another' $$) = 'tiebreak_seed_locked');
select t.check('the draw seed is public (anon can read it)',
  has_column_privilege('anon', 'public.event_config', 'tiebreak_seed', 'SELECT'));

select t.check('the full expected order',
  (select array_agg(right(user_id::text, 2) order by rank) from public.standings)
  = array['01','02','03','08','05','07','06','04','10','09'],
  (select array_to_string(array_agg(right(user_id::text, 2) order by rank), ' ') from public.standings));
select t.check('ranks are strict: 1..n with no repeats',
  (select bool_and(rank = rn) from (select rank, row_number() over (order by rank) as rn from public.standings) x)
  and (select count(distinct rank) = count(*) from public.standings));
select t.check('ranks 1 to 3 are strict', (select count(distinct rank) from public.standings where rank <= 3) = 3);

-- The boards
select t.as_user(t.uid(5));
select t.check('global board page 1 starts at rank 1 and marks me',
  (select array_agg(pos order by pos) = array[1,2,3] from public.get_leaderboard(null, 0, 3))
  and (select count(*) from public.get_leaderboard(null, 0, 100) where is_me) = 1);
select t.check('my rank ± 2 shows 5 rows centred on me',
  (select count(*) = 5 and bool_or(is_me) from public.get_rank_window(null, 2)));
select t.check('a page is capped at 100 rows', (select count(*) <= 100 from public.get_leaderboard(null, 0, 1000)));
select t.as_owner();

select * from t.report();
rollback;
