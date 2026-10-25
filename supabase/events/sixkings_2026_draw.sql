-- =====================================================================================================
-- Six Kings Slam 2026: the players and the draw (Tino, 2 Oct 2026; field updated 12 Oct 2026). Operator
-- file: run on an instance after the event file, as postgres: paste the whole file into the Supabase SQL
-- editor and Run. (`supabase db query -f` cannot run it: it refuses a file with several statements.) On an instance that already has picks, set_players refuses: the draw and
-- the ranks are frozen once any pick exists.
--   QF1  Fritz v Zverev        → SF1 against Alcaraz (bye, seed 1)
--   QF2  de Minaur v Tien      → SF2 against Djokovic (bye, seed 2)
--   Third place: the two semi-final losers. Final: the two semi-final winners.
-- Field change: Jannik Sinner withdrew on 6 Oct 2026 (right knee, season over); the organisers named
-- Learner Tien as his replacement (Riyadh Season, reported 6 Oct by Tennis Now, Punto de Break, OA Sport).
--
-- Ranks (the upset-bonus snapshot): the ATP singles ranking dated Mon 5 Oct 2026, the one in force on
-- Mon 12 Oct (Tino's chosen date: no new list is published during the two-week Shanghai Masters).
-- Zverev 2, Alcaraz 3, Djokovic 8, de Minaur 9, Fritz 12, Tien 17 (atptour.com, read 12 Oct 2026).
-- Once any pick exists, ranks are frozen by design.
-- POSTPONED on 14 Oct 2026 to 27-30 Dec: see the start-time note below.
-- STILL PROVISIONAL (README, "Enter the players and the schedule"):
--   · the start times (19:30 / ~20:40 Riyadh, the 2024–25 pattern): Riyadh Season gives 19:30 for the
--     first match each night but not the order of the two matches; start times stay editable until each
--     match starts;
--   · Wikipedia slot ids follow the 2024 and 2025 brackets; check them against the 2026 article once it
--     exists (README, "Choose the results provider and map its ids").
-- Player images: the official ATP headshots, hotlinked by ATP id (Tino, 4 Oct 2026: the app runs
-- standalone, no organiser artwork; the same pictures Grand Slam GM uses, never re-hosted). A wrong id
-- shows ATP's generic silhouette instead of failing, so check the faces by eye after loading.
-- image_path may be a storage path (an uploaded image) or a full https address (these).
-- =====================================================================================================

set role service_role;

select public.set_players(
  '[{"id":"alcaraz", "name":"Carlos Alcaraz",   "name_ar":"كارلوس ألكاراز","country":"ESP","seed":1,"rank":3,"image_path":"https://www.atptour.com/-/media/alias/player-headshot/A0E2"},
    {"id":"djokovic","name":"Novak Djokovic",   "name_ar":"نوفاك ديوكوفيتش","country":"SRB","seed":2,"rank":8,"image_path":"https://www.atptour.com/-/media/alias/player-headshot/D643"},
    {"id":"zverev",  "name":"Alexander Zverev", "name_ar":"ألكسندر زفيريف","country":"GER","seed":3,"rank":2,"image_path":"https://www.atptour.com/-/media/alias/player-headshot/Z355"},
    {"id":"deminaur","name":"Alex de Minaur",   "name_ar":"أليكس دي مينور","country":"AUS","seed":4,"rank":9,"image_path":"https://www.atptour.com/-/media/alias/player-headshot/DH58"},
    {"id":"fritz",   "name":"Taylor Fritz",     "name_ar":"تايلور فريتز","country":"USA","seed":5,"rank":12,"image_path":"https://www.atptour.com/-/media/alias/player-headshot/FB98"},
    {"id":"tien",    "name":"Learner Tien",     "name_ar":"ليرنر تيين","country":"USA","seed":6,"rank":17,"image_path":"https://www.atptour.com/-/media/alias/player-headshot/T0HA"}]',
  '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"fritz"},   "p2":{"type":"player","id":"zverev"}},
    {"match_no":2,"round":"QF","p1":{"type":"player","id":"deminaur"},"p2":{"type":"player","id":"tien"}},
    {"match_no":3,"round":"SF","p1":{"type":"player","id":"alcaraz"}, "p2":{"type":"winner","match":1}},
    {"match_no":4,"round":"SF","p1":{"type":"player","id":"djokovic"},"p2":{"type":"winner","match":2}},
    {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},       "p2":{"type":"loser","match":4}},
    {"match_no":6,"round":"F", "p1":{"type":"winner","match":3},      "p2":{"type":"winner","match":4}}]');

-- Start times: none for now. Riyadh Season postponed the event on 14 Oct 2026 from 21-24 Oct to
-- 27-30 Dec 2026; the December players and daily schedule are not confirmed. Without start times picks
-- stay closed, so the field and ranks can still change (both freeze at the first pick). When the
-- schedule is out, as service_role (19:30 Riyadh each night was the 2024-25 pattern):
--   select public.set_match_start(1, '2026-12-27 19:30+03');   -- one line per match, 1 to 6

reset role;

update public.event_config
   set rank_snapshot_date = '2026-10-05',
       billing_close_at   = '2026-12-30 23:59:59+03',
       branding = branding || jsonb_build_object(
         'event_line',    'Six players · Riyadh · moved to 27–30 December',
         'event_line_ar', 'ستة لاعبين · الرياض · أُجّلت إلى 27–30 ديسمبر');

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
  ('wikipedia', 'player', 'Learner Tien',     'tien'),
  ('wikipedia', 'player', 'Alexander Zverev', 'zverev'),
  ('wikipedia', 'player', 'Alex de Minaur',   'deminaur'),
  ('wikipedia', 'player', 'Taylor Fritz',     'fritz')
on conflict (provider, kind, provider_ref) do update set our_ref = excluded.our_ref;
