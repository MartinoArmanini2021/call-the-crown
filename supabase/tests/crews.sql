-- =====================================================================================================
-- Crews (0021, brief "bragging rights", Phase 4): leagues of 5+ members ranked by the average points
-- of their best 5; ties by the best 5's exact sets, then the older league, then id; hidden leagues
-- never shown; the caller's own leagues shown beyond the limit; no counts in the output.
-- Runs inside begin … rollback (bun run test:sql crews).
-- =====================================================================================================
begin;

select t.setup_event();
select t.check('the minimum is configured: 5 members',
  (select (league_limits->>'crew_min_members')::int from public.event_config) = 5);
select t.check('a new league is not hidden',
  (select column_default = 'false' and is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'leagues' and column_name = 'crew_hidden'));

select t.new_user(n) from generate_series(1, 40) n;

-- Points and exact sets as settlement would leave them (the guard lets only settlement write them).
select set_config('skg.settling', '1', true);
update public.standings s set points = v.p, exact_sets = v.e
  from (values
    -- Four Friends: 4 members, 100 each (excluded: too small); with fan 10, Hidden Heroes
    (1, 100, 0), (2, 100, 0), (3, 100, 0), (4, 100, 0),
    -- The Cs: 50 40 30 20 10 → 30.0, exact 0
    (5, 50, 0), (6, 40, 0), (7, 30, 0), (8, 20, 0), (9, 10, 0),
    -- Eight Mates: 90 80 70 60 50 | 10 5 0 → best 5 = 70.0 (all 8 would be 45.6)
    (10, 90, 1), (11, 80, 1), (12, 70, 1), (13, 60, 1), (14, 50, 1), (15, 10, 0), (16, 5, 0), (17, 0, 0),
    -- Team A: 30 each, exact 2 each (10)
    (18, 30, 2), (19, 30, 2), (20, 30, 2), (21, 30, 2), (22, 30, 2),
    -- Team B: 30 each, exact 1 each (5)
    (23, 30, 1), (24, 30, 1), (25, 30, 1), (26, 30, 1), (27, 30, 1),
    -- The Ds: 30 each, exact 0, made after The Cs
    (28, 30, 0), (29, 30, 0), (30, 30, 0), (31, 30, 0), (32, 30, 0),
    -- Zed: 10 each; fan 37 has no standings row (deleted below) → (10·4 + 0) / 5 = 8.0
    (33, 10, 0), (34, 10, 0), (35, 10, 0), (36, 10, 0), (37, 10, 0)
  ) v(n, p, e)
 where s.user_id = t.uid(v.n);
select set_config('skg.settling', '0', true);
delete from public.standings where user_id = t.uid(37);

insert into public.leagues (id, name, code, owner_id, created_at) values
  ('00000000-0000-0000-0000-0000000000a4', 'Four Friends', 'CRW004', t.uid(1),  '2026-10-01'),
  ('00000000-0000-0000-0000-0000000000c5', 'The Cs',       'CRW00C', t.uid(5),  '2026-10-02'),
  ('00000000-0000-0000-0000-0000000000e8', 'Eight Mates',  'CRW008', t.uid(10), '2026-10-03'),
  ('00000000-0000-0000-0000-0000000000aa', 'Team A',       'CRW00A', t.uid(18), '2026-10-04'),
  ('00000000-0000-0000-0000-0000000000bb', 'Team B',       'CRW00B', t.uid(23), '2026-10-05'),
  ('00000000-0000-0000-0000-0000000000dd', 'The Ds',       'CRW00D', t.uid(28), '2026-10-06'),
  ('00000000-0000-0000-0000-0000000000ff', ' Zed   league name that runs on ', 'CRW00Z', t.uid(33), '2026-10-07'),
  ('00000000-0000-0000-0000-0000000000e1', 'Hidden Heroes', 'CRW00H', t.uid(1), '2026-09-30');
insert into public.league_members (league_id, user_id)
select l::uuid, t.uid(n) from (values
  ('00000000-0000-0000-0000-0000000000a4', 1), ('00000000-0000-0000-0000-0000000000a4', 2),
  ('00000000-0000-0000-0000-0000000000a4', 3), ('00000000-0000-0000-0000-0000000000a4', 4)) v(l, n)
union all select '00000000-0000-0000-0000-0000000000c5', t.uid(n) from generate_series(5, 9) n
union all select '00000000-0000-0000-0000-0000000000e8', t.uid(n) from generate_series(10, 17) n
union all select '00000000-0000-0000-0000-0000000000aa', t.uid(n) from generate_series(18, 22) n
union all select '00000000-0000-0000-0000-0000000000bb', t.uid(n) from generate_series(23, 27) n
union all select '00000000-0000-0000-0000-0000000000dd', t.uid(n) from generate_series(28, 32) n
union all select '00000000-0000-0000-0000-0000000000ff', t.uid(n) from generate_series(33, 37) n
union all select '00000000-0000-0000-0000-0000000000e1', t.uid(n) from generate_series(1, 5) n;
-- Staff hide a league by SQL (no function exposes the flag).
update public.leagues set crew_hidden = true where id = '00000000-0000-0000-0000-0000000000e1';

select t.as_user(t.uid(40));
create temp table board on commit drop as select * from public.get_crew_board(10);
grant select on board to public;

select t.check('a 4-member league is excluded',
  not exists (select 1 from board where league_id = '00000000-0000-0000-0000-0000000000a4'));
select t.check('a 5-member league is included (The Cs, 30.0)',
  exists (select 1 from board where league_id = '00000000-0000-0000-0000-0000000000c5' and avg_points = 30.0));
select t.check('an 8-member league averages only its best 5 (70.0, not 45.6) and leads',
  (select (rank, avg_points) = (1, 70.0) from board where league_id = '00000000-0000-0000-0000-0000000000e8'));
select t.check('a hidden league is excluded (it would lead with 90.0)',
  not exists (select 1 from board where league_id = '00000000-0000-0000-0000-0000000000e1'));
select t.check('tiebreak at 30.0: more exact sets first (Team A, Team B), then the older league (The Cs, The Ds)',
  (select array_agg(name order by rank) from board where avg_points = 30.0)
    = array['Team A', 'Team B', 'The Cs', 'The Ds']);
select t.check('a member with no standings row counts as 0 (Zed 8.0)',
  (select avg_points = 8.0 from board where league_id = '00000000-0000-0000-0000-0000000000ff'));
select t.check('names cleaned like display names and cut to 24 characters',
  (select name = 'Zed league name that run' from board where league_id = '00000000-0000-0000-0000-0000000000ff'));
select t.check('ranks are strict 1..6 for a fan in no league, none mine',
  (select array_agg(rank order by rank) = array[1, 2, 3, 4, 5, 6] and not bool_or(is_mine) from board));

select t.as_user(t.uid(33));
select t.check('the caller''s own league appears beyond p_limit (top 2 + Zed at #6)',
  (select array_agg(rank order by rank) = array[1, 2, 6] from public.get_crew_board(2)));
select t.check('… marked as theirs',
  (select is_mine from public.get_crew_board(2) where rank = 6));
select t.check('a huge p_limit is accepted (capped at 50 inside)',
  (select count(*) from public.get_crew_board(100000)) = 6);

select t.check('no count columns in the output (rank, league_id, name, avg_points, is_mine only)',
  (select pg_get_function_result('public.get_crew_board(integer)'::regprocedure))
    = 'TABLE(rank integer, league_id uuid, name text, avg_points numeric, is_mine boolean)');

select t.as_user(null);
select t.check('no signed-in user: no rows', (select count(*) from public.get_crew_board(10)) = 0);
select t.as_anon();
select t.check('anon cannot call it', t.err('select * from public.get_crew_board(10)') like '%permission denied%');

select t.as_owner();
select t.check('security definer, search_path = public, stable',
  (select prosecdef and provolatile = 's' and proconfig @> array['search_path=public']
     from pg_proc where oid = 'public.get_crew_board(integer)'::regprocedure));
select t.check('execute: authenticated only (not public, not anon)',
  has_function_privilege('authenticated', 'public.get_crew_board(integer)', 'execute')
  and not has_function_privilege('anon', 'public.get_crew_board(integer)', 'execute'));
select t.check('no function takes or returns crew_hidden',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and pg_get_function_result(p.oid) like '%crew_hidden%'));

select * from t.report();
rollback;
