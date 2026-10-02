-- =====================================================================================================
-- STAGING ONLY — the review instance (Phase 2). Run once after the migrations and the event file.
-- Invented players A–F until the organiser confirms the line-up and byes (Tino, 2 Oct 2026). The real
-- 2026 schedule shape: 19:30 and ~20:40 Riyadh each night. The provider is "fixture" (invented results,
-- published 90 minutes after each start), so the whole pipeline can be watched on staging too.
-- No simulated clock and no invented fans here: staging runs on the real clock, like production.
-- Same operator RPCs as the runbook ("Enter the players and the schedule").
-- =====================================================================================================

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

-- Example prizes and terms link so the review shows the layout; replaced with the organiser's text.
update public.event_config set
  launch_at = '2026-10-02 00:00+03',
  prizes = '[{"place":1,"title":"First prize (organiser text to come)","image_path":null},
             {"place":2,"title":"Second prize (organiser text to come)","image_path":null},
             {"place":3,"title":"Third prize (organiser text to come)","image_path":null}]'
 where id;
