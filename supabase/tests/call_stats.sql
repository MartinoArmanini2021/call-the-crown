-- =====================================================================================================
-- How rare my call was (0020, 0024): only my own pick, only after the start, nothing below
-- flags.rarity_min_picks (50), and never a count: whole percentages (rounded down) and the two
-- "rare enough to show" answers (winner 40% or fewer, exact score 20% or fewer).
-- Runs inside begin … rollback (bun run test:sql call_stats).
-- =====================================================================================================
begin;

select t.setup_event();

-- 50 fans on QF1: 30 call C 6-4 6-4, 15 call C 6-3 6-3, 5 call F 4-6 4-6.
-- QF2: fans 1-49 pick (one short of the minimum). Fan 51 has no pick at all.
select t.new_user(n) from generate_series(1, 51) n;
select t.pick(t.uid(n), 1, 'c', '6-4 6-4') from generate_series(1, 30) n;
select t.pick(t.uid(n), 1, 'c', '6-3 6-3') from generate_series(31, 45) n;
select t.pick(t.uid(n), 1, 'f', '4-6 4-6') from generate_series(46, 50) n;
select t.pick(t.uid(n), 2, 'd', '6-1 6-1') from generate_series(1, 49) n;

select t.as_user(t.uid(1));
select t.check('before the start: no row', (select count(*) from public.get_my_call_stats(1)) = 0);

select t.as_owner();
select public.dev_set_now((select starts_at + interval '1 minute' from public.matches where match_no = 2));

select t.as_user(t.uid(1));
select t.check('50 picks: a majority call (C 6-4 6-4): winner 90%, exact 60%, neither rare',
  (select (threshold_met, winner_pct, exact_pct, winner_rare, exact_rare) = (true, 90, 60, false, false)
     from public.get_my_call_stats(1)));
select t.as_user(t.uid(46));
select t.check('… a rare call (F 4-6 4-6): winner 10%, exact 10%, both rare',
  (select (winner_pct, exact_pct, winner_rare, exact_rare) = (10, 10, true, true) from public.get_my_call_stats(1)));

select t.as_user(t.uid(51));
select t.check('a caller without a pick: no row', (select count(*) from public.get_my_call_stats(1)) = 0);

select t.as_user(t.uid(1));
select t.check('49 picks: threshold_met = false and everything else null',
  (select threshold_met = false and winner_pct is null and exact_pct is null
          and winner_rare is null and exact_rare is null
     from public.get_my_call_stats(2)));
select t.check('… exactly one row', (select count(*) from public.get_my_call_stats(2)) = 1);

-- The same score written differently (key order, 6.0) is the same score through the canonical form.
select t.as_owner();
update public.picks
   set set_scores = '[{"p2_games": 4, "p1_games": 6.0}, {"p2_games": 4, "p1_games": 6}]'::jsonb
 where user_id = t.uid(2) and match_no = 1;
update public.picks
   set set_scores = '[{"p2_games": 4.0, "p1_games": 6}, {"p1_games": 6, "p2_games": 4}]'::jsonb
 where user_id = t.uid(1) and match_no = 1;
select t.as_user(t.uid(1));
select t.check('the same score in another key order or number form counts as exact (canonical form)',
  (select exact_pct = 60 from public.get_my_call_stats(1)));

-- Sets in another order are another score: canonical_set_scores keeps the order (0004, unchanged).
select t.as_owner();
update public.picks set sets = 3, set_scores = t.ss('6-4 4-6 4-6') where user_id = t.uid(46) and match_no = 1;
update public.picks set sets = 3, set_scores = t.ss('4-6 6-4 4-6') where user_id = t.uid(47) and match_no = 1;
select t.as_user(t.uid(46));
select t.check('… but the same sets in another order are a different exact score (winner 10%, exact 2%)',
  (select (winner_pct, exact_pct) = (10, 2) from public.get_my_call_stats(1)));

-- The boundaries, on exact fractions (picks written directly: only the counting is under test here).
select t.as_owner();
select t.new_user(n) from generate_series(52, 151) n;
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
select t.uid(n), 3, case when n <= 20 then 'a' else 'f' end, 2,
       case when n <= 10 then t.ss('6-4 6-4') else t.ss('6-3 6-3') end
  from generate_series(1, 50) n;                                   -- SF1: A 20/50 = 40%, A 6-4 6-4 10/50 = 20%
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
select t.uid(n), 4, case when n <= 21 then 'b' else 'd' end, 2,
       case when n <= 11 then t.ss('6-4 6-4') else t.ss('6-3 6-3') end
  from generate_series(1, 50) n;                                   -- SF2: B 21/50 = 42%, B 6-4 6-4 11/50 = 22%
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
select t.uid(n), 5, case when n = 1 then 'c' else 'e' end, 2, t.ss('6-4 6-4')
  from generate_series(1, 150) n;                                  -- 3rd place: 1 of 150 = 0.67%
select public.dev_set_now((select starts_at + interval '1 minute' from public.matches where match_no = 5));
select t.as_user(t.uid(1));
select t.check('exactly 40% backed the winner and exactly 20% the exact score: both still rare',
  (select (winner_pct, exact_pct, winner_rare, exact_rare) = (40, 20, true, true) from public.get_my_call_stats(3)));
select t.check('42% and 22%: neither rare (never brag about a near-majority)',
  (select (winner_pct, exact_pct, winner_rare, exact_rare) = (42, 22, false, false) from public.get_my_call_stats(4)));
select t.check('1 of 150 (0.67%): 0, which the card shows as "under 1%", and rare',
  (select (winner_pct, exact_pct, winner_rare) = (0, 0, true) from public.get_my_call_stats(5)));
select t.as_owner();
insert into public.picks (user_id, match_no, winner_id, sets, set_scores) values (t.uid(51), 3, 'f', 2, t.ss('4-6 4-6'));
select t.as_user(t.uid(51));
select t.check('… an exact score 1 of 51 picks called (1.96%) shows 1, not 2; F on 31 of 51 (60.8%) shows 60',
  (select (winner_pct, exact_pct) = (60, 1) from public.get_my_call_stats(3)));
select t.as_user(t.uid(1));
select t.check('… and 20 of 51 (39.2%) shows 39, 10 of 51 (19.6%) shows 19, both rare',
  (select (winner_pct, exact_pct, winner_rare, exact_rare) = (39, 19, true, true) from public.get_my_call_stats(3)));
select t.as_owner();
select t.check('no count column in the output',
  (select pg_get_function_result('public.get_my_call_stats(integer)'::regprocedure))
    = 'TABLE(threshold_met boolean, winner_pct integer, exact_pct integer, winner_rare boolean, exact_rare boolean)');

select t.as_user(null);
select t.check('no signed-in user (no sub in the token): no row',
  (select count(*) from public.get_my_call_stats(1)) = 0);
select t.as_anon();
select t.check('anon cannot call it', t.err('select * from public.get_my_call_stats(1)') like '%permission denied%');

select t.as_owner();
select t.check('it is security definer with search_path = public',
  (select prosecdef and proconfig @> array['search_path=public']
     from pg_proc where oid = 'public.get_my_call_stats(int)'::regprocedure));
select t.check('execute: authenticated only (not public, not anon)',
  has_function_privilege('authenticated', 'public.get_my_call_stats(int)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_call_stats(int)', 'execute'));
select t.check('it writes nothing (stable)',
  (select provolatile = 's' from pg_proc where oid = 'public.get_my_call_stats(int)'::regprocedure));

select * from t.report();
rollback;
