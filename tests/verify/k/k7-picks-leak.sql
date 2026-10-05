-- =====================================================================================================
-- K7 BUG DEMONSTRATION (these checks FAIL today, on build/phase-1 with the 0003 picks policy).
-- The policy "picks: own, or the match has started" lets ANY signed-in fan read EVERY fan's pick of a
-- started match, in every league and in none: the exact pick count of a match (= how many people play),
-- each fan's winner / set scores / points / timestamps, and, joined with get_leaderboard (user_id →
-- display_name), who picked what. get_league_picks is scoped to one league the caller belongs to; this
-- is not. They PASS once tests/verify/proposed/k7-picks-own-rows.sql is applied.
-- Style of supabase/tests/*.sql: begin … rollback after _prelude.sql.
-- =====================================================================================================
begin;

select t.setup_event();
select t.new_user(1, 'Fan One');
select t.new_user(2, 'Fan Two');
select t.new_user(3, 'Fan Three');      -- shares no league with anyone
select t.pick(t.uid(1), 1, 'c', '6-4 6-4');
select t.pick(t.uid(2), 1, 'f', '4-6 4-6');
select t.pick(t.uid(3), 1, 'c', '7-5 6-4');
select t.pick(t.uid(1), 2, 'd', '6-1 6-1');

-- Fans 1 and 2 share a league; fan 3 is in none.
select t.as_user(t.uid(1));
create temp table k7lg as select public.create_league('K7') as l;
grant select on k7lg to public;
select t.as_user(t.uid(2));
select public.join_league((select l->>'code' from k7lg));
select t.as_owner();

-- QF1 has started (QF2 has not).
select public.dev_set_now((select starts_at + interval '1 minute' from public.matches where match_no = 1));

select t.as_user(t.uid(2));
select t.check('K7 BUG (fails today): a fan cannot read the pick of a fan in no shared league (started match)',
  (select count(*) from public.picks where user_id = t.uid(3)) = 0,
  'fan 2 sees ' || (select count(*) from public.picks where user_id = t.uid(3)) || ' pick(s) of fan 3');
select t.check('K7 BUG (fails today): a fan cannot count every pick of a started match (player-count leak)',
  (select count(*) from public.picks where match_no = 1) = 1,
  'fan 2 counts ' || (select count(*) from public.picks where match_no = 1) || ' picks on QF1');
select t.check('K7 BUG (fails today): no direct table read reveals another fan''s winner, scores, points or timestamps',
  not exists (select 1 from public.picks where user_id <> t.uid(2)),
  (select string_agg(user_id::text || ' ' || winner_id || ' ' || set_scores::text || ' at ' || updated_at::text, '; ')
     from public.picks where user_id <> t.uid(2)));

-- What the app needs keeps working (these PASS today and after the patch).
select t.check('K7 app: my own picks are readable (myPicksQuery)',
  (select count(*) from public.picks where user_id = t.uid(2)) = 1);
select t.check('K7 app: get_league_picks still shows a league-mate''s pick of a started match',
  (select count(*) from public.get_league_picks((select (l->>'id')::uuid from k7lg), 1)) = 2);
select t.check('K7 app: get_league_picks does not show a non-member (fan 3)',
  not exists (select 1 from public.get_league_picks((select (l->>'id')::uuid from k7lg), 1) where user_id = t.uid(3)));
select t.check('K7 app: get_match_crowd still counts every pick (definer, independent of the policy)',
  (select picks from public.get_match_crowd(1)) = 3);
select t.check('K7 app: get_league_picks of a not-started match returns nothing',
  (select count(*) from public.get_league_picks((select (l->>'id')::uuid from k7lg), 2)) = 0);
select t.as_owner();

select * from t.report();
rollback;
