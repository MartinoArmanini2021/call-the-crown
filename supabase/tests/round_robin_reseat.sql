-- =====================================================================================================
-- A group result corrected after the semi-final it feeds has started: the semi-final pauses, and
-- reseat_paused_match takes its players from the corrected standings (0055, audit 13 Nov 2026).
-- Invented players; one group of four feeding one semi-final (1st v 2nd: a test shape).
--   North: a b c d   day 1: a v d (1), b v c (2); then a v b (3), a v c (4), b v d (5), c v d (6)
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
select public.set_match_start(7, '2026-11-21 14:00+01');
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 7) n
union all
select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d']) p
on conflict do nothing;
select t.as_owner();

select public.dev_set_now('2026-11-15 23:00+00');
select t.feed(1, 'completed', 'a', '6-1 6-1');
select t.feed(2, 'completed', 'b', '6-3 6-3');
select public.dev_set_now('2026-11-17 23:00+00');
select t.feed(3, 'completed', 'a', '6-4 6-4');
select t.feed(6, 'completed', 'd', '4-6 4-6');
select public.dev_set_now('2026-11-19 23:00+00');
select t.feed(4, 'completed', 'a', '6-2 6-2');
select t.feed(5, 'completed', 'b', '6-3 6-3');
select t.check('group complete: a 3 wins, b 2, d 1, c 0 → the semi-final is a v b',
  (select p1_id = 'a' and p2_id = 'b' from public.matches where match_no = 7),
  (select coalesce(p1_id, '?') || '-' || coalesce(p2_id, '?') from public.matches where match_no = 7));

-- The semi-final has started when b v d is corrected: d won. The standings become a, d, b, c.
select public.dev_set_now('2026-11-21 13:30+00');
select t.check('b v d corrected after the semi-final started', t.feed(5, 'completed', 'd', '3-6 3-6')->>'outcome' = 'resettled');
select t.check('the started semi-final is paused, its players untouched',
  (select settlement_paused and p1_id = 'a' and p2_id = 'b' from public.matches where match_no = 7)
  and exists (select 1 from public.ops_alerts where kind = 'bracket_conflict' and (detail->>'match_no')::int = 7));

select t.as_service();
create temp table t_reseat as select public.reseat_paused_match(7) as out;
select t.as_owner();
select t.check('reseat_paused_match takes the group slot from the corrected standings: a v d',
  (select p1_id = 'a' and p2_id = 'd' and not settlement_paused from public.matches where match_no = 7),
  (select out::text from t_reseat));
select t.check('its potential points are re-stored (rank 8 over rank 1: 13 × 44/37 = 15.46 → 15)',
  (select p1_win_points = 13 and p2_win_points = 15 from public.matches where match_no = 7),
  (select p1_win_points || '/' || p2_win_points from public.matches where match_no = 7));
select t.check('the provider''s semi-final (a v d) now settles', t.feed(7, 'completed', 'a', '6-4 6-4')->>'outcome' = 'settled');

select * from t.report();
rollback;
