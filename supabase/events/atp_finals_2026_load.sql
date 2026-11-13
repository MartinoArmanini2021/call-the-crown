-- ONE statement (a DO block): atp_finals_2026.sql + atp_finals_2026_draw.sql, for
-- `bunx supabase db query --linked -f supabase/events/atp_finals_2026_load.sql`, which runs a single
-- statement only. Generated from those two files on 13 Nov 2026; they stay the readable source.
-- Also removes the one test vote left from October (quick_votes) and the Six Kings provider ids.
do $load$
begin
insert into public.event_config (
  id, name, timezone, launch_at, billing_close_at, rank_snapshot_date,
  rules, league_limits, branding, prizes, prize_terms_url, privacy, sponsor_slots, flags, group_schedule
) values (
  true,
  'The Final Prediction · ATP Finals 2026',
  'Europe/Rome',
  '2026-11-13 00:00+01',
  '2026-11-22 23:59:59+01',
  '2026-11-02',                                -- the ATP ranking published Mon 2 Nov 2026 (see the draw file)
  '{
     "winner_points":      {"RR": 8, "SF": 13, "F": 20},
     "sets_points":        {"RR": 4, "SF": 6,  "F": 10},
     "per_set_exact":      2,
     "upset_constant":     30,
     "allowed_set_scores": [[6,0],[6,1],[6,2],[6,3],[6,4],[7,5],[7,6]],
     "deciding_set":       "full"
   }',
  '{"max_leagues_per_user": 10, "max_members": 200, "crew_min_members": 5}',
  '{
     "app_name":  "The Final Prediction",
     "short_name": "The Final Prediction",
     "event_line": "Eight players · Turin · 15–22 November",
     "event_name": "ATP Finals",
     "city": "Turin",
     "session": "Day",
     "vote_eyebrow": "ATP Finals · Turin · 15–22 November",
     "app_name_ar":  "التوقّع النهائي",
     "short_name_ar": "التوقّع النهائي",
     "event_line_ar": "ثمانية لاعبين · تورينو · 15–22 نوفمبر",
     "event_name_ar": "بطولة الماسترز الختامية",
     "city_ar": "تورينو",
     "session_ar": "اليوم",
     "vote_eyebrow_ar": "بطولة الماسترز الختامية · تورينو · 15–22 نوفمبر",
     "app_name_it":  "The Final Prediction",
     "short_name_it": "The Final Prediction",
     "event_line_it": "Otto giocatori · Torino · 15–22 novembre",
     "event_name_it": "ATP Finals",
     "city_it": "Torino",
     "session_it": "Giornata",
     "vote_eyebrow_it": "ATP Finals · Torino · 15–22 novembre",
     "logo_path": null,
     "colors": {"bg": "#051224", "card": "#0b1e38", "raised": "#14305a", "accent": "#1652f0",
                "accent_deep": "#171c8f", "accent_text": "#6fa0ff", "text": "#ffffff",
                "text_secondary": "#c5d0e0", "text_muted": "#8c9cb8",
                "gold": "#0ad4be", "good": "#a3e635", "medal": "#f2c14e"},
     "group_colors": {"McEnroe": "#fb923c", "Lendl": "#e879f9"},
     "fonts": {"headline": "Barlow Condensed", "display": "Urbanist", "body": "Plus Jakarta Sans"}
   }',
  '[]',                                        -- no prizes: bragging rights only (0019)
  null,
  '{
     "version": "2026-11-13b",
     "notice": "The Final Prediction is a free game run by Grand Slam GM: no betting, no money. We use your email only to sign you in and, if you turn them on, to send pick reminders. Other players see your display name and your points; people in your leagues also see your picks once each match has started. How many fans picked each player is shown without names. You can delete your account from your profile at any time.",
     "consent_gsgm": "Send me news about Grand Slam GM games (optional).",
     "notice_it": "The Final Prediction è un gioco gratuito di Grand Slam GM: niente scommesse, niente soldi. Usiamo la tua email solo per farti accedere e, se li attivi, per mandarti i promemoria dei pronostici. Gli altri giocatori vedono il tuo nome e i tuoi punti; chi è nelle tue leghe vede anche i tuoi pronostici, appena inizia ogni partita. Quanti tifosi hanno scelto ogni giocatore si vede senza nomi. Puoi cancellare il tuo account dal profilo quando vuoi.",
     "consent_gsgm_it": "Mandami novità sui giochi di Grand Slam GM (facoltativo)."
   }',
  '[]',
  '{"arabic": false, "italian": true, "rarity_min_picks": 5}',   -- crowd split from 5 picks (Tino, 13 Nov 2026: friends)
  '{"time": "14:00",
    "days": {"McEnroe": ["2026-11-15", "2026-11-17", "2026-11-19"],
             "Lendl":   ["2026-11-16", "2026-11-18", "2026-11-20"]}}'
)
on conflict (id) do update set
  name = excluded.name, timezone = excluded.timezone, launch_at = excluded.launch_at,
  billing_close_at = excluded.billing_close_at, rank_snapshot_date = excluded.rank_snapshot_date,
  rules = excluded.rules, league_limits = excluded.league_limits, branding = excluded.branding,
  prizes = excluded.prizes, prize_terms_url = excluded.prize_terms_url, privacy = excluded.privacy,
  sponsor_slots = excluded.sponsor_slots, flags = excluded.flags, group_schedule = excluded.group_schedule,
  updated_at = now();

perform public.set_players(
  '[{"id":"zverev",  "name":"Alexander Zverev", "name_ar":"ألكسندر زفيريف",  "country":"GER","seed":1,"rank":1,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/Z355"},
    {"id":"alcaraz", "name":"Carlos Alcaraz",   "name_ar":"كارلوس ألكاراز",   "country":"ESP","seed":2,"rank":3,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/A0E2"},
    {"id":"shelton", "name":"Ben Shelton",      "name_ar":"بن شيلتون",        "country":"USA","seed":3,"rank":4,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/S0S1"},
    {"id":"medvedev","name":"Daniil Medvedev",  "name_ar":"دانييل ميدفيديف",  "country":null, "seed":4,"rank":5,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/MM58"},
    {"id":"cobolli", "name":"Flavio Cobolli",   "name_ar":"فلافيو كوبولي",    "country":"ITA","seed":5,"rank":6,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/C0E9"},
    {"id":"fils",    "name":"Arthur Fils",      "name_ar":"آرثر فيس",         "country":"FRA","seed":6,"rank":7,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/F0F1"},
    {"id":"tiafoe",  "name":"Frances Tiafoe",   "name_ar":"فرانسيس تيافو",    "country":"USA","seed":7,"rank":8,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/TD51"},
    {"id":"jodar",   "name":"Rafael Jódar",     "name_ar":"رافائيل خودار",    "country":"ESP","seed":8,"rank":10,
     "image_path":"https://www.atptour.com/-/media/alias/player-headshot/J0DZ"}]',
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

perform public.set_match_start(1,  '2026-11-15 14:00+01');   -- Zverev v Jódar, day session
perform public.set_match_start(2,  '2026-11-15 14:00+01');   -- Shelton v Fils: 14:00 until the order of play is out (13 Nov 2026); the evening check moves a night match to 20:30
perform public.set_match_start(7,  '2026-11-16 14:00+01');   -- Alcaraz v Tiafoe (session to confirm)
perform public.set_match_start(8,  '2026-11-16 14:00+01');   -- Medvedev v Cobolli (session to confirm)
perform public.set_match_start(13, '2026-11-21 14:00+01');
perform public.set_match_start(14, '2026-11-21 14:00+01');
perform public.set_match_start(15, '2026-11-22 18:00+01');


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

delete from public.quick_votes where true;
end
$load$;
