-- =====================================================================================================
-- Days 2 and 3 after a corrected day-1 result, after an alternate came in, and when day-1 results come
-- in late (0055, audit 13 Nov 2026). Invented players.
--   North: a b c d   day 1 (15 Nov): a v d (1), b v c (2); then a v b (3), a v c (4), b v d (5), c v d (6)
--   South: e f g h   day 1 (16 Nov): e v h (7), f v g (8); then e v f (9), e v g (10), f v h (11), g v h (12)
--   days: North 15/17/19, South 16/18/20 Nov, 14:00 Rome
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
  '[{"id":"a","name":"Player A","seed":1,"rank":1},{"id":"b","name":"Player B","seed":2,"rank":3},
    {"id":"c","name":"Player C","seed":3,"rank":6},{"id":"d","name":"Player D","seed":4,"rank":8},
    {"id":"e","name":"Player E","seed":5,"rank":2},{"id":"f","name":"Player F","seed":6,"rank":4},
    {"id":"g","name":"Player G","seed":7,"rank":5},{"id":"h","name":"Player H","seed":8,"rank":7}]',
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
    {"match_no":13,"round":"SF","p1":{"type":"group","group":"North","place":1},"p2":{"type":"group","group":"South","place":1}}]');
select public.set_match_start(1, '2026-11-15 14:00+01');
select public.set_match_start(2, '2026-11-15 20:30+01');
select public.set_match_start(7, '2026-11-16 14:00+01');
select public.set_match_start(8, '2026-11-16 20:30+01');
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 13) n
union all
select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','e','f','g','h','z']) p
on conflict do nothing;
select t.as_owner();
select t.new_user(n) from generate_series(1, 3) n;

-- North day 1 as first read: a beat d, b beat c → day 2 a v b (3) and c v d (6); day 3 a v c (4), b v d (5)
select public.dev_set_now('2026-11-15 23:00+00');
select t.check('North day 1: a beat d', t.feed(1, 'completed', 'a', '6-1 6-1')->>'outcome' = 'settled');
select t.check('North day 1: b beat c (as first read)', t.feed(2, 'completed', 'b', '6-3 6-3')->>'outcome' = 'settled');
select t.check('day 2 = a v b and c v d, 17 Nov 14:00',
  (select bool_and(matchday = 2 and starts_at = timestamptz '2026-11-17 14:00+01') from public.matches where match_no in (3, 6)));
select t.check('a pick on a v b (then day 2)', t.pick(t.uid(1), 3, 'a', '6-4 6-4') is null);

-- The day-1 reading is corrected the next morning: c beat b. The day-1 winners are now a and c.
select public.dev_set_now('2026-11-16 09:00+00');
select t.check('North day 1 corrected: c beat b', t.feed(2, 'completed', 'c', '3-6 3-6')->>'outcome' = 'resettled');
select t.check('day 2 is re-paired: a v c (4) and b v d (5), 17 Nov 14:00',
  (select bool_and(matchday = 2 and starts_at = timestamptz '2026-11-17 14:00+01') from public.matches where match_no in (4, 5)),
  (select string_agg(match_no || ':d' || coalesce(matchday::text, '-') || '@' || coalesce(starts_at::text, '-'), ' ' order by match_no)
     from public.matches where grp = 'North'));
select t.check('day 3 = a v b (3) and c v d (6), 19 Nov 14:00',
  (select bool_and(matchday = 3 and starts_at = timestamptz '2026-11-19 14:00+01') from public.matches where match_no in (3, 6)));
select t.check('the move is announced',
  exists (select 1 from public.ops_alerts where kind = 'group_days_rescheduled' and detail->>'group' = 'North'
             and jsonb_array_length(detail->'moved') = 4));
select t.check('the pick on a v b stays (same match, later lock)',
  exists (select 1 from public.picks where user_id = t.uid(1) and match_no = 3));
select t.check('the winners'' match is pickable until its new lock', t.pick(t.uid(2), 4, 'c', '4-6 4-6') is null);

-- d (a day-1 loser) withdraws; z takes his two unstarted matches. A later re-settlement does not
-- re-pair the alternate's matches by day-1 results he did not play.
select public.dev_set_now('2026-11-16 10:00+00');
select t.as_service();
select t.check('z replaces d', (public.replace_player('d', '{"id":"z","name":"Player Z","seed":9,"rank":9}')->>'matches')::int = 2);
select t.as_owner();
select t.check('a corrected score of a day-1 match', t.feed(1, 'completed', 'a', '6-2 6-2')->>'outcome' = 'resettled');
select t.check('the alternate''s matches keep their days (b v z day 2, c v z day 3)',
  (select matchday = 2 and starts_at = timestamptz '2026-11-17 14:00+01' from public.matches where match_no = 5)
  and (select matchday = 3 and starts_at = timestamptz '2026-11-19 14:00+01' from public.matches where match_no = 6),
  (select string_agg(match_no || ':' || p1_id || '-' || p2_id || ':d' || matchday, ' ' order by match_no) from public.matches where grp = 'North'));
select t.as_service();
select t.check('replace_player refuses a player already in the draw',
  t.err($q$ select public.replace_player('c', '{"id":"a","name":"Player A","rank":1}') $q$) like '%replacement_already_in_draw%');
select t.check('replace_player refuses the withdrawn player as his own replacement',
  t.err($q$ select public.replace_player('c', '{"id":"c","name":"Player C","rank":6}') $q$) like '%replacement_already_in_draw%');
select t.as_owner();

-- South: the day-1 results reach the database only after day 2's 14:00 (a feed outage). Day 2 locks at
-- once (it is under way) instead of staying without a start; day 3 keeps its day.
select public.dev_set_now('2026-11-18 15:00+00');
select t.check('South day 1 late: e beat h', t.feed(7, 'completed', 'e', '6-4 6-4')->>'outcome' = 'settled');
select t.check('South day 1 late: f beat g', t.feed(8, 'completed', 'f', '6-4 6-4')->>'outcome' = 'settled');
select t.check('day 2 (e v f, g v h) locks now, so it is polled and settles',
  (select bool_and(matchday = 2 and starts_at = timestamptz '2026-11-18 15:00+00') from public.matches where match_no in (9, 12)),
  (select string_agg(match_no || ':d' || coalesce(matchday::text, '-') || '@' || coalesce(starts_at::text, '-'), ' ' order by match_no)
     from public.matches where grp = 'South'));
select t.check('day 3 keeps 20 Nov 14:00',
  (select bool_and(matchday = 3 and starts_at = timestamptz '2026-11-20 14:00+01') from public.matches where match_no in (10, 11)));

select * from t.report();
rollback;
