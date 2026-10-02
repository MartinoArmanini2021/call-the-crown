-- =====================================================================================================
-- Scoring: every component of a match score, from real settlements through ingest_result.
-- Runs inside begin … rollback; prints one PASS/FAIL line per check (bun run test:sql scoring).
-- Bracket and players: t.setup_event() in _prelude.sql (invented players A–F, ranks 1/2/3/5/7/10).
-- Set scores are written in the match's fixed order: player 1's games first.
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(n) from generate_series(1, 13) n;

-- Quarter-final picks (clock: 20 Oct)
--   QF1 = C (rank 3) v F (rank 10). Result below: F wins 4-6 6-3 4-6 (an upset, three sets).
--   QF2 = D (rank 5) v E (rank 7).  Result below: D wins 6-4 6-3.
select t.check('pick saved: right winner, wrong set scores',  t.pick(t.uid(1),  2, 'd', '6-2 6-2') is null);
select t.check('pick saved: right winner, wrong set count',   t.pick(t.uid(11), 2, 'd', '6-2 3-6 6-2') is null);
select t.check('pick saved: one of two sets exact',           t.pick(t.uid(2),  2, 'd', '6-4 6-1') is null);
select t.check('pick saved: all sets exact',                  t.pick(t.uid(3),  2, 'd', '6-4 6-3') is null);
select t.check('pick saved: wrong winner, set 1 identical',   t.pick(t.uid(4),  2, 'e', '6-4 3-6 3-6') is null);
select t.check('pick saved: wrong winner, mirrored scores',   t.pick(t.uid(12), 2, 'e', '4-6 3-6') is null);
select t.check('pick saved: upset, three sets all exact',     t.pick(t.uid(5),  1, 'f', '4-6 6-3 4-6') is null);
select t.check('pick saved: two-set call on a three-set match', t.pick(t.uid(6), 1, 'f', '4-6 4-6') is null);

select t.check('stored potential points: rank 10 over rank 3 in a QF = 10 (9.51 rounds to 10)',
  (select p2_win_points = 10 and p1_win_points = 8 from public.matches where match_no = 1));
select t.check('stored potential points: rank 7 over rank 5 in a QF = 9 (8.5 rounds up)',
  (select p2_win_points = 9 and p1_win_points = 8 from public.matches where match_no = 2));
select t.check('brief example: rank 10 beats rank 1 in a QF = 10 points', public.win_points('QF', 10, 1) = 10);
select t.check('no bonus for the higher-ranked player', public.win_points('F', 1, 10) = 20);

-- Night 1 results
select public.dev_set_now('2026-10-21 20:00+00');
select t.check('QF1 settled', t.feed(1, 'completed', 'f', '4-6 6-3 4-6')->>'outcome' = 'settled');
select t.check('QF2 settled', t.feed(2, 'completed', 'd', '6-4 6-3')->>'outcome' = 'settled');

select t.check('right winner, wrong set scores: winner + sets only (8/4/0/12)', t.pts(t.uid(1), 2) = '8/4/0/12', t.pts(t.uid(1), 2));
select t.check('right winner, wrong set count: winner only (8/0/0/8)',        t.pts(t.uid(11), 2) = '8/0/0/8', t.pts(t.uid(11), 2));
select t.check('one of two sets exact (8/4/2/14)',                            t.pts(t.uid(2), 2) = '8/4/2/14', t.pts(t.uid(2), 2));
select t.check('all sets exact (8/4/4/16)',                                   t.pts(t.uid(3), 2) = '8/4/4/16', t.pts(t.uid(3), 2));
select t.check('wrong winner with an identical set 1 scores 0',               t.pts(t.uid(4), 2) = '0/0/0/0', t.pts(t.uid(4), 2));
select t.check('wrong winner with mirrored set scores scores 0',              t.pts(t.uid(12), 2) = '0/0/0/0', t.pts(t.uid(12), 2));
select t.check('upset multiplier with rounding, all three sets exact (10/4/6/20)', t.pts(t.uid(5), 1) = '10/4/6/20', t.pts(t.uid(5), 1));
select t.check('two-set call on a three-set match: set 1 credited, its set 2 not compared with set 3 (10/0/2/12)',
  t.pts(t.uid(6), 1) = '10/0/2/12', t.pts(t.uid(6), 1));

select t.check('the semi-finals are filled from the quarter-final winners',
  (select array_agg(p2_id order by match_no) = array['f','d'] from public.matches where match_no in (3, 4)));
select t.check('SF potential points stored: rank 10 over rank 1 in a SF = 16',
  (select p1_win_points = 13 and p2_win_points = 16 from public.matches where match_no = 3));

-- Semi-final picks (clock: 21 Oct 20:00 UTC, before the 22 Oct start)
--   SF1 = A v F. Result: A wins 6-4 4-6 6-3 (the brief's worked example).
--   SF2 = B v D. Result: B wins, D retires at 6-4 2-1.
select t.check('pick saved: worked example', t.pick(t.uid(7), 3, 'a', '6-4 3-6 6-3') is null);
select t.check('pick saved: on a match that ends in a retirement', t.pick(t.uid(8), 4, 'b', '6-4 6-3') is null);

select public.dev_set_now('2026-10-22 21:00+00');
select t.check('SF1 settled', t.feed(3, 'completed', 'a', '6-4 4-6 6-3')->>'outcome' = 'settled');
select t.check('SF2 settled as a retirement', t.feed(4, 'retired', 'b', '6-4 2-1')->>'outcome' = 'settled');

select t.check('worked example: 13 + 6 + 2 + 2 = 23', t.pts(t.uid(7), 3) = '13/6/4/23', t.pts(t.uid(7), 3));
select t.check('retirement: winner counts, sets and exact sets void even though set 1 matches (13/0/0/13)',
  t.pts(t.uid(8), 4) = '13/0/0/13', t.pts(t.uid(8), 4));
select t.check('third place filled with the two semi-final losers, final with the winners',
  (select array_agg(array[p1_id, p2_id] order by match_no) = array[array['f','d'], array['a','b']]
     from public.matches where match_no in (5, 6)));

-- Third-place and final picks (clock: 22 Oct 21:00 UTC)
--   3P = F v D. Result: D wins by walkover.
--   F  = A v B. Result: A wins 7-6 6-4; the provider also sends tiebreak points.
select t.check('pick saved: on a match that ends in a walkover', t.pick(t.uid(9), 5, 'd', '4-6 4-6') is null);
select t.check('pick saved: a 7-6 set', t.pick(t.uid(10), 6, 'a', '7-6 6-4') is null);

select public.dev_set_now('2026-10-24 21:00+00');
select t.check('3P settled as a walkover', t.feed(5, 'walkover', 'd', '')->>'outcome' = 'settled');
select t.as_service();
select t.check('final settled from a payload carrying tiebreak points',
  public.ingest_result('fixture',
    '{"match_ref": "fx-m6", "status": "completed", "players": ["fx-a", "fx-b"], "winner": "fx-a",
      "set_scores": [{"p1_games": 7, "p2_games": 6, "p1_tiebreak": 10, "p2_tiebreak": 8},
                     {"p1_games": 6, "p2_games": 4}]}', '{}')->>'outcome' = 'settled');
select t.as_owner();

select t.check('walkover: winner counts, sets and exact sets void (8/0/0/8)', t.pts(t.uid(9), 5) = '8/0/0/8', t.pts(t.uid(9), 5));
select t.check('a 7-6 counts as 7-6 whatever the tiebreak points (20/10/4/34)', t.pts(t.uid(10), 6) = '20/10/4/34', t.pts(t.uid(10), 6));
select t.check('the stored result keeps games only',
  (select set_scores = t.ss('7-6 6-4') from public.matches where match_no = 6));

select t.check('exact_flags: all three sets exact', (select exact_flags from public.picks where user_id = t.uid(5) and match_no = 1) = array[true, true, true]);
select t.check('exact_flags: one of two exact (set 2 missed, no set 3)', (select exact_flags::text from public.picks where user_id = t.uid(2) and match_no = 2) = '{t,f,NULL}', (select exact_flags::text from public.picks where user_id = t.uid(2) and match_no = 2));
select t.check('exact_flags: two-set call on a three-set match (set 1 only)', (select exact_flags::text from public.picks where user_id = t.uid(6) and match_no = 1) = '{t,f,NULL}', (select exact_flags::text from public.picks where user_id = t.uid(6) and match_no = 1));
select t.check('exact_flags: none for a wrong winner or a retirement', (select exact_flags from public.picks where user_id = t.uid(4) and match_no = 2) is null and (select exact_flags from public.picks where user_id = t.uid(8) and match_no = 4) is null);
select t.check('exact_flags agree with the exact_sets count on every scored pick', not exists (select 1 from public.picks where pts_total is not null and coalesce((select count(*) from unnest(exact_flags) f where f), 0) <> exact_sets));
select t.check('standings = the sum of the stored breakdowns',
  not exists (select 1 from public.standings s
               where s.points <> coalesce((select sum(pts_total) from public.picks p where p.user_id = s.user_id), 0)
                  or s.exact_sets <> coalesce((select sum(exact_sets) from public.picks p where p.user_id = s.user_id), 0)));

select * from t.report();
rollback;
