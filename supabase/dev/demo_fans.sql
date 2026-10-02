-- =====================================================================================================
-- LOCAL ONLY — a dozen invented fans with random legal picks on the two quarter-finals, so the Results
-- and Leaderboard screens can be judged with a realistic table. Never applied to staging or production.
-- Run after the seed, while the clock is before the quarter-finals (20 Oct):
--   bun -e "await new (require('bun').SQL)('postgresql://postgres:postgres@127.0.0.1:55322/postgres').unsafe(await Bun.file('supabase/dev/demo_fans.sql').text())"
-- Then move the clock past night 1 (select public.dev_set_now('2026-10-21 20:00+00');) and the cron
-- settles the matches. All people are invented (demoN@example.test).
-- =====================================================================================================

-- A legal set score from the configured list (k = 0..6), won by player w (1 or 2), in p1-p2 order.
create function pg_temp.demo_set(w int, k int) returns jsonb language sql as $f$
  select case when w = 1 then jsonb_build_object('p1_games', (a->>0)::int, 'p2_games', (a->>1)::int)
              else jsonb_build_object('p1_games', (a->>1)::int, 'p2_games', (a->>0)::int) end
    from (select rules->'allowed_set_scores'->k as a from public.event_config) x
$f$;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
select gen_random_uuid(), 'demo' || n || '@example.test', now(),
       jsonb_build_object('display_name', name, 'consent_organiser', n % 2 = 0, 'consent_gsgm', n % 3 = 0,
                          'consent_text_version', 'draft-1')
  from unnest(array['Omar A.', 'Sara K.', 'Luca B.', 'Noor H.', 'Marco T.', 'Lina F.', 'Yusuf R.',
                    'Elena P.', 'Karim D.', 'Maya S.', 'Tom W.', 'Hana Q.']) with ordinality as x(name, n);

-- Random but legal picks on QF1 (C v F) and QF2 (D v E), in each match's player order.
insert into public.picks (user_id, match_no, winner_id, sets, set_scores)
select u.id, m.match_no,
       case when r.w = 1 then m.p1_id else m.p2_id end,
       case when r.three then 3 else 2 end,
       case when not r.three then
              jsonb_build_array(pg_temp.demo_set(r.w, r.a), pg_temp.demo_set(r.w, r.b))
            else
              jsonb_build_array(pg_temp.demo_set(r.w, r.a), pg_temp.demo_set(3 - r.w, r.b), pg_temp.demo_set(r.w, r.c))
       end
  from auth.users u
 cross join public.matches m
 cross join lateral (select 1 + (random() < 0.5)::int as w, random() < 0.4 as three,
                            floor(random() * 7)::int as a, floor(random() * 7)::int as b,
                            floor(random() * 7)::int as c, u.id as uid) r
 where u.email like 'demo%@example.test' and m.match_no in (1, 2)
on conflict do nothing;
