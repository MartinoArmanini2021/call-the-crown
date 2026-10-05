-- =====================================================================================================
-- Part 1 B2 (full debug brief): SQL checks for mutants of the bragging-rights migrations that left the
-- build's own suite green. Every check passes on feat/bragging-rights 84dfadd and at least one fails on
-- each mutant named in its comment. Same style and helpers as supabase/tests/*.sql (_prelude.sql).
-- (The night-boundary check, match_nights by event timezone vs UTC, waits on the F1 decision.)
-- Invented fans only (fanN@example.test).
-- =====================================================================================================
begin;

select t.setup_event();   -- QF1 21 Oct 16:30 UTC, QF2 17:40, SF 22 Oct, 3P 24 Oct 16:30, F 18:40

-- ---------------------------------------------------------------------------------------------------
-- 50 fans on QF1 (as call_stats.sql): 30 call C 6-4 6-4, 15 call C 6-3 6-3, 5 call F 4-6 4-6.
-- Fan 61 ("K") picks QF1 and QF2 early. Fan 62 ("L") picks QF2 early and QF1 after the real start.
-- ---------------------------------------------------------------------------------------------------
select t.new_user(n) from generate_series(1, 50) n;
select t.new_user(61);
select t.new_user(62);
select t.pick(t.uid(n), 1, 'c', '6-4 6-4') from generate_series(1, 30) n;
select t.pick(t.uid(n), 1, 'c', '6-3 6-3') from generate_series(31, 45) n;
select t.pick(t.uid(n), 1, 'f', '4-6 4-6') from generate_series(46, 50) n;
select t.pick(t.uid(61), 1, 'c', '7-5 6-0');
select t.pick(t.uid(61), 2, 'd', '6-4 6-4');
select t.pick(t.uid(62), 2, 'd', '6-4 6-4');

-- QF1 is under way from 16:20 (provider), ten minutes before its scheduled start; L picks C at 16:21.
select public.dev_set_now('2026-10-21 16:20+00');
select t.feed(1, 'live', 'c', '');
select public.dev_set_now('2026-10-21 16:21+00');
select t.check('M-setup: L''s late pick is accepted (picks open until the scheduled start)',
  t.pick(t.uid(62), 1, 'c', '7-5 6-1') is null);

-- ---------------------------------------------------------------------------------------------------
-- Mutant: get_my_call_stats compares raw jsonb (k.set_scores = v_mine.set_scores) instead of
-- canonical_set_scores. jsonb equality already ignores key order and 6 vs 6.0, so call_stats.sql's
-- "canonical form" check cannot tell them apart; a number written as a string ("6") can.
-- (save_pick stores the canonical form, so through the app the two agree: SMELL-level.)
-- ---------------------------------------------------------------------------------------------------
select public.dev_set_now('2026-10-21 16:31+00');
update public.picks
   set set_scores = '[{"p1_games": "6", "p2_games": "4"}, {"p1_games": 6, "p2_games": "4"}]'::jsonb
 where user_id = t.uid(2) and match_no = 1;
select t.as_user(t.uid(1));
select t.check('M-canonical: "6" and 6 are the same score for same_exact (30 of 52)',
  (select (picks_total, same_exact) = (52, 30) from public.get_my_call_stats(1)));
select t.as_owner();
update public.picks set set_scores = t.ss('6-4 6-4') where user_id = t.uid(2) and match_no = 1;

-- ---------------------------------------------------------------------------------------------------
-- Mutant: get_my_badges drops `coalesce(k.pts_winner, 0) > 0`, so a void late pick (0018: it scores 0)
-- on the right winner still makes a Perfect Night. 0022's header: a void pick "does not count as a
-- called winner". reminders.sql never makes a late pick.
-- ---------------------------------------------------------------------------------------------------
select public.dev_set_now('2026-10-21 20:00+00');
select t.feed(1, 'completed', 'c', '6-4 6-4');
select t.feed(2, 'completed', 'd', '6-4 6-3');
select t.check('M-setup: L''s QF1 pick is void (right winner, 0 winner points)',
  (select winner_id = 'c' and pts_winner = 0 from public.picks where user_id = t.uid(62) and match_no = 1));
select t.as_user(t.uid(61));
select t.check('M-perfect: K (both winners, both early) has Perfect Night 1',
  (select perfect from public.get_my_badges() where night_no = 1));
select t.as_user(t.uid(62));
select t.check('M-perfect: L (right winners, but QF1 picked after the real start) has no Perfect Night 1',
  (select perfect from public.get_my_badges() where night_no = 1) = false);
select t.as_owner();

-- ---------------------------------------------------------------------------------------------------
-- Crews. Fans 101-106: league "Late Bloomers", points rising with the user id (0 10 20 30 40 50), so
-- the best 5 are NOT the 5 lowest ids. Fans 111-115: in 55 leagues of 5 (0 points each).
-- ---------------------------------------------------------------------------------------------------
select t.new_user(n) from generate_series(101, 106) n;
select t.new_user(n) from generate_series(111, 115) n;
select t.new_user(120);
select set_config('skg.settling', '1', true);
update public.standings s set points = (v.n - 101) * 10, exact_sets = 0
  from generate_series(101, 106) v(n) where s.user_id = t.uid(v.n);
update public.standings s set points = 0, exact_sets = 0
  from generate_series(111, 115) v(n) where s.user_id = t.uid(v.n);
select set_config('skg.settling', '0', true);

insert into public.leagues (id, name, code, owner_id, created_at)
values ('00000000-0000-0000-0000-00000000b100', 'Late Bloomers', 'MUTLB1', t.uid(101), '2026-10-01');
insert into public.league_members (league_id, user_id)
select '00000000-0000-0000-0000-00000000b100', t.uid(n) from generate_series(101, 106) n;
insert into public.leagues (id, name, code, owner_id, created_at)
select ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + i), 12, '0'))::uuid,
       'Crew ' || i, 'MUT' || lpad(i::text, 3, '0'), t.uid(111), timestamptz '2026-10-02' + i * interval '1 minute'
  from generate_series(1, 55) i;
insert into public.league_members (league_id, user_id)
select ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + i), 12, '0'))::uuid, t.uid(n)
  from generate_series(1, 55) i, generate_series(111, 115) n;

select t.as_user(t.uid(120));   -- in no league
create temp table mboard on commit drop as select * from public.get_crew_board(100000);
grant select on mboard to public;

-- Mutant: best 5 chosen by user id (the row_number order loses `points desc`): Late Bloomers 20.0.
select t.check('M-best5: the best 5 by points, not the first 5 by id (Late Bloomers 30.0, #1)',
  (select (rank, avg_points) = (1, 30.0) from mboard where league_id = '00000000-0000-0000-0000-00000000b100'));
-- Mutant: `least(…, 50)` dropped. crews.sql's "a huge p_limit is accepted (capped at 50 inside)" has
-- only 6 eligible leagues, so it cannot see the cap.
select t.check('M-cap: 56 eligible leagues, p_limit 100000 → 50 rows (ranks 1..50)',
  (select count(*) = 50 and max(rank) = 50 from mboard));

select * from t.report();
rollback;
