-- =====================================================================================================
-- ATP Finals 2026: the players and the draw (draw made Thu 12 Nov 2026 in Turin). Operator file: run
-- after atp_finals_2026.sql, as postgres, in the SQL editor (one paste, Run). set_players refuses once
-- any pick exists: the draw and the ranks freeze at the first pick.
--
--   John McEnroe Group: Zverev (1), Shelton (3), Fils (6), Jódar (8)
--   Ivan Lendl Group:   Alcaraz (2), Medvedev (4), Cobolli (5), Tiafoe (7)
--   Day 1, Sun 15 Nov (McEnroe): Zverev v Jódar (day session, singles from 14:00), Shelton v Fils
--                               (night session, not before 20:30)
--   Day 1, Mon 16 Nov (Lendl):   Alcaraz v Tiafoe, Medvedev v Cobolli (1v4 and 2v3, the ATP's pattern;
--                               sessions not published on 13 Nov → both lock at 14:00 until set)
--   Days 2–3: scheduled by the database from the day-1 results (0053, event_config.group_schedule)
--   SF1 (13) Winner McEnroe v Runner-up Lendl · SF2 (14) Winner Lendl v Runner-up McEnroe, Sat 21 Nov
--   F   (15) the two semi-final winners, Sun 22 Nov
-- Alternates: Alex de Minaur, Taylor Fritz (public.replace_player if one comes in).
--
-- Ranks (the upset-bonus snapshot): the ATP singles ranking published Mon 2 Nov 2026, the most recent
-- list confirmed on 13 Nov (atptour.com / Wikipedia "Current tennis rankings"): Zverev 1, Alcaraz 3,
-- Shelton 4, Medvedev 5, Cobolli 6, Fils 7, Tiafoe 8, Jódar 10 (de Minaur 9, Fritz 12).
-- Photos: Wikimedia Commons thumbnails, credited in the app (src/lib/photoCredits.ts).
-- =====================================================================================================

set role service_role;

select public.set_players(
  '[{"id":"zverev",  "name":"Alexander Zverev", "name_ar":"ألكسندر زفيريف",  "country":"GER","seed":1,"rank":1,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1d/Alexander_Zverev_%28cropped%29.jpg/500px-Alexander_Zverev_%28cropped%29.jpg"},
    {"id":"alcaraz", "name":"Carlos Alcaraz",   "name_ar":"كارلوس ألكاراز",   "country":"ESP","seed":2,"rank":3,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d4/25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Carlos_Alcaraz_-_240422_192324_%28cropped%29.jpg/500px-25th_Laureus_World_Sports_Awards_-_Red_Carpet_-_Carlos_Alcaraz_-_240422_192324_%28cropped%29.jpg"},
    {"id":"shelton", "name":"Ben Shelton",      "name_ar":"بن شيلتون",        "country":"USA","seed":3,"rank":4,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Ben_Shelton%2C_media_conference%2C_Swiss_Indoors_Basel_2025_%28cropped%29.jpg/500px-Ben_Shelton%2C_media_conference%2C_Swiss_Indoors_Basel_2025_%28cropped%29.jpg"},
    {"id":"medvedev","name":"Daniil Medvedev",  "name_ar":"دانييل ميدفيديف",  "country":null, "seed":4,"rank":5,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/3/30/Danill_Medvedev_Miami_2019_%28cropped%29.jpg/500px-Danill_Medvedev_Miami_2019_%28cropped%29.jpg"},
    {"id":"cobolli", "name":"Flavio Cobolli",   "name_ar":"فلافيو كوبولي",    "country":"ITA","seed":5,"rank":6,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/5/53/Cobolli_RGQ23_%2852944096963%29.jpg/500px-Cobolli_RGQ23_%2852944096963%29.jpg"},
    {"id":"fils",    "name":"Arthur Fils",      "name_ar":"آرثر فيس",         "country":"FRA","seed":6,"rank":7,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Fils_BOR22_%2852083970501%29.jpg/500px-Fils_BOR22_%2852083970501%29.jpg"},
    {"id":"tiafoe",  "name":"Frances Tiafoe",   "name_ar":"فرانسيس تيافو",    "country":"USA","seed":7,"rank":8,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/FrancesTiafo.jpg/500px-FrancesTiafo.jpg"},
    {"id":"jodar",   "name":"Rafael Jódar",     "name_ar":"رافائيل خودار",    "country":"ESP","seed":8,"rank":10,
     "image_path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e4/Rafael_J%C3%B3dar_Roland_Garros_2026_%28cropped%29.jpg/500px-Rafael_J%C3%B3dar_Roland_Garros_2026_%28cropped%29.jpg"}]',
  '[{"match_no":1, "round":"RR","group":"McEnroe","day":1,"p1":{"type":"player","id":"zverev"}, "p2":{"type":"player","id":"jodar"}},
    {"match_no":2, "round":"RR","group":"McEnroe","day":1,"p1":{"type":"player","id":"shelton"},"p2":{"type":"player","id":"fils"}},
    {"match_no":3, "round":"RR","group":"McEnroe",        "p1":{"type":"player","id":"zverev"}, "p2":{"type":"player","id":"shelton"}},
    {"match_no":4, "round":"RR","group":"McEnroe",        "p1":{"type":"player","id":"zverev"}, "p2":{"type":"player","id":"fils"}},
    {"match_no":5, "round":"RR","group":"McEnroe",        "p1":{"type":"player","id":"shelton"},"p2":{"type":"player","id":"jodar"}},
    {"match_no":6, "round":"RR","group":"McEnroe",        "p1":{"type":"player","id":"fils"},   "p2":{"type":"player","id":"jodar"}},
    {"match_no":7, "round":"RR","group":"Lendl",  "day":1,"p1":{"type":"player","id":"alcaraz"},"p2":{"type":"player","id":"tiafoe"}},
    {"match_no":8, "round":"RR","group":"Lendl",  "day":1,"p1":{"type":"player","id":"medvedev"},"p2":{"type":"player","id":"cobolli"}},
    {"match_no":9, "round":"RR","group":"Lendl",          "p1":{"type":"player","id":"alcaraz"},"p2":{"type":"player","id":"medvedev"}},
    {"match_no":10,"round":"RR","group":"Lendl",          "p1":{"type":"player","id":"alcaraz"},"p2":{"type":"player","id":"cobolli"}},
    {"match_no":11,"round":"RR","group":"Lendl",          "p1":{"type":"player","id":"medvedev"},"p2":{"type":"player","id":"tiafoe"}},
    {"match_no":12,"round":"RR","group":"Lendl",          "p1":{"type":"player","id":"cobolli"},"p2":{"type":"player","id":"tiafoe"}},
    {"match_no":13,"round":"SF","p1":{"type":"group","group":"McEnroe","place":1},"p2":{"type":"group","group":"Lendl","place":2}},
    {"match_no":14,"round":"SF","p1":{"type":"group","group":"Lendl","place":1},  "p2":{"type":"group","group":"McEnroe","place":2}},
    {"match_no":15,"round":"F", "p1":{"type":"winner","match":13},"p2":{"type":"winner","match":14}}]');

-- Locks (= start times). Day 1 now; days 2-3 come from the database; semi-finals and final now, as the
-- earliest each can start (operator moves the night semi-final later once the order of play is out).
select public.set_match_start(1,  '2026-11-15 14:00+01');   -- Zverev v Jódar, day session
select public.set_match_start(2,  '2026-11-15 20:30+01');   -- Shelton v Fils, night session (not before 20:30)
select public.set_match_start(7,  '2026-11-16 14:00+01');   -- Alcaraz v Tiafoe (session to confirm)
select public.set_match_start(8,  '2026-11-16 14:00+01');   -- Medvedev v Cobolli (session to confirm)
select public.set_match_start(13, '2026-11-21 14:00+01');
select public.set_match_start(14, '2026-11-21 14:00+01');
select public.set_match_start(15, '2026-11-22 18:00+01');

reset role;

-- Results from Wikipedia, "2026 ATP Finals – Singles" (PROVIDER=wikipedia, WIKIPEDIA_PAGE): group
-- cells "<group heading>:<i>v<j>" by the table's row numbers, and the 4-team bracket for the knockout.
delete from public.provider_map where provider = 'wikipedia';
insert into public.provider_map (provider, kind, provider_ref, our_ref) values
  ('wikipedia', 'match', 'John McEnroe Group:1v4', '1'),
  ('wikipedia', 'match', 'John McEnroe Group:2v3', '2'),
  ('wikipedia', 'match', 'John McEnroe Group:1v2', '3'),
  ('wikipedia', 'match', 'John McEnroe Group:1v3', '4'),
  ('wikipedia', 'match', 'John McEnroe Group:2v4', '5'),
  ('wikipedia', 'match', 'John McEnroe Group:3v4', '6'),
  ('wikipedia', 'match', 'Ivan Lendl Group:1v4',   '7'),
  ('wikipedia', 'match', 'Ivan Lendl Group:2v3',   '8'),
  ('wikipedia', 'match', 'Ivan Lendl Group:1v2',   '9'),
  ('wikipedia', 'match', 'Ivan Lendl Group:1v3',   '10'),
  ('wikipedia', 'match', 'Ivan Lendl Group:2v4',   '11'),
  ('wikipedia', 'match', 'Ivan Lendl Group:3v4',   '12'),
  ('wikipedia', 'match', 'RD1:1-2', '13'),
  ('wikipedia', 'match', 'RD1:3-4', '14'),
  ('wikipedia', 'match', 'RD2:1-2', '15'),
  ('wikipedia', 'player', 'Alexander Zverev', 'zverev'),
  ('wikipedia', 'player', 'Carlos Alcaraz',   'alcaraz'),
  ('wikipedia', 'player', 'Ben Shelton',      'shelton'),
  ('wikipedia', 'player', 'Daniil Medvedev',  'medvedev'),
  ('wikipedia', 'player', 'Flavio Cobolli',   'cobolli'),
  ('wikipedia', 'player', 'Arthur Fils',      'fils'),
  ('wikipedia', 'player', 'Frances Tiafoe',   'tiafoe'),
  ('wikipedia', 'player', 'Rafael Jódar',     'jodar'),
  ('wikipedia', 'player', 'Alex de Minaur',   'deminaur'),
  ('wikipedia', 'player', 'Taylor Fritz',     'fritz')
on conflict (provider, kind, provider_ref) do update set our_ref = excluded.our_ref;
