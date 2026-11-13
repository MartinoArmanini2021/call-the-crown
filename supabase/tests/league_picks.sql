-- =====================================================================================================
-- League picks (0061, 13 Nov 2026): who picked what among the people you share a league with, only
-- once the match has started; nothing for strangers, test accounts or a caller in no league; no ids.
-- Runs inside begin … rollback (bun run test:sql league_picks).
-- =====================================================================================================
begin;

select t.setup_event();
-- fans 1-3 share the league "Friends"; fan 4 is in "Others" with fan 3; fan 5 is in no league;
-- fan 6 is a test account in "Friends"
select t.new_user(n) from generate_series(1, 6) n;
update public.profiles set is_test = true where user_id = t.uid(6);
insert into public.leagues (id, name, code, owner_id) values
  ('00000000-0000-0000-0000-00000000aa01', 'Friends', 'FRIENDS1', t.uid(1)),
  ('00000000-0000-0000-0000-00000000aa02', 'Others',  'OTHERS01', t.uid(4));
insert into public.league_members (league_id, user_id) values
  ('00000000-0000-0000-0000-00000000aa01', t.uid(1)),
  ('00000000-0000-0000-0000-00000000aa01', t.uid(2)),
  ('00000000-0000-0000-0000-00000000aa01', t.uid(3)),
  ('00000000-0000-0000-0000-00000000aa01', t.uid(6)),
  ('00000000-0000-0000-0000-00000000aa02', t.uid(3)),
  ('00000000-0000-0000-0000-00000000aa02', t.uid(4));

-- everyone picks match 1 (C v F, starts 21 Oct 16:30 UTC) the day before
select t.check('picks saved',
  t.pick(t.uid(1), 1, 'c', '6-4 6-4') is null and t.pick(t.uid(2), 1, 'f', '4-6 4-6') is null
  and t.pick(t.uid(3), 1, 'c', '6-3 6-3') is null and t.pick(t.uid(4), 1, 'f', '3-6 3-6') is null
  and t.pick(t.uid(5), 1, 'c', '7-5 7-5') is null and t.pick(t.uid(6), 1, 'c', '6-0 6-0') is null);

create function pg_temp.names(p_uid uuid, p_match int) returns text
language plpgsql as $$
declare v text;
begin
  perform t.as_user(p_uid);
  select string_agg(display_name || case when is_me then '*' else '' end, ',' order by display_name)
    into v from public.get_league_picks(p_match);
  perform t.as_owner();
  return coalesce(v, '');
end;
$$;

-- before the start: nothing, for anyone
select t.check('before the start nobody sees anything', pg_temp.names(t.uid(1), 1) = '');

-- the lock passes
select public.dev_set_now('2026-10-21 16:31+00');
select t.check('fan 1 sees the Friends (and not the test account, fan 4 or fan 5)',
  pg_temp.names(t.uid(1), 1) = 'Fan 1*,Fan 2,Fan 3', pg_temp.names(t.uid(1), 1));
select t.check('fan 3 sees both leagues, each fan once',
  pg_temp.names(t.uid(3), 1) = 'Fan 1,Fan 2,Fan 3*,Fan 4', pg_temp.names(t.uid(3), 1));
select t.check('fan 4 sees only Others',
  pg_temp.names(t.uid(4), 1) = 'Fan 3,Fan 4*', pg_temp.names(t.uid(4), 1));
select t.check('a fan in no league sees nothing', pg_temp.names(t.uid(5), 1) = '');
select t.check('a test account still sees its league, and its own pick',
  pg_temp.names(t.uid(6), 1) = 'Fan 1,Fan 2,Fan 3,Fan 6*', pg_temp.names(t.uid(6), 1));
select t.check('a match not started (match 2 at 17:40) shows nothing', pg_temp.names(t.uid(1), 2) = '');

-- what a row carries: the pick as stored, points null until settled
select t.as_user(t.uid(1));
select t.check('a row carries the winner and the set scores as stored',
  (select winner_id = 'f' and set_scores = t.ss('4-6 4-6') and pts_total is null
     from public.get_league_picks(1) where display_name = 'Fan 2'));
select t.check('the output has no id or email column',
  (select proargnames from pg_proc where oid = 'public.get_league_picks(int)'::regprocedure)
    = array['p_match','display_name','is_me','winner_id','set_scores','pts_total']);
select t.as_owner();

-- settled: points arrive and order the list
select t.feed(1, 'completed', 'c', '6-4 6-4');
select t.as_user(t.uid(1));
select t.check('after the result, points are there and the best is first',
  (select display_name from public.get_league_picks(1) limit 1) = 'Fan 1'
  and (select pts_total from public.get_league_picks(1) where display_name = 'Fan 2') = 0);
select t.as_owner();

-- who may call it
select t.as_anon();
select t.check('anon cannot call it', t.err($$select * from public.get_league_picks(1)$$) is not null);
select t.as_owner();

select * from t.report();
rollback;
