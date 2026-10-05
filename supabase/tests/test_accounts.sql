-- =====================================================================================================
-- Test accounts are left out of rankings, boards, Crews, how fans picked and the share card (0024,
-- Tino 5 Oct 2026). Their own picks and points are kept. Among everyone else nothing changes.
-- Runs inside begin … rollback (bun run test:sql test_accounts).
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(n) from generate_series(1, 55) n;

-- QF1 and QF2 picked by fans 1-6 with different outcomes, so they get different points.
select t.pick(t.uid(1), 1, 'f', '4-6 6-3 4-6');   -- all exact
select t.pick(t.uid(2), 1, 'f', '4-6 4-6');
select t.pick(t.uid(3), 1, 'c', '6-4 6-4');       -- wrong winner
select t.pick(t.uid(4), 1, 'f', '4-6 6-3 6-4');
select t.pick(t.uid(5), 2, 'd', '6-4 6-3');
select t.pick(t.uid(6), 2, 'e', '4-6 4-6');
select public.dev_set_now('2026-10-21 20:00+00');
select t.feed(1, 'completed', 'f', '4-6 6-3 4-6');
select t.feed(2, 'completed', 'd', '6-4 6-3');

create temp table before_ranks on commit drop as
  select user_id, rank, points from public.standings where rank is not null;
select t.check('before: every account is ranked', (select count(*) from before_ranks) = 55);

-- The operator marks fan 2 as a test account.
select t.as_service();
update public.profiles set is_test = true where user_id = t.uid(2);
select t.as_owner();

select t.check('the test account has no rank, its points are kept',
  (select rank is null and points = (select points from before_ranks where user_id = t.uid(2))
     from public.standings where user_id = t.uid(2)));
select t.check('everyone else is re-ranked at once: ranks 1..54, no gap',
  (select array_agg(rank order by rank) = (select array_agg(g) from generate_series(1, 54) g)
     from public.standings where rank is not null));
select t.check('… in exactly the same order as before',
  (select bool_and(a.ord = b.ord) from
     (select user_id, row_number() over (order by rank) ord from public.standings where rank is not null) a
     join (select user_id, row_number() over (order by rank) ord from before_ranks where user_id <> t.uid(2)) b
       using (user_id)));

select t.as_user(t.uid(1));
select t.check('global table: the test account is not on it',
  not exists (select 1 from public.get_leaderboard(null, 0, 100) where user_id = t.uid(2)));
select t.check('… and the table holds 54 fans', (select count(*) from public.get_leaderboard(null, 0, 100)) = 54);
select t.as_user(t.uid(2));
select t.check('the test account sees no rank window of its own',
  (select count(*) from public.get_rank_window(null, 5)) = 0);

-- A league with fans 1, 2 and 3.
select t.as_owner();
insert into public.leagues (id, name, code, owner_id) values
  ('00000000-0000-0000-0000-00000000aa01', 'Testers', 'TST001', t.uid(1));
insert into public.league_members (league_id, user_id)
select '00000000-0000-0000-0000-00000000aa01'::uuid, t.uid(n) from generate_series(1, 3) n;
select t.as_user(t.uid(1));
select t.check('league table: the test account is left out (2 of 3 members shown, positions 1 and 2)',
  (select array_agg(pos order by pos) = array[1, 2]
          and not bool_or(user_id = t.uid(2))
     from public.get_leaderboard('00000000-0000-0000-0000-00000000aa01', 0, 50)));

-- Unmarking puts the account back exactly where it was.
select t.as_service();
update public.profiles set is_test = false where user_id = t.uid(2);
select t.as_owner();
select t.check('unmarked: ranks are exactly as before the test flag',
  not exists (select user_id, rank from before_ranks
              except select user_id, rank from public.standings where rank is not null));
select t.as_service();
update public.profiles set is_test = true where user_id = t.uid(2);
select t.as_owner();

-- How fans picked and the share card: 50 picks on SF1, 5 of them by test accounts → 45 count.
select t.as_service();
update public.profiles set is_test = true where user_id in (select t.uid(n) from generate_series(51, 55) n);
select t.as_owner();
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
select t.uid(n), 3, 'a', 2, t.ss('6-4 6-4') from generate_series(6, 55) n;    -- 50 picks
select public.dev_set_now((select starts_at + interval '1 minute' from public.matches where match_no = 3));
select t.as_user(t.uid(6));
select t.check('how fans picked: 50 picks but 5 by test accounts → below the minimum, no row',
  (select count(*) from public.get_match_crowd(3)) = 0);
select t.check('the share card: below the minimum too (threshold not met)',
  (select threshold_met = false from public.get_my_call_stats(3)));
select t.as_owner();
select t.check('… the snapshot counted 45 picks', (select picks from public.match_crowd where match_no = 3) = 45);

-- Crews: 5 members, one a test account → 4 count → not on the board.
insert into public.leagues (id, name, code, owner_id) values
  ('00000000-0000-0000-0000-00000000aa05', 'Almost Five', 'TST005', t.uid(10));
insert into public.league_members (league_id, user_id)
select '00000000-0000-0000-0000-00000000aa05'::uuid, t.uid(n) from generate_series(10, 13) n
union all select '00000000-0000-0000-0000-00000000aa05', t.uid(55);
insert into public.leagues (id, name, code, owner_id) values
  ('00000000-0000-0000-0000-00000000aa06', 'Real Five', 'TST006', t.uid(20));
insert into public.league_members (league_id, user_id)
select '00000000-0000-0000-0000-00000000aa06'::uuid, t.uid(n) from generate_series(20, 24) n;
select t.as_user(t.uid(10));
select t.check('Crews: 4 fans + 1 test account is not a crew',
  not exists (select 1 from public.get_crew_board(50) where league_id = '00000000-0000-0000-0000-00000000aa05'));
select t.check('… 5 fans is', exists (select 1 from public.get_crew_board(50)
                                       where league_id = '00000000-0000-0000-0000-00000000aa06'));

select t.as_owner();
select t.check('the re-rank trigger: no client can call its function',
  not has_function_privilege('authenticated', 'public.rerank_on_test_flag()', 'execute')
  and not has_function_privilege('service_role', 'public.rerank_on_test_flag()', 'execute'));

select * from t.report();
rollback;
