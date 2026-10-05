-- =====================================================================================================
-- How fans picked (0012, 0019): shares only, never counts; nothing below flags.rarity_min_picks (50);
-- only once the match has started; never names; counted once at the first call after the start and kept.
-- Runs inside begin … rollback (bun run test:sql crowd).
-- =====================================================================================================
begin;

select t.setup_event();
select t.check('the minimum is configured: 50 picks', (select (flags->>'rarity_min_picks')::int from public.event_config) = 50);
select t.check('no prizes are configured', (select prizes = '[]'::jsonb from public.event_config));

-- 50 fans. QF1: 30 call C 6-4 6-4, 15 call C 6-3 6-3, 5 call F 4-6 4-6 (50 picks).
-- QF2: fans 1-49 pick (49 picks: one short of the minimum).
select t.new_user(n) from generate_series(1, 50) n;
select t.pick(t.uid(n), 1, 'c', '6-4 6-4') from generate_series(1, 30) n;
select t.pick(t.uid(n), 1, 'c', '6-3 6-3') from generate_series(31, 45) n;
select t.pick(t.uid(n), 1, 'f', '4-6 4-6') from generate_series(46, 50) n;
select t.pick(t.uid(n), 2, 'd', '6-1 6-1') from generate_series(1, 49) n;

-- Before the first ball: nothing, for anyone.
select t.as_user(t.uid(1));
select t.check('before QF1 starts a fan gets nothing', (select count(*) from public.get_match_crowd(1)) = 0);
select t.as_owner();
select t.check('… and nothing is kept yet', (select count(*) from public.match_crowd) = 0);

select public.dev_set_now((select starts_at + interval '1 minute' from public.matches where match_no = 2));

select t.as_anon();
select t.check('anon cannot call it', t.err('select * from public.get_match_crowd(1)') like '%permission denied%');
select t.check('anon cannot read the kept totals', t.err('select * from public.match_crowd') like '%permission denied%');

select t.as_user(t.uid(1));
select t.check('50 picks: shares, one decimal (C 90.0%, F 10.0%)',
  (select (p1_share, p2_share) = (90.0, 10.0) from public.get_match_crowd(1)));
select t.check('… the most picked score is C 6-4 6-4, 60.0% of picks',
  (select top_score = t.ss('6-4 6-4') and top_share = 60.0 from public.get_match_crowd(1)));
select t.check('49 picks: no row at all',
  (select count(*) from public.get_match_crowd(2)) = 0);
select t.check('the output has shares only: no count column reaches the client',
  (select pg_get_function_result('public.get_match_crowd(int)'::regprocedure))
    = 'TABLE(p1_share numeric, p2_share numeric, top_score jsonb, top_share numeric)');
select t.check('… a fan cannot read the kept table directly', t.err('select * from public.match_crowd') like '%permission denied%');

-- Kept: a pick the database receives later (impossible through save_pick after the lock) changes nothing.
select t.as_owner();
select t.new_user(51);
insert into public.picks (user_id, match_no, winner_id, sets, set_scores) values (t.uid(51), 1, 'f', 2, t.ss('4-6 4-6'));
select t.as_user(t.uid(1));
select t.check('the shares are counted once and kept', (select p1_share from public.get_match_crowd(1)) = 90.0);
select t.as_owner();
select t.check('… one kept row for QF1 (and QF2, counted below the minimum, kept but not shown)',
  (select count(*) from public.match_crowd) = 2);

select * from t.report();
rollback;
