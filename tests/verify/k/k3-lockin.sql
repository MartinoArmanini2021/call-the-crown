-- =====================================================================================================
-- Section K lock-ins (K3, K4, K5, K6). Every check here PASSES today and must FAIL if a future migration
-- reopens a function, loosens a default privilege, adds an unpinned SECURITY DEFINER function or a
-- write-through view, or grants a fan a direct write.
-- Style of supabase/tests/*.sql: runs inside begin … rollback after _prelude.sql (t.* helpers).
--   bun test tests/verify/k/k.test.ts          (PGlite, via the test runner in that file)
-- =====================================================================================================
begin;

-- ---------------------------------------------------------------------------------------------------
-- K3: the operator / settlement / ingest / billing functions are not executable by anon or a fan.
-- ---------------------------------------------------------------------------------------------------
create temp table k3_fn (name text primary key);
insert into k3_fn values
  ('settle_match'), ('set_players'), ('set_match_start'), ('lock_match_now'), ('pause_settlement'),
  ('request_refetch'), ('reseat_paused_match'),
  ('ingest_result'), ('ingest_heartbeat'), ('kick_poller'), ('watchdog'), ('watchdog_check'),
  ('export_optins'), ('billing_report'), ('snapshot_billing'), ('hand_over_leagues'), ('close_rank_gap'),
  ('rank_new_fan');

select t.check('K3 every listed function exists in public',
  not exists (select 1 from k3_fn f where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.name)),
  (select string_agg(f.name, ',') from k3_fn f where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.name)));

select t.check('K3 ' || f.name || ': not executable by anon, authenticated or PUBLIC (every overload)',
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.name
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or p.proacl is null                                   -- null ACL = default = PUBLIC execute
            or exists (select 1 from aclexplode(p.proacl) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))))
  from k3_fn f order by f.name;

-- And by calling them, as a fan and as anon (the error must be a privilege refusal, not a guard).
select t.as_user('00000000-0000-0000-0000-00000000ffff');
select t.check('K3 a fan calling settle_match / ingest_result / set_players / billing_report is refused',
  t.err($$ select public.settle_match(1, 'completed', 'c', '[]') $$) like 'permission denied%'
  and t.err($$ select public.ingest_result('fixture', '{}', '{}', 200) $$) like 'permission denied%'
  and t.err($$ select public.set_players('[]', null) $$) like 'permission denied%'
  and t.err($$ select public.billing_report() $$) like 'permission denied%'
  and t.err($$ select public.lock_match_now(1) $$) like 'permission denied%'
  and t.err($$ select * from public.export_optins('organiser') $$) like 'permission denied%');
select t.as_anon();
select t.check('K3 anon calling kick_poller / watchdog / snapshot_billing / reseat_paused_match is refused',
  t.err($$ select public.kick_poller() $$) like 'permission denied%'
  and t.err($$ select public.watchdog() $$) like 'permission denied%'
  and t.err($$ select public.snapshot_billing() $$) like 'permission denied%'
  and t.err($$ select public.reseat_paused_match(1) $$) like 'permission denied%');
select t.as_owner();

-- The whole public surface, pinned: a new fan-callable function must be added here on purpose.
select t.check('K3 the exact set of functions a fan can execute is the reviewed list',
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  = array['app_now', 'create_league', 'delete_account', 'delete_league', 'get_leaderboard', 'get_league_picks',
          'get_match_crowd', 'get_rank_window', 'join_league', 'leave_league', 'my_league_ids', 'my_leagues',
          'remove_member', 'save_pick', 'update_consents', 'update_profile'],
  (select array_to_string(array_agg(p.proname::text order by p.proname), ',') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
select t.check('K3 anon can execute only app_now',
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')) = array['app_now']);
select t.check('K3 no public function has a PUBLIC (or default/null) EXECUTE grant',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a
                                                    where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
  (select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))));

-- ---------------------------------------------------------------------------------------------------
-- K4: default privileges. A function, table or sequence created now by the migration owner reaches
-- nobody until a grant says so.
-- ---------------------------------------------------------------------------------------------------
create function public.k4_probe_fn() returns int language sql as $$ select 1 $$;
create table public.k4_probe_tbl (id int generated always as identity primary key, v int);
select t.check('K4 a new function is not executable by PUBLIC, anon, authenticated or service_role',
  not has_function_privilege('anon', 'public.k4_probe_fn()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.k4_probe_fn()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.k4_probe_fn()', 'EXECUTE')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'public.k4_probe_fn()'::regprocedure and a.grantee = 0));
select t.check('K4 a new table gives anon / authenticated / service_role nothing',
  not has_table_privilege('anon', 'public.k4_probe_tbl', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.k4_probe_tbl', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.k4_probe_tbl', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
select t.check('K4 a new sequence gives anon / authenticated nothing',
  not has_sequence_privilege('anon', 'public.k4_probe_tbl_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('authenticated', 'public.k4_probe_tbl_id_seq', 'USAGE,SELECT,UPDATE'));
select t.check('K4 pg_default_acl: a global "revoke execute on functions from public" exists for the owner',
  exists (select 1 from pg_default_acl d
           where d.defaclnamespace = 0 and d.defaclobjtype = 'f'
             and d.defaclrole = (select relowner from pg_class where oid = 'public.picks'::regclass)
             and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)));
drop function public.k4_probe_fn();
drop table public.k4_probe_tbl;

-- ---------------------------------------------------------------------------------------------------
-- K5: every SECURITY DEFINER function pins search_path, and every fan-callable one refuses (or returns
-- nothing) without a signed-in user.
-- ---------------------------------------------------------------------------------------------------
select t.check('K5 every SECURITY DEFINER function in public has a pinned search_path',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosecdef
                 and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  (select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
select t.check('K5 no SECURITY DEFINER function puts a user-writable schema before pg_catalog (search_path = public only)',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                   unnest(coalesce(p.proconfig, '{}')) c
               where n.nspname = 'public' and p.prosecdef and c like 'search_path=%'
                 and c not in ('search_path=public', 'search_path=""', 'search_path=pg_catalog, public')));
select t.check('K5 no role but the owner can CREATE in schema public (a definer search_path=public is safe)',
  not has_schema_privilege('anon', 'public', 'CREATE')
  and not has_schema_privilege('authenticated', 'public', 'CREATE')
  and not has_schema_privilege('service_role', 'public', 'CREATE'));

-- A JWT with role authenticated but no sub: every fan RPC refuses or returns nothing.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select t.check('K5 no user: every writing fan RPC raises not_signed_in',
  t.err($$ select public.save_pick(1, 'c', 2, '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]') $$) = 'not_signed_in'
  and t.err($$ select public.create_league('x') $$) = 'not_signed_in'
  and t.err($$ select public.join_league('ABCDEF') $$) = 'not_signed_in'
  and t.err($$ select public.leave_league(gen_random_uuid()) $$) = 'not_signed_in'
  and t.err($$ select public.remove_member(gen_random_uuid(), gen_random_uuid()) $$) = 'not_signed_in'
  and t.err($$ select public.delete_league(gen_random_uuid()) $$) = 'not_signed_in'
  and t.err($$ select public.update_profile('Name') $$) = 'not_signed_in'
  and t.err($$ select public.update_consents(true, true, 'v') $$) = 'not_signed_in'
  and t.err($$ select public.delete_account() $$) = 'not_signed_in');
select t.check('K5 no user: board RPCs raise not_signed_in, list RPCs return nothing',
  t.err($$ select * from public.get_leaderboard() $$) = 'not_signed_in'
  and t.err($$ select * from public.get_rank_window() $$) = 'not_signed_in'
  and t.err($$ select * from public.get_league_picks(gen_random_uuid(), 1) $$) = 'not_signed_in'
  and (select count(*) from public.my_leagues()) = 0
  and (select count(*) from public.my_league_ids()) = 0);
reset role;
select t.as_owner();

-- K5: no fan-callable function takes a user id except remove_member (owner-checked, see the report).
select t.check('K5 the only fan-callable function with a uuid user parameter is remove_member(p_league, p_user)',
  (select array_agg(distinct p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
          unnest(coalesce((p.proargnames)[1:p.pronargs], '{}')) a(name)  -- input arguments only
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and a.name ~* 'user|uid|owner|member|fan') = array['remove_member']);

-- ---------------------------------------------------------------------------------------------------
-- K6: no write-through views. Any view in public must be security_invoker and not writable by a fan.
-- ---------------------------------------------------------------------------------------------------
select t.check('K6 no view in public writes through (security_invoker off + granted write to anon/authenticated)',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
       and (not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)
            or has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE')
            or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE'))),
  (select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')));

-- ---------------------------------------------------------------------------------------------------
-- K2 lock-in: the table grants for anon and authenticated are exactly the reviewed SELECTs.
-- ---------------------------------------------------------------------------------------------------
select t.check('K2 anon holds SELECT on event_config, matches, players and nothing else',
  (select array_agg(c.relname::text || ':' || p order by c.relname, p)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace,
          unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and has_table_privilege('anon', c.oid, p))
  = array['event_config:SELECT', 'matches:SELECT', 'players:SELECT']);
select t.check('K2 authenticated holds SELECT on 8 tables and nothing else',
  (select array_agg(c.relname::text || ':' || p order by c.relname, p)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace,
          unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and has_table_privilege('authenticated', c.oid, p))
  = array['consents:SELECT', 'event_config:SELECT', 'league_members:SELECT', 'leagues:SELECT',
          'matches:SELECT', 'picks:SELECT', 'players:SELECT', 'profiles:SELECT'],
  (select array_to_string(array_agg(c.relname::text || ':' || p order by c.relname, p), ',')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace,
          unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') and has_table_privilege('authenticated', c.oid, p)));
select t.check('K2 every public table has RLS on',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity));
select t.check('K2 no policy grants anon or authenticated anything but SELECT',
  not exists (select 1 from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
                 and roles && array['anon', 'authenticated', 'public']::name[]));

select * from t.report();
rollback;
