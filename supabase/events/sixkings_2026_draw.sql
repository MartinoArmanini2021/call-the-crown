-- =====================================================================================================
-- Six Kings Slam 2026: the players and the draw (Tino, 2 Oct 2026). Operator file: run on an instance
-- after the event file, as postgres (SQL editor or `bunx supabase db query --linked -f`).
--   QF1  Fritz v Zverev        → SF1 against Alcaraz (bye, seed 1)
--   QF2  de Minaur v Sinner    → SF2 against Djokovic (bye, seed 2)
--   Third place: the two semi-final losers. Final: the two semi-final winners.
--
-- PROVISIONAL until replaced (README, "Enter the players and the schedule"):
--   · ranks: the upset-bonus snapshot is the ATP ranking of Monday 12 Oct 2026 (Tino, 2 Oct). The
--     numbers below are placeholders, not an official ranking; replace them before picks open on the
--     production instance. Once any pick exists, ranks are frozen by design.
--   · seeds 3–6 (display order only) and the start times (19:30 / ~20:40 Riyadh, the 2024–25 pattern)
--     until the organiser's schedule arrives; start times stay editable until each match starts.
--   · Wikipedia slot ids follow the 2024 and 2025 brackets; check them against the 2026 article once it
--     exists (README, "Choose the results provider and map its ids").
-- Player images: the organiser's Six Kings Slam artwork, uploaded to the instance's `event` bucket as
-- players/<id>.jpg, then: update public.players set image_path = 'players/<id>.jpg' where id = '<id>';
-- =====================================================================================================

set role service_role;

select public.set_players(
  '[{"id":"alcaraz", "name":"Carlos Alcaraz",   "name_ar":"كارلوس ألكاراز","country":"ESP","seed":1,"rank":3},
    {"id":"djokovic","name":"Novak Djokovic",   "name_ar":"نوفاك ديوكوفيتش","country":"SRB","seed":2,"rank":5},
    {"id":"sinner",  "name":"Jannik Sinner",    "name_ar":"يانيك سينر","country":"ITA","seed":3,"rank":1},
    {"id":"zverev",  "name":"Alexander Zverev", "name_ar":"ألكسندر زفيريف","country":"GER","seed":4,"rank":2},
    {"id":"deminaur","name":"Alex de Minaur",   "name_ar":"أليكس دي مينور","country":"AUS","seed":5,"rank":7},
    {"id":"fritz",   "name":"Taylor Fritz",     "name_ar":"تايلور فريتز","country":"USA","seed":6,"rank":10}]',
  '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"fritz"},   "p2":{"type":"player","id":"zverev"}},
    {"match_no":2,"round":"QF","p1":{"type":"player","id":"deminaur"},"p2":{"type":"player","id":"sinner"}},
    {"match_no":3,"round":"SF","p1":{"type":"player","id":"alcaraz"}, "p2":{"type":"winner","match":1}},
    {"match_no":4,"round":"SF","p1":{"type":"player","id":"djokovic"},"p2":{"type":"winner","match":2}},
    {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},       "p2":{"type":"loser","match":4}},
    {"match_no":6,"round":"F", "p1":{"type":"winner","match":3},      "p2":{"type":"winner","match":4}}]');

select public.set_match_start(1, '2026-10-21 19:30+03');
select public.set_match_start(2, '2026-10-21 20:40+03');
select public.set_match_start(3, '2026-10-22 19:30+03');
select public.set_match_start(4, '2026-10-22 21:20+03');
select public.set_match_start(5, '2026-10-24 19:30+03');
select public.set_match_start(6, '2026-10-24 21:40+03');

reset role;

-- Results from the 2026 Wikipedia article (provider "wikipedia"): bracket slots and article titles.
insert into public.provider_map (provider, kind, provider_ref, our_ref) values
  ('wikipedia', 'match',  'RD1:3-4', '1'),
  ('wikipedia', 'match',  'RD1:5-6', '2'),
  ('wikipedia', 'match',  'RD2:1-2', '3'),
  ('wikipedia', 'match',  'RD2:3-4', '4'),
  ('wikipedia', 'match',  '3rd:1-2', '5'),
  ('wikipedia', 'match',  'RD3:1-2', '6'),
  ('wikipedia', 'player', 'Carlos Alcaraz',   'alcaraz'),
  ('wikipedia', 'player', 'Novak Djokovic',   'djokovic'),
  ('wikipedia', 'player', 'Jannik Sinner',    'sinner'),
  ('wikipedia', 'player', 'Alexander Zverev', 'zverev'),
  ('wikipedia', 'player', 'Alex de Minaur',   'deminaur'),
  ('wikipedia', 'player', 'Taylor Fritz',     'fritz')
on conflict (provider, kind, provider_ref) do update set our_ref = excluded.our_ref;
