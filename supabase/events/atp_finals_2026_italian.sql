-- Italian on the live ATP Finals event (13 Nov 2026), without reloading anything: the Italian event
-- words, the Italian privacy lines and the flag that switches Italian on. Same values as
-- atp_finals_2026.sql. Run once after migration 0060 (profiles accept 'it'); safe to run twice.
update public.event_config set
  branding = branding || '{
     "app_name_it":  "The Final Prediction",
     "short_name_it": "The Final Prediction",
     "event_line_it": "Otto giocatori · Torino · 15–22 novembre",
     "event_name_it": "ATP Finals",
     "city_it": "Torino",
     "session_it": "Giornata",
     "vote_eyebrow_it": "ATP Finals · Torino · 15–22 novembre"
   }'::jsonb,
  privacy = privacy || '{
     "notice_it": "Informativa sulla privacy provvisoria, in attesa di revisione legale. The Final Prediction è gestito da Grand Slam GM.",
     "consent_gsgm_it": "Provvisorio: voglio ricevere novità da Grand Slam GM."
   }'::jsonb,
  flags = flags || '{"italian": true}'::jsonb,
  updated_at = now()
returning name, flags, branding->>'city_it' as city_it;
