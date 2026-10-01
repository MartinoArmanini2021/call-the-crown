-- =====================================================================================================
-- LOCAL ONLY — a complete invented event for the local walkthrough. Never applied to staging or
-- production. Run after the migrations, sim_clock.sql and the event file (README, "Run it locally").
-- It does exactly what the operator does for a real event, through the same RPCs, as the service role.
-- Players A–F are invented. The provider is "fixture" (supabase/functions/poll-results/fixtures/event.json).
-- =====================================================================================================

select public.dev_set_now('2026-10-20 12:00+00');   -- the day before the event, noon UTC

set role service_role;

select public.set_players(
  '[{"id":"a","name":"Player A","country":"AAA","seed":1,"rank":1},
    {"id":"b","name":"Player B","country":"BBB","seed":2,"rank":2},
    {"id":"c","name":"Player C","country":"CCC","seed":3,"rank":3},
    {"id":"d","name":"Player D","country":"DDD","seed":4,"rank":5},
    {"id":"e","name":"Player E","country":"EEE","seed":5,"rank":7},
    {"id":"f","name":"Player F","country":"FFF","seed":6,"rank":10}]',
  '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"c"},"p2":{"type":"player","id":"f"}},
    {"match_no":2,"round":"QF","p1":{"type":"player","id":"d"},"p2":{"type":"player","id":"e"}},
    {"match_no":3,"round":"SF","p1":{"type":"player","id":"a"},"p2":{"type":"winner","match":1}},
    {"match_no":4,"round":"SF","p1":{"type":"player","id":"b"},"p2":{"type":"winner","match":2}},
    {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},"p2":{"type":"loser","match":4}},
    {"match_no":6,"round":"F","p1":{"type":"winner","match":3},"p2":{"type":"winner","match":4}}]');

-- 19:30 and ~20:40 Riyadh each night (16:30 / 17:40 UTC), the pattern of past editions.
select public.set_match_start(1, '2026-10-21 16:30+00');
select public.set_match_start(2, '2026-10-21 17:40+00');
select public.set_match_start(3, '2026-10-22 16:30+00');
select public.set_match_start(4, '2026-10-22 18:20+00');
select public.set_match_start(5, '2026-10-24 16:30+00');
select public.set_match_start(6, '2026-10-24 18:40+00');

reset role;

insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 6) n
union all
select 'fixture', 'player', 'fx-' || p, p from unnest(array['a','b','c','d','e','f']) p
on conflict do nothing;

update public.event_config set launch_at = '2026-10-15 09:00+03',
  prizes = '[{"place":1,"title":"Two tickets to the final (example)","image_path":null},
             {"place":2,"title":"Signed racket (example)","image_path":null},
             {"place":3,"title":"Official tournament towel (example)","image_path":null}]',
  prize_terms_url = 'https://example.com/prize-terms',
  sponsor_slots = '[{"slot":"landing_strip","image_path":null,"href":"https://example.com","alt":{"en":"Example sponsor"}}]';
