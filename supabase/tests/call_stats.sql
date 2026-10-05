-- =====================================================================================================
-- How rare my call was (0020, brief "bragging rights", Phase 3): only my own pick, only after the
-- start, and no count at all below flags.rarity_min_picks (50).
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
select t.check('50 picks: counts for my call (50 total, 45 same winner, 30 same exact)',
  (select (threshold_met, picks_total, same_winner, same_exact) = (true, 50, 45, 30)
     from public.get_my_call_stats(1)));
select t.as_user(t.uid(46));
select t.check('… a rare call (F 4-6 4-6): 5 same winner, 5 same exact',
  (select (same_winner, same_exact) = (5, 5) from public.get_my_call_stats(1)));

select t.as_user(t.uid(51));
select t.check('a caller without a pick: no row', (select count(*) from public.get_my_call_stats(1)) = 0);

select t.as_user(t.uid(1));
select t.check('49 picks: threshold_met = false and every count null',
  (select threshold_met = false and picks_total is null and same_winner is null and same_exact is null
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
  (select same_exact = 30 from public.get_my_call_stats(1)));

-- Sets in another order are another score: canonical_set_scores keeps the order (0004, unchanged).
select t.as_owner();
update public.picks set sets = 3, set_scores = t.ss('6-4 4-6 4-6') where user_id = t.uid(46) and match_no = 1;
update public.picks set sets = 3, set_scores = t.ss('4-6 6-4 4-6') where user_id = t.uid(47) and match_no = 1;
select t.as_user(t.uid(46));
select t.check('… but the same sets in another order are a different exact score (5 same winner, 1 same exact)',
  (select (same_winner, same_exact) = (5, 1) from public.get_my_call_stats(1)));

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
