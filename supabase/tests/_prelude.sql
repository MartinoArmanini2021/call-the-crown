-- =====================================================================================================
-- TEST ONLY — helpers shared by the SQL test files. Loaded once into the throwaway test database by
-- scripts/test-sql.ts, after the migrations, the simulated clock and the event file.
-- Every test file runs inside begin … rollback, so nothing a test does survives it.
-- All people here are invented (fanN@example.test). All players are invented (Player A … F).
-- Pattern from tennis-fantasy/supabase/six_kings_picks_tests.sql (pose as users inside a rolled-back
-- transaction and report PASS/FAIL per check).
-- =====================================================================================================

create schema t;
grant usage on schema t to public;

create table t.r (seq serial primary key, name text not null, ok boolean not null, detail text);
grant all on t.r to public;
grant all on sequence t.r_seq_seq to public;

-- Record one check.
create function t.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql
as $$ insert into t.r (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;

-- Run a statement as whoever is current; null when it succeeds, otherwise the error message.
create function t.err(p_sql text) returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- Become a signed-in fan, an anonymous visitor, the operator (service role), or the owner again.
create function t.as_user(p_uid uuid) returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function t.as_anon() returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  execute 'set local role anon';
end;
$$;
create function t.as_service() returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
end;
$$;
create function t.as_owner() returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- A verified fan with both consents as given. created_at is spaced so the last-resort tiebreaker is
-- deterministic in tests.
create function t.new_user(p_n int, p_name text default null, p_org boolean default false,
                           p_gsgm boolean default false, p_verified boolean default true) returns uuid
language sql
as $$
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid,
          'fan' || p_n || '@example.test',
          case when p_verified then now() end,
          jsonb_build_object('display_name', coalesce(p_name, 'Fan ' || p_n),
                             'consent_organiser', p_org, 'consent_gsgm', p_gsgm,
                             'consent_text_version', 'test-1'),
          timestamptz '2026-10-01 00:00+00' + make_interval(mins => p_n))
  returning id
$$;
create function t.uid(p_n int) returns uuid
language sql immutable
as $$ select ('00000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;

-- A set-score array from text: '6-4 3-6 6-3' → [{p1_games 6, p2_games 4}, …]
create function t.ss(p_text text) returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('p1_games', split_part(s, '-', 1)::int,
                                               'p2_games', split_part(s, '-', 2)::int) order by o), '[]')
    from regexp_split_to_table(btrim(p_text), '\s+') with ordinality as x(s, o)
   where s <> ''
$$;

-- The standard test bracket, built by the operator RPCs exactly as the runbook says.
--   A seed 1 (rank 1) and B seed 2 (rank 2) have byes.
--   QF1 (1): C rank 3 v F rank 10    QF2 (2): D rank 5 v E rank 7
--   SF1 (3): A v winner QF1          SF2 (4): B v winner QF2
--   3P  (5): loser SF1 v loser SF2   F   (6): winner SF1 v winner SF2
-- Clock: 20 Oct 2026 12:00 UTC (the day before). Provider "fixture" ids: fx-m<n>, fx-<player>.
create function t.setup_event() returns void
language plpgsql
as $$
begin
  perform public.dev_set_now('2026-10-20 12:00+00');
  perform t.as_service();
  perform public.set_players(
    '[{"id":"a","name":"Player A","seed":1,"rank":1},{"id":"b","name":"Player B","seed":2,"rank":2},
      {"id":"c","name":"Player C","seed":3,"rank":3},{"id":"d","name":"Player D","seed":4,"rank":5},
      {"id":"e","name":"Player E","seed":5,"rank":7},{"id":"f","name":"Player F","seed":6,"rank":10}]',
    '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"c"},"p2":{"type":"player","id":"f"}},
      {"match_no":2,"round":"QF","p1":{"type":"player","id":"d"},"p2":{"type":"player","id":"e"}},
      {"match_no":3,"round":"SF","p1":{"type":"player","id":"a"},"p2":{"type":"winner","match":1}},
      {"match_no":4,"round":"SF","p1":{"type":"player","id":"b"},"p2":{"type":"winner","match":2}},
      {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},"p2":{"type":"loser","match":4}},
      {"match_no":6,"round":"F","p1":{"type":"winner","match":3},"p2":{"type":"winner","match":4}}]');
  perform public.set_match_start(1, '2026-10-21 16:30+00');
  perform public.set_match_start(2, '2026-10-21 17:40+00');
  perform public.set_match_start(3, '2026-10-22 16:30+00');
  perform public.set_match_start(4, '2026-10-22 18:20+00');
  perform public.set_match_start(5, '2026-10-24 16:30+00');
  perform public.set_match_start(6, '2026-10-24 18:40+00');
  insert into public.provider_map (provider, kind, provider_ref, our_ref)
  select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 6) n
  union all
  select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','e','f']) p;
  perform t.as_owner();
end;
$$;

-- The provider says match n finished: players in our order, set scores in text.
create function t.feed(p_match int, p_status text, p_winner text, p_sets text, p_flip boolean default false,
                       p_provider text default 'fixture')
returns jsonb
language plpgsql
as $$
declare
  m      public.matches%rowtype;
  v_norm jsonb;
  v_out  jsonb;
  v_ss   jsonb := t.ss(p_sets);
begin
  select * into m from public.matches where match_no = p_match;
  if p_flip then
    select coalesce(jsonb_agg(jsonb_build_object('p1_games', e->'p2_games', 'p2_games', e->'p1_games')
                              order by o), '[]')
      into v_ss from jsonb_array_elements(v_ss) with ordinality x(e, o);
  end if;
  v_norm := jsonb_build_object(
    'match_ref', 'fx-m' || p_match, 'status', p_status,
    'players', case when p_flip then jsonb_build_array('fx-' || m.p2_id, 'fx-' || m.p1_id)
                    else jsonb_build_array('fx-' || m.p1_id, 'fx-' || m.p2_id) end,
    'winner', 'fx-' || p_winner, 'set_scores', v_ss);
  perform t.as_service();
  v_out := public.ingest_result(p_provider, v_norm, jsonb_build_object(p_provider, v_norm));
  perform t.as_owner();
  return v_out;
end;
$$;

-- Save a pick as a fan; null on success, otherwise the error.
create function t.pick(p_uid uuid, p_match int, p_winner text, p_sets text) returns text
language plpgsql
as $$
declare v_err text;
begin
  perform t.as_user(p_uid);
  v_err := t.err(format('select public.save_pick(%s, %L, %s, %L::jsonb)',
                        p_match, p_winner, jsonb_array_length(t.ss(p_sets)), t.ss(p_sets)));
  perform t.as_owner();
  return v_err;
end;
$$;

-- A pick's stored breakdown as 'winner/sets/exact/total'.
create function t.pts(p_uid uuid, p_match int) returns text
language sql
as $$ select concat_ws('/', pts_winner, pts_sets, pts_exact, pts_total) from public.picks
       where user_id = p_uid and match_no = p_match $$;

-- The report every test file ends with.
create function t.report() returns table (name text, result text, detail text)
language sql
as $$ select name, case when ok then 'PASS' else 'FAIL' end, detail from t.r order by seq $$;

grant execute on all functions in schema t to public;
