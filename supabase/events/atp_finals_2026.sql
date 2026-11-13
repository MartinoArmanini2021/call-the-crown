-- =====================================================================================================
-- Event setup — ATP Finals, Turin, 15–22 November 2026 (Tino, 13 Nov 2026: "adapt the prediction game
-- to the ATP Finals and make it perfect"). One file per event; run once by the operator (SQL editor,
-- as postgres) after the migrations, then atp_finals_2026_draw.sql. Re-runnable: it upserts the single
-- event_config row. The Six Kings Slam (moved to 27–30 Dec) goes back in afterwards with
-- sixkings_2026.sql + sixkings_2026_draw.sql; nothing in either file depends on the other.
--
-- RULES (decided for Tino on 13 Nov 2026, his "do everything without asking"; the Riyadh deck's values
-- carried over round for round, so nothing new to learn):
--   group match  = the Riyadh quarter-final: 8 for the winner, 4 for the right number of sets
--   semi-final   = 13 and 6 (as Riyadh) · final = 20 and 10 (as Riyadh)
--   2 per set called exactly; upset bonus ×(1 + gap/(gap+30)); every set a full set, 7-6 allowed
--   (all singles at the ATP Finals are best of three with a tiebreak in every set, the third included).
-- Most points without upsets, every match in two sets: 12 × 16 + 2 × 23 + 34 = 272.
-- =====================================================================================================

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
  -- Days 2 and 3 of each group are scheduled by the database once its day-1 matches are settled
  -- (0053): the day-1 winners meet on day 2, the day-1 losers too; the other two pairs on day 3. Each
  -- gets 14:00 Turin, the first singles start of the day session, as its lock; an operator can move a
  -- night match to its real time (set_match_start) before 14:00 that day.
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
