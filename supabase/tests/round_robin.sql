-- =====================================================================================================
-- Round robin (0053): the ATP Finals shape with invented players. Two groups of four, days 2 and 3
-- scheduled by the database, semi-finals filled from the standings, the final from the semi-finals.
--   North: a (rank 1), b (rank 3), c (rank 6), d (rank 8)   day 1: a v d, b v c
--   South: e (rank 2), f (rank 4), g (rank 5), h (rank 7)   day 1: e v h, f v g
--   SF1 (13) = North 1st v South 2nd · SF2 (14) = South 1st v North 2nd · F (15) = winners
-- Clock: 14 Nov 2026 (the day before). Times are Europe/Rome.
-- =====================================================================================================
begin;

select public.dev_set_now('2026-11-14 12:00+00');
update public.event_config set
  timezone = 'Europe/Rome',
  rules = rules || '{"winner_points": {"RR": 8, "SF": 13, "F": 20}, "sets_points": {"RR": 4, "SF": 6, "F": 10}}',
  group_schedule = '{"time": "14:00", "days": {"North": ["2026-11-15", "2026-11-17", "2026-11-19"],
                                               "South": ["2026-11-16", "2026-11-18", "2026-11-20"]}}';

select t.as_service();
select public.set_players(
  '[{"id":"a","name":"Player A","seed":1,"rank":1},{"id":"e","name":"Player E","seed":2,"rank":2},
    {"id":"b","name":"Player B","seed":3,"rank":3},{"id":"f","name":"Player F","seed":4,"rank":4},
    {"id":"g","name":"Player G","seed":5,"rank":5},{"id":"c","name":"Player C","seed":6,"rank":6},
    {"id":"h","name":"Player H","seed":7,"rank":7},{"id":"d","name":"Player D","seed":8,"rank":8}]',
  '[{"match_no":1, "round":"RR","group":"North","day":1,"p1":{"type":"player","id":"a"},"p2":{"type":"player","id":"d"}},
    {"match_no":2, "round":"RR","group":"North","day":1,"p1":{"type":"player","id":"b"},"p2":{"type":"player","id":"c"}},
    {"match_no":3, "round":"RR","group":"North","p1":{"type":"player","id":"a"},"p2":{"type":"player","id":"b"}},
    {"match_no":4, "round":"RR","group":"North","p1":{"type":"player","id":"a"},"p2":{"type":"player","id":"c"}},
    {"match_no":5, "round":"RR","group":"North","p1":{"type":"player","id":"b"},"p2":{"type":"player","id":"d"}},
    {"match_no":6, "round":"RR","group":"North","p1":{"type":"player","id":"c"},"p2":{"type":"player","id":"d"}},
    {"match_no":7, "round":"RR","group":"South","day":1,"p1":{"type":"player","id":"e"},"p2":{"type":"player","id":"h"}},
    {"match_no":8, "round":"RR","group":"South","day":1,"p1":{"type":"player","id":"f"},"p2":{"type":"player","id":"g"}},
    {"match_no":9, "round":"RR","group":"South","p1":{"type":"player","id":"e"},"p2":{"type":"player","id":"f"}},
    {"match_no":10,"round":"RR","group":"South","p1":{"type":"player","id":"e"},"p2":{"type":"player","id":"g"}},
    {"match_no":11,"round":"RR","group":"South","p1":{"type":"player","id":"f"},"p2":{"type":"player","id":"h"}},
    {"match_no":12,"round":"RR","group":"South","p1":{"type":"player","id":"g"},"p2":{"type":"player","id":"h"}},
    {"match_no":13,"round":"SF","p1":{"type":"group","group":"North","place":1},"p2":{"type":"group","group":"South","place":2}},
    {"match_no":14,"round":"SF","p1":{"type":"group","group":"South","place":1},"p2":{"type":"group","group":"North","place":2}},
    {"match_no":15,"round":"F", "p1":{"type":"winner","match":13},"p2":{"type":"winner","match":14}}]');
select public.set_match_start(1, '2026-11-15 14:00+01');
select public.set_match_start(2, '2026-11-15 20:30+01');
select public.set_match_start(7, '2026-11-16 14:00+01');
select public.set_match_start(8, '2026-11-16 20:30+01');
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 15) n
union all
select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','e','f','g','h']) p
on conflict do nothing;
select t.as_owner();
select t.new_user(n) from generate_series(1, 6) n;

select t.check('15 matches: 12 group matches with a group, 2 semi-finals, 1 final',
  (select count(*) filter (where round = 'RR' and grp is not null) = 12
      and count(*) filter (where round = 'SF') = 2 and count(*) filter (where round = 'F') = 1 from public.matches));
select t.check('group match points stored at the RR value: rank 8 over rank 1 = 10, the favourite 8',
  (select p1_win_points = 8 and p2_win_points = 10 from public.matches where match_no = 1),
  (select p1_win_points || '/' || p2_win_points from public.matches where match_no = 1));
select t.check('semi-final players are not known yet', (select bool_and(p1_id is null and p2_id is null) from public.matches where round = 'SF'));
select t.check('day-1 matches are pickable', t.pick(t.uid(1), 1, 'a', '6-0 6-0') is null);
select t.check('a day-2/3 match has no start time yet, so it cannot be picked',
  t.pick(t.uid(1), 3, 'a', '6-4 6-4') like '%no_start_time%', t.pick(t.uid(1), 3, 'a', '6-4 6-4'));
select t.check('a semi-final cannot be picked before its players are known',
  t.pick(t.uid(1), 13, 'a', '6-4 6-4') like '%players_unknown%', t.pick(t.uid(1), 13, 'a', '6-4 6-4'));

-- North day 1: a beats d, b beats c → day 2: a v b (winners), c v d (losers); day 3: a v c, b v d
select public.dev_set_now('2026-11-15 23:00+00');
select t.check('North day 1, match 1 settled', t.feed(1, 'completed', 'a', '6-0 6-0')->>'outcome' = 'settled');
select t.check('one day-1 result is not enough to schedule day 2',
  (select bool_and(starts_at is null) from public.matches where match_no in (3, 4, 5, 6)));
select t.check('North day 1, match 2 settled', t.feed(2, 'completed', 'b', '6-1 6-1')->>'outcome' = 'settled');
select t.check('day 2 = the day-1 winners and the day-1 losers, at 14:00 Rome on the group''s second day',
  (select bool_and(matchday = 2 and starts_at = timestamptz '2026-11-17 14:00+01') from public.matches where match_no in (3, 6)),
  (select string_agg(match_no || ':' || coalesce(matchday::text, '-') || '@' || coalesce(starts_at::text, '-'), ' ') from public.matches where grp = 'North'));
select t.check('day 3 = the other two pairs, on the group''s third day',
  (select bool_and(matchday = 3 and starts_at = timestamptz '2026-11-19 14:00+01') from public.matches where match_no in (4, 5)));
select t.check('the South group is not scheduled by the North results',
  (select bool_and(starts_at is null) from public.matches where match_no in (9, 10, 11, 12)));
select t.check('scheduling is announced in the ops alerts',
  exists (select 1 from public.ops_alerts where kind = 'group_days_scheduled' and detail->>'group' = 'North'));
select t.check('a day-2 match is now pickable', t.pick(t.uid(2), 3, 'b', '4-6 6-4 4-6') is null, t.pick(t.uid(2), 3, 'b', '4-6 6-4 4-6'));
select t.check('an operator may still move a group start later (set_match_start)',
  t.err($q$ select t.as_service(); select public.set_match_start(6, '2026-11-17 20:30+01'); select t.as_owner(); $q$) is null);

-- North: a three-way tie on two wins. a 5-2 sets, c 5-3, b 4-3 → a, c, b, then d.
select public.dev_set_now('2026-11-17 23:30+00');
select t.check('North a v b settled', t.feed(3, 'completed', 'a', '6-4 6-4')->>'outcome' = 'settled');
select t.check('North c v d settled', t.feed(6, 'completed', 'c', '6-3 6-3')->>'outcome' = 'settled');
select public.dev_set_now('2026-11-19 23:30+00');
select t.check('North a v c settled', t.feed(4, 'completed', 'c', '4-6 6-4 4-6')->>'outcome' = 'settled');
select t.check('no semi-final player before the group is complete', (select p1_id is null from public.matches where match_no = 13));
select t.check('North b v d settled', t.feed(5, 'completed', 'b', '6-1 6-1')->>'outcome' = 'settled');

-- (b beat c on day 1 6-1 6-1: b 4-2 sets would beat c; recount: b beat c 2-0, d 2-0, lost to a 0-2 → 4-2.
--  c: lost to b 0-2, beat d 2-0, beat a 2-1 → 4-3. a: beat d 2-0, beat b 2-0, lost to c 1-2 → 5-2.)
select t.check('three level on wins: % of sets won decides (a 71%, b 67%, c 57%)',
  (select array_agg(player_id order by place) = array['a','b','c','d'] from public.group_standings('North')),
  (select string_agg(place || ':' || player_id, ' ' order by place) from public.group_standings('North')));
select t.check('SF1 player 1 = North winner, SF2 player 2 = North runner-up',
  (select p1_id from public.matches where match_no = 13) = 'a' and (select p2_id from public.matches where match_no = 14) = 'b');

-- South: two level on top. e beats g and h; f beats e and h; g beats f; h beats g → f, e (head to head), h, g.
select public.dev_set_now('2026-11-16 23:30+00');
select t.check('South e v h settled', t.feed(7, 'completed', 'e', '6-4 6-4')->>'outcome' = 'settled');
select t.check('South f v g settled', t.feed(8, 'completed', 'g', '6-7 6-7')->>'outcome' = 'settled');
select t.check('South day 2 = e v g (winners) and f v h (losers)',
  (select bool_and(matchday = 2) from public.matches where match_no in (10, 11)));
select public.dev_set_now('2026-11-18 23:30+00');
select t.check('South e v g settled', t.feed(10, 'completed', 'e', '6-2 6-2')->>'outcome' = 'settled');
select t.check('South f v h settled', t.feed(11, 'completed', 'f', '6-3 6-3')->>'outcome' = 'settled');
select public.dev_set_now('2026-11-20 23:30+00');
select t.check('South e v f settled', t.feed(9, 'completed', 'f', '3-6 3-6')->>'outcome' = 'settled');
select t.check('South g v h settled', t.feed(12, 'completed', 'h', '4-6 4-6')->>'outcome' = 'settled');
select t.check('two level on wins: head to head decides (f beat e), then h beat g',
  (select array_agg(player_id order by place) = array['f','e','h','g'] from public.group_standings('South')),
  (select string_agg(place || ':' || player_id, ' ' order by place) from public.group_standings('South')));
select t.check('semi-finals filled: SF1 = a v e, SF2 = f v b',
  (select array_agg(p1_id || '-' || p2_id order by match_no) = array['a-e', 'f-b'] from public.matches where round = 'SF'),
  (select string_agg(coalesce(p1_id, '?') || '-' || coalesce(p2_id, '?'), ' ' order by match_no) from public.matches where round = 'SF'));
select t.check('semi-final potential points stored (rank 2 over rank 1: 13.4 rounds to 13)',
  (select p1_win_points = 13 and p2_win_points = 13 from public.matches where match_no = 13),
  (select p1_win_points || '/' || p2_win_points from public.matches where match_no = 13));

select t.as_service();
select public.set_match_start(13, '2026-11-21 14:00+01');
select public.set_match_start(14, '2026-11-21 20:30+01');
select public.set_match_start(15, '2026-11-22 18:00+01');
select t.as_owner();
select t.check('a semi-final is pickable once filled', t.pick(t.uid(3), 13, 'e', '4-6 4-6') is null, t.pick(t.uid(3), 13, 'e', '4-6 4-6'));

-- A corrected group result before the semi-final starts re-fills it; a pick on the removed player goes.
select public.dev_set_now('2026-11-21 08:00+00');
select t.check('a pick on b in SF2 before the correction', t.pick(t.uid(4), 14, 'b', '4-6 4-6') is null);
create temp table t_fix as select t.feed(5, 'completed', 'd', '1-6 1-6') as out;
select t.check('North b v d corrected before the semi-finals: d won', (select out->>'outcome' from t_fix) = 'resettled', (select out::text from t_fix));
-- a 2 wins, c 2 wins (c beat a), b 1, d 1 → c, a
select t.check('after the correction: c first, a second; SF1 = c v e, SF2 = f v a',
  (select array_agg(p1_id || '-' || p2_id order by match_no) = array['c-e', 'f-a'] from public.matches where round = 'SF'),
  (select string_agg(coalesce(p1_id, '?') || '-' || coalesce(p2_id, '?'), ' ' order by match_no) from public.matches where round = 'SF'));
select t.check('the refill is announced', exists (select 1 from public.ops_alerts where kind = 'bracket_refilled' and (detail->>'match_no')::int in (13, 14)));
select t.check('the pick on the removed player is gone, the pick on e stays',
  not exists (select 1 from public.picks where user_id = t.uid(4) and match_no = 14)
  and exists (select 1 from public.picks where user_id = t.uid(3) and match_no = 13));

-- The final from the semi-finals, as for any bracket.
select public.dev_set_now('2026-11-21 23:30+00');
select t.check('SF1 settled', t.feed(13, 'completed', 'e', '4-6 4-6')->>'outcome' = 'settled');
select t.check('the final names the SF1 winner', (select p1_id from public.matches where match_no = 15) = 'e');
select t.check('SF pick on the winner with exact sets scores 13/6/4/23', t.pts(t.uid(3), 13) = '13/6/4/23', t.pts(t.uid(3), 13));

-- Privileges
select t.as_anon();
select t.check('anon cannot replace a player', t.err($q$ select public.replace_player('a', '{"id":"z","rank":9}') $q$) is not null);
select t.check('anon cannot fill a group slot', t.err($q$ select public.set_group_slot(13, 1, 'a') $q$) is not null);
select t.check('anon cannot read standings directly', t.err($q$ select * from public.group_standings('North') $q$) is not null);
select t.as_user(t.uid(1));
select t.check('a fan cannot replace a player', t.err($q$ select public.replace_player('a', '{"id":"z","rank":9}') $q$) is not null);
select t.check('a fan cannot run the group step', t.err($q$ select public.advance_groups() $q$) is not null);
select t.as_owner();

select * from t.report();
rollback;
