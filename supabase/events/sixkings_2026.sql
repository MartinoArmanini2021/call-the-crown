-- =====================================================================================================
-- Event setup — Riyadh, October 2026. One file per event; run once by the operator (SQL editor,
-- as postgres) after the migrations. Re-runnable: it upserts the single event_config row.
-- Rules = the deck the organiser received. Do not change them here without a decision from Tino.
-- The app's own name, "Call the Crown" (Tino, 4 Oct 2026: the organiser is not licensing it, so the app
-- runs standalone under its own name and logo; the event is described, never used as the brand).
--
-- STILL PLACEHOLDERS (see README, "Open questions"): launch_at, the rank snapshot date, the prize text
-- and terms URL, the privacy and consent texts (legal review), the sponsor slots, the deciding-set mode.
-- Players, byes and start times are NOT here: they go in through set_players and set_match_start once
-- the organiser confirms them (README, "Enter the players and the schedule").
-- =====================================================================================================

insert into public.event_config (
  id, name, timezone, launch_at, billing_close_at, rank_snapshot_date,
  rules, league_limits, branding, prizes, prize_terms_url, privacy, sponsor_slots, flags
) values (
  true,
  'Call the Crown · Riyadh 2026',
  'Asia/Riyadh',
  null,                                        -- set at launch
  '2026-10-24 23:59:59+03',                    -- 24 Oct 23:59 Riyadh
  null,                                        -- the published ranking date the snapshot uses
  '{
     "winner_points":      {"QF": 8, "SF": 13, "3P": 8, "F": 20},
     "sets_points":        {"QF": 4, "SF": 6,  "3P": 4, "F": 10},
     "per_set_exact":      2,
     "upset_constant":     30,
     "allowed_set_scores": [[6,0],[6,1],[6,2],[6,3],[6,4],[7,5],[7,6]],
     "deciding_set":       "full"
   }',
  '{"max_leagues_per_user": 10, "max_members": 200}',
  '{
     "app_name":  "Call the Crown",
     "short_name": "Call the Crown",
     "event_line": "Six players · Riyadh · 21, 22 & 24 October",
     "app_name_ar":  "توقّع التاج",
     "short_name_ar": "توقّع التاج",
     "event_line_ar": "ستة لاعبين · الرياض · 21 و22 و24 أكتوبر",
     "logo_path": null,
     "colors": {"bg": "#0b0b0b", "card": "#181818", "raised": "#242424", "accent": "#e50914",
                "accent_deep": "#b20710", "accent_text": "#ff4f57", "text": "#ffffff",
                "text_secondary": "#c9c9c9", "text_muted": "#9c9c9c"},
     "fonts": {"headline": "Barlow Condensed", "display": "Urbanist", "body": "Plus Jakarta Sans"}
   }',
  '[
     {"place": 1, "title": "First prize (text to come from the organiser)",  "image_path": null},
     {"place": 2, "title": "Second prize (text to come from the organiser)", "image_path": null},
     {"place": 3, "title": "Third prize (text to come from the organiser)",  "image_path": null}
   ]',
  null,
  '{
     "version": "draft-1",
     "notice": "Privacy notice placeholder, pending legal review. It will name both parties: the organiser and Grand Slam GM.",
     "consent_organiser": "Placeholder: I would like to receive news and offers from the organiser.",
     "consent_gsgm": "Placeholder: I would like to receive news from Grand Slam GM."
   }',
  '[]',
  '{"arabic": false}'
)
on conflict (id) do update set
  name = excluded.name, timezone = excluded.timezone, launch_at = excluded.launch_at,
  billing_close_at = excluded.billing_close_at, rank_snapshot_date = excluded.rank_snapshot_date,
  rules = excluded.rules, league_limits = excluded.league_limits, branding = excluded.branding,
  prizes = excluded.prizes, prize_terms_url = excluded.prize_terms_url, privacy = excluded.privacy,
  sponsor_slots = excluded.sponsor_slots, flags = excluded.flags, updated_at = now();
