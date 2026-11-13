-- =====================================================================================================
-- Round robin (0053): an alternate replaces a withdrawn player. Invented players; one group of four,
-- a semi-final fed by its winner and runner-up.
--   Group North: a (rank 1), b (rank 3), c (rank 6), d (rank 8); alternate z (rank 9)
--   day 1: a v d (1), b v c (2); then a v b (3), a v c (4), b v d (5), c v d (6)
--   SF (7) = North 1st v North 2nd (a test shape: one group is enough here)
-- =====================================================================================================
begin;

select public.dev_set_now('2026-11-14 12:00+00');
update public.event_config set
  timezone = 'Europe/Rome',
  rules = rules || '{"winner_points": {"RR": 8, "SF": 13, "F": 20}, "sets_points": {"RR": 4, "SF": 6, "F": 10}}',
  group_schedule = '{"time": "14:00", "days": {"North": ["2026-11-15", "2026-11-17", "2026-11-19"]}}';

select t.as_service();
select public.set_players(
  '[{"id":"a","name":"Player A","seed":1,"rank":1},{"id":"b","name":"Player B","seed":2,"rank":3},
    {"id":"c","name":"Player C","seed":3,"rank":6},{"id":"d","name":"Player D","seed":4,"rank":8}]',
  '[{"match_no":1,"round":"RR","group":"North","day":1,"p1":{"type":"player","id":"a"},"p2":{"type":"player","id":"d"}},
    {"match_no":2,"round":"RR","group":"North","day":1,"p1":{"type":"player","id":"b"},"p2":{"type":"player","id":"c"}},
    {"match_no":3,"round":"RR","group":"North","p1":{"type":"player","id":"a"},"p2":{"type":"player","id":"b"}},
    {"match_no":4,"round":"RR","group":"North","p1":{"type":"player","id":"a"},"p2":{"type":"player","id":"c"}},
    {"match_no":5,"round":"RR","group":"North","p1":{"type":"player","id":"b"},"p2":{"type":"player","id":"d"}},
    {"match_no":6,"round":"RR","group":"North","p1":{"type":"player","id":"c"},"p2":{"type":"player","id":"d"}},
    {"match_no":7,"round":"SF","p1":{"type":"group","group":"North","place":1},"p2":{"type":"group","group":"North","place":2}}]');
select public.set_match_start(1, '2026-11-15 14:00+01');
select public.set_match_start(2, '2026-11-15 20:30+01');
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 7) n
union all
select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','z']) p
on conflict do nothing;
select t.as_owner();
select t.new_user(n) from generate_series(1, 3) n;

select public.dev_set_now('2026-11-15 23:00+00');
select t.check('day 1: a beat d', t.feed(1, 'completed', 'a', '6-2 6-2')->>'outcome' = 'settled');
select t.check('day 1: b beat c', t.feed(2, 'completed', 'b', '6-2 6-2')->>'outcome' = 'settled');
select t.check('day 2 scheduled: a v b and c v d', (select bool_and(matchday = 2) from public.matches where match_no in (3, 6)));
select t.check('a pick on d (day 2, c v d)', t.pick(t.uid(1), 6, 'd', '4-6 4-6') is null);
select t.check('a pick on c (day 2, c v d)', t.pick(t.uid(2), 6, 'c', '6-4 6-4') is null);

-- d withdraws before day 2: z takes his two unstarted matches
select t.as_service();
create temp table t_rep as select public.replace_player('d', '{"id":"z","name":"Player Z","seed":9,"rank":9}') as out;
select t.as_owner();
select t.check('the alternate takes d''s two unstarted matches', (select (out->>'matches')::int = 2 from t_rep), (select out::text from t_rep));
select t.check('d''s settled day-1 match is untouched', (select p2_id = 'd' and status = 'completed' from public.matches where match_no = 1));
select t.check('c v d is now c v z, re-priced (rank 9 over rank 6 = 9)',
  (select p2_id = 'z' and p2_win_points = 9 from public.matches where match_no = 6),
  (select p2_id || ' ' || p2_win_points from public.matches where match_no = 6));
select t.check('the pick on d is removed, the pick on c stays',
  not exists (select 1 from public.picks where user_id = t.uid(1) and match_no = 6)
  and exists (select 1 from public.picks where user_id = t.uid(2) and match_no = 6));
select t.check('the replacement is announced', exists (select 1 from public.ops_alerts where kind = 'player_replaced'));

select public.dev_set_now('2026-11-19 23:30+00');
select t.check('a v b settled', t.feed(3, 'completed', 'a', '6-3 6-3')->>'outcome' = 'settled');
select t.check('c v z settled', t.feed(6, 'completed', 'c', '6-3 6-3')->>'outcome' = 'settled');
select t.check('a v c settled', t.feed(4, 'completed', 'a', '6-3 6-3')->>'outcome' = 'settled');
select t.check('b v z settled', t.feed(5, 'completed', 'b', '6-3 6-3')->>'outcome' = 'settled');

select t.check('five players in the group: no automatic order', not exists (select 1 from public.group_standings('North')));
select t.check('the semi-final waits', (select p1_id is null and p2_id is null from public.matches where match_no = 7));
select t.check('the operator is told to fill it', exists (select 1 from public.ops_alerts where kind = 'group_standings_manual'));

select t.as_service();
select t.check('set_group_slot fills side 1 with a group player', t.err($q$ select public.set_group_slot(7, 1, 'a') $q$) is null);
select t.check('set_group_slot refuses a player from outside the group', t.err($q$ select public.set_group_slot(7, 2, 'q') $q$) like '%player_not_in_group%');
select t.check('set_group_slot fills side 2', t.err($q$ select public.set_group_slot(7, 2, 'b') $q$) is null);
select t.as_owner();
select t.check('the semi-final has its players and points',
  (select p1_id = 'a' and p2_id = 'b' and p1_win_points = 13 and p2_win_points is not null from public.matches where match_no = 7));
select t.check('set_group_slot refuses a match that is not group-fed',
  t.err($q$ select t.as_service(); select public.set_group_slot(1, 1, 'a'); $q$) like '%match_started%'
  or t.err($q$ select t.as_service(); select public.set_group_slot(1, 1, 'a'); $q$) like '%not_a_group_slot%');
select t.as_owner();

select * from t.report();
rollback;
