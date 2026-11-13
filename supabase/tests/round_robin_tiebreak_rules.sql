-- =====================================================================================================
-- Group standings against the ATP Finals rules on retirements and walkovers (0055, audit 13 Nov 2026).
-- Invented players, three groups of four, each feeding one semi-final (1st v 2nd: a test shape).
--   North: a b c d  — a three-way tie on two wins where a retirement decides the % of sets
--   South: e f g h  — a three-way tie level on % of sets, in a group with a retirement → operator
--   West:  i j k l  — a group with a walkover → operator
-- Every group match starts 15 Nov 14:00 Rome (no day scheduling here: group_schedule is null).
-- =====================================================================================================
begin;

select public.dev_set_now('2026-11-14 12:00+00');
update public.event_config set
  timezone = 'Europe/Rome', group_schedule = null,
  rules = rules || '{"winner_points": {"RR": 8, "SF": 13, "F": 20}, "sets_points": {"RR": 4, "SF": 6, "F": 10}}';

select t.as_service();
select public.set_players(
  (select jsonb_agg(jsonb_build_object('id', p, 'name', 'Player ' || upper(p), 'seed', n, 'rank', n) order by n)
     from unnest(array['a','b','c','d','e','f','g','h','i','j','k','l']) with ordinality as x(p, n)),
  (select jsonb_agg(m order by (m->>'match_no')::int) from (
     select jsonb_build_object('match_no', (gi - 1) * 6 + k, 'round', 'RR', 'group', gname,
              'p1', jsonb_build_object('type', 'player', 'id', ids[pr[1]]),
              'p2', jsonb_build_object('type', 'player', 'id', ids[pr[2]])) as m
       from (values (1, 'North', array['a','b','c','d']), (2, 'South', array['e','f','g','h']),
                    (3, 'West', array['i','j','k','l'])) grp(gi, gname, ids)
      cross join lateral (values (1, array[1,4]), (2, array[2,3]), (3, array[1,2]), (4, array[1,3]),
                                 (5, array[2,4]), (6, array[3,4])) pairs(k, pr)
     union all
     select jsonb_build_object('match_no', 18 + gi, 'round', 'SF',
              'p1', jsonb_build_object('type', 'group', 'group', gname, 'place', 1),
              'p2', jsonb_build_object('type', 'group', 'group', gname, 'place', 2))
       from (values (1, 'North'), (2, 'South'), (3, 'West')) grp(gi, gname)) z));
select public.set_match_start(n, '2026-11-15 14:00+01') from generate_series(1, 18) n;
select public.set_match_start(n, '2026-11-21 14:00+01') from generate_series(19, 21) n;
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 21) n
union all
select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','e','f','g','h','i','j','k','l']) p
on conflict do nothing;
select t.as_owner();

select public.dev_set_now('2026-11-20 23:00+00');

-- North: a beat b 2-1, b beat c 2-0, c beat a when a RETIRED after winning the first set (6-4 2-1),
-- everyone beat d 2-0. ATP: the retirement is a straight-set loss for a (0-2), so
--   b 5-2 sets (71%), c 4-2 (67%), a 4-3 (57%) → b, c, a, d.
-- (Counting only the finished sets, as 0053 did, gave a 5-1 → a first and c last: the wrong semi-final.)
select t.check('North 1 a v d', t.feed(1, 'completed', 'a', '6-1 6-1')->>'outcome' = 'settled');
select t.check('North 2 b v c', t.feed(2, 'completed', 'b', '6-3 6-3')->>'outcome' = 'settled');
select t.check('North 3 a v b', t.feed(3, 'completed', 'a', '6-4 3-6 6-4')->>'outcome' = 'settled');
select t.check('North 4 a v c: a retires after winning the first set',
  t.feed(4, 'retired', 'c', '6-4 2-1')->>'outcome' = 'settled');
select t.check('North 5 b v d', t.feed(5, 'completed', 'b', '6-2 6-2')->>'outcome' = 'settled');
select t.check('North 6 c v d', t.feed(6, 'completed', 'c', '6-2 6-2')->>'outcome' = 'settled');
select t.check('a retirement counts as a straight-set loss: b, c, a, d',
  (select array_agg(player_id order by place) = array['b','c','a','d'] from public.group_standings('North')),
  (select string_agg(place || ':' || player_id, ' ' order by place) from public.group_standings('North')));
select t.check('the semi-final gets b and c',
  (select p1_id = 'b' and p2_id = 'c' from public.matches where match_no = 19),
  (select coalesce(p1_id, '?') || '-' || coalesce(p2_id, '?') from public.matches where match_no = 19));

-- South: e beat f, f beat g, g beat e, all 2-0; everyone beat h 2-0, e by h's retirement at 3-1.
-- Sets: e, f, g all 4-2 → level; % of games would decide, in a group with a retirement → the operator.
select t.check('South 7 e v h: h retires at 3-1', t.feed(7, 'retired', 'e', '3-1')->>'outcome' = 'settled');
select t.check('South 8 f v g', t.feed(8, 'completed', 'f', '6-4 6-4')->>'outcome' = 'settled');
select t.check('South 9 e v f', t.feed(9, 'completed', 'e', '6-4 6-4')->>'outcome' = 'settled');
select t.check('South 10 e v g', t.feed(10, 'completed', 'g', '4-6 4-6')->>'outcome' = 'settled');
select t.check('South 11 f v h', t.feed(11, 'completed', 'f', '6-1 6-1')->>'outcome' = 'settled');
select t.check('South 12 g v h', t.feed(12, 'completed', 'g', '6-2 6-2')->>'outcome' = 'settled');
select t.check('three level on sets after a retirement: no automatic order',
  not exists (select 1 from public.group_standings('South')),
  (select string_agg(place || ':' || player_id, ' ' order by place) from public.group_standings('South')));
select t.check('the South semi-final waits for the operator',
  (select p1_id is null and p2_id is null from public.matches where match_no = 20)
  and exists (select 1 from public.ops_alerts where kind = 'group_standings_manual' and detail->>'group' = 'South'));

-- West: i beat l by walkover; otherwise i 3-0. → the operator (no ATP text on a walkover's sets/games).
select t.check('West 13 i v l: walkover', t.feed(13, 'walkover', 'i', '')->>'outcome' = 'settled');
select t.check('West 14 j v k', t.feed(14, 'completed', 'j', '6-3 6-3')->>'outcome' = 'settled');
select t.check('West 15 i v j', t.feed(15, 'completed', 'i', '6-3 6-3')->>'outcome' = 'settled');
select t.check('West 16 i v k', t.feed(16, 'completed', 'i', '6-3 6-3')->>'outcome' = 'settled');
select t.check('West 17 j v l', t.feed(17, 'completed', 'j', '6-3 6-3')->>'outcome' = 'settled');
select t.check('West 18 k v l', t.feed(18, 'completed', 'k', '6-3 6-3')->>'outcome' = 'settled');
select t.check('a group with a walkover is left to the operator',
  not exists (select 1 from public.group_standings('West'))
  and exists (select 1 from public.ops_alerts where kind = 'group_standings_manual' and detail->>'group' = 'West'));

select * from t.report();
rollback;
