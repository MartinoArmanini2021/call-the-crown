-- =====================================================================================================
-- The quick vote (0052): one tap, no sign-up; one vote per device; a cap per internet address; closed at
-- the first ball; percentages only from 50 votes, never counts; nobody reads the table directly.
-- Runs inside begin … rollback (bun run test:sql quick_vote).
-- =====================================================================================================
begin;

select t.setup_event();   -- clock: 20 Oct 2026, the day before the first match

create function pg_temp.dev(n int) returns uuid language sql immutable
as $$ select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.from_ip(ip text) returns void language sql
as $$ select set_config('request.headers', json_build_object('x-forwarded-for', ip || ', 10.0.0.1')::text, true) $$;
grant execute on function pg_temp.dev(int), pg_temp.from_ip(text) to public;

select t.as_anon();
select pg_temp.from_ip('203.0.113.7');
select t.check('anyone can vote, no sign-up', t.err($$ select * from public.cast_quick_vote(pg_temp.dev(1), 'alcaraz') $$) is null);
select t.check('below 50 votes the answer carries no shares', (select count(*) from public.cast_quick_vote(pg_temp.dev(2), 'tien')) = 0);
select t.check('a second tap from the same device changes the vote, it does not add one',
  t.err($$ select * from public.cast_quick_vote(pg_temp.dev(1), 'djokovic') $$) is null);
select t.check('an unknown or withdrawn player is refused (Sinner withdrew)',
  t.err($$ select * from public.cast_quick_vote(pg_temp.dev(3), 'sinner') $$) like '%unknown_player%');
select t.check('anon cannot read the votes table', t.err('select * from public.quick_votes') like '%permission denied%');

select t.as_owner();
select t.check('… two devices, two votes: Djokovic and Tien', (select array_agg(player_id order by player_id) from public.quick_votes) = array['djokovic', 'tien']);
select t.check('… the address is kept only as a salted hash',
  (select bool_and(ip_hash = md5('ctc-quick-vote:203.0.113.7') and ip_hash !~ '203') from public.quick_votes));

-- Ballot-stuffing: 10 new devices per address per hour.
select t.as_anon();
select pg_temp.from_ip('198.51.100.9');
select public.cast_quick_vote(pg_temp.dev(100 + n), 'fritz') from generate_series(1, 10) n;
select t.check('the 11th new device from one address within the hour is refused',
  t.err($$ select * from public.cast_quick_vote(pg_temp.dev(200), 'fritz') $$) like '%too_many_votes%');
select t.check('… but a device that already voted can still change its mind',
  t.err($$ select * from public.cast_quick_vote(pg_temp.dev(101), 'zverev') $$) is null);
select pg_temp.from_ip('192.0.2.44');
select t.check('… and another address is not affected',
  t.err($$ select * from public.cast_quick_vote(pg_temp.dev(201), 'fritz') $$) is null);

-- Shares from 50 votes: one decimal, no counts.
select t.as_owner();
insert into public.quick_votes (device_id, player_id)
select pg_temp.dev(1000 + n), case when n <= 20 then 'alcaraz' else 'zverev' end from generate_series(1, 36) n;
select t.check('49 votes: still no shares', (select count(*) from public.get_quick_vote_shares()) = 0);
insert into public.quick_votes (device_id, player_id) values (pg_temp.dev(2000), 'deminaur');
select t.as_anon();
select t.check('50 votes: shares, one decimal, adding up to 100',
  (select sum(share) between 99.9 and 100.1 and bool_and(share = round(share, 1)) from public.get_quick_vote_shares()));
select t.check('… Alcaraz leads with 40.0% (20 of 50), Zverev next with 34.0% (17 of 50)',
  (select array_agg(player_id || ' ' || share order by share desc, player_id) from public.get_quick_vote_shares())
    = array['alcaraz 40.0', 'zverev 34.0', 'fritz 20.0', 'deminaur 2.0', 'djokovic 2.0', 'tien 2.0']);
select t.check('no count column reaches the browser',
  (select pg_get_function_result('public.get_quick_vote_shares()'::regprocedure)) = 'TABLE(player_id text, share numeric)');

-- Closed at the first ball.
select t.as_owner();
select public.dev_set_now('2026-10-21 16:30+00');
select t.as_anon();
select t.check('voting closes when the first match starts',
  t.err($$ select * from public.cast_quick_vote(pg_temp.dev(3000), 'tien') $$) like '%voting_closed%');

select t.as_owner();
select t.check('both functions: security definer, search_path = public',
  (select bool_and(prosecdef and proconfig @> array['search_path=public']) from pg_proc
    where oid in ('public.cast_quick_vote(uuid, text)'::regprocedure, 'public.get_quick_vote_shares()'::regprocedure)));

select * from t.report();
rollback;
