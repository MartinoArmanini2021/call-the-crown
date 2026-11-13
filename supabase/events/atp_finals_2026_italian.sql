-- Italian on the live ATP Finals event (13 Nov 2026), without reloading anything: the Italian event
-- words, the final privacy wording in English and Italian (replacing the placeholders), and the flag
-- that switches Italian on. Same values as
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
     "version": "2026-11-13b",
     "notice": "The Final Prediction is a free game run by Grand Slam GM: no betting, no money. We use your email only to sign you in and, if you turn them on, to send pick reminders. Other players see your display name and your points; people in your leagues also see your picks once each match has started. How many fans picked each player is shown without names. You can delete your account from your profile at any time.",
     "consent_gsgm": "Send me news about Grand Slam GM games (optional).",
     "notice_it": "The Final Prediction è un gioco gratuito di Grand Slam GM: niente scommesse, niente soldi. Usiamo la tua email solo per farti accedere e, se li attivi, per mandarti i promemoria dei pronostici. Gli altri giocatori vedono il tuo nome e i tuoi punti; chi è nelle tue leghe vede anche i tuoi pronostici, appena inizia ogni partita. Quanti tifosi hanno scelto ogni giocatore si vede senza nomi. Puoi cancellare il tuo account dal profilo quando vuoi.",
     "consent_gsgm_it": "Mandami novità sui giochi di Grand Slam GM (facoltativo)."
   }'::jsonb,
  flags = flags || '{"italian": true}'::jsonb,
  updated_at = now()
returning name, flags, branding->>'city_it' as city_it;
