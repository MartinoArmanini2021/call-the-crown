-- =====================================================================================================
-- Settlement benchmark: 100,000 fans with a pick on one match, then the provider's final result.
-- Brief: settling a match for 100,000 users must finish in under 30 s.
-- Everything happens inside one transaction that ends in ROLLBACK: no fan, pick or result survives.
-- Run on STAGING after sign-off (psql "$STAGING_DB_URL" -f loadtest/settle-100k.sql), never on
-- production. Locally: bun scripts/settle-benchmark.ts (in-process Postgres, much slower than a server).
-- Needs an event with players on match 1 (supabase/events/*.sql + set_players).
-- The fans are invented: load<N>@example.test, flagged is_test so billing would exclude them anyway.
-- =====================================================================================================
begin;

create temp table bench (step text, ms numeric);
create temp table t0 as select clock_timestamp() as at;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select gen_random_uuid(), 'load' || g || '@example.test', now(), '{"display_name": "Load test"}'
  from generate_series(1, 100000) g;
update public.profiles set is_test = true where user_id in (select id from auth.users where email like 'load%@example.test');
insert into bench select 'create 100,000 accounts', extract(epoch from clock_timestamp() - at) * 1000 from t0;

-- Each fan: a random winner, 2 or 3 sets, legal random set scores (from the configured list), in the
-- match's player order. sa/sb/sc = sets won by the picked winner, sl = the set the loser took.
-- (Inserted directly: this is fixture data inside a rolled-back transaction, not a save_pick path.)
update t0 set at = clock_timestamp();
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
select r.id, 1, case when r.w = 1 then m.p1_id else m.p2_id end, r.s,
       case when r.s = 2 then jsonb_build_array(sa.x, sb.x) else jsonb_build_array(sa.x, sl.x, sc.x) end
  from (select id, 1 + (random() < 0.5)::int as w, 2 + (random() < 0.4)::int as s,
               1 + floor(random() * 7)::int as a, 1 + floor(random() * 7)::int as b, 1 + floor(random() * 7)::int as c
          from auth.users where email like 'load%@example.test') r
 cross join public.matches m
 cross join lateral (select (select rules->'allowed_set_scores' from public.event_config) as allowed) cfg
 cross join lateral (select case when r.w = 1 then jsonb_build_object('p1_games', cfg.allowed->(r.a - 1)->0, 'p2_games', cfg.allowed->(r.a - 1)->1)
                                 else jsonb_build_object('p1_games', cfg.allowed->(r.a - 1)->1, 'p2_games', cfg.allowed->(r.a - 1)->0) end as x) sa
 cross join lateral (select case when r.w = 1 then jsonb_build_object('p1_games', cfg.allowed->(r.b - 1)->0, 'p2_games', cfg.allowed->(r.b - 1)->1)
                                 else jsonb_build_object('p1_games', cfg.allowed->(r.b - 1)->1, 'p2_games', cfg.allowed->(r.b - 1)->0) end as x) sb
 cross join lateral (select case when r.w = 1 then jsonb_build_object('p1_games', cfg.allowed->(r.b - 1)->1, 'p2_games', cfg.allowed->(r.b - 1)->0)
                                 else jsonb_build_object('p1_games', cfg.allowed->(r.b - 1)->0, 'p2_games', cfg.allowed->(r.b - 1)->1) end as x) sl
 cross join lateral (select case when r.w = 1 then jsonb_build_object('p1_games', cfg.allowed->(r.c - 1)->0, 'p2_games', cfg.allowed->(r.c - 1)->1)
                                 else jsonb_build_object('p1_games', cfg.allowed->(r.c - 1)->1, 'p2_games', cfg.allowed->(r.c - 1)->0) end as x) sc
 where m.match_no = 1;
insert into bench select 'insert 100,000 picks', extract(epoch from clock_timestamp() - at) * 1000 from t0;

-- The match has started (inside this transaction only) and the provider ids are mapped.
update public.matches set starts_at = public.app_now() - interval '2 hours' where match_no = 1;
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'bench', 'match', 'bench-m1', '1'
union all select 'bench', 'player', 'bench-' || p1_id, p1_id from public.matches where match_no = 1
union all select 'bench', 'player', 'bench-' || p2_id, p2_id from public.matches where match_no = 1;

-- THE MEASUREMENT: one provider payload → validate, log, score 100,000 picks, rebuild every
-- standing with strict ranks, fill the next round. One transaction, as in production.
update t0 set at = clock_timestamp();
select public.ingest_result('bench',
  jsonb_build_object('match_ref', 'bench-m1', 'status', 'completed',
                     'players', jsonb_build_array('bench-' || p1_id, 'bench-' || p2_id),
                     'winner', 'bench-' || p1_id,
                     'set_scores', '[{"p1_games": 6, "p2_games": 4}, {"p1_games": 3, "p2_games": 6}, {"p1_games": 7, "p2_games": 6}]'::jsonb),
  '{"bench": true}'::jsonb)->>'outcome' as outcome
  from public.matches where match_no = 1;
insert into bench select 'SETTLE: score 100,000 picks + rebuild standings', extract(epoch from clock_timestamp() - at) * 1000 from t0;

select step, round(ms) as ms,
       case when step like 'SETTLE%' then case when ms < 30000 then 'PASS (< 30 s)' else 'FAIL (>= 30 s)' end end as result
  from bench;
select count(*) filter (where pts_total is not null) as picks_scored,
       count(*) filter (where pts_total > 0) as picks_with_points,
       (select count(*) from public.standings where rank is not null) as ranked_standings,
       (select count(distinct rank) = count(*) from public.standings) as ranks_strict
  from public.picks where match_no = 1;

rollback;
