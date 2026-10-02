-- =====================================================================================================
-- STAGING ONLY — the review instance. Run after the migrations, the event file and the draw file
-- (supabase/events/sixkings_2026.sql, then supabase/events/sixkings_2026_draw.sql).
-- The real players and draw come from the draw file (Tino, 2 Oct 2026). Results on staging still come
-- from the "fixture" provider: invented results, published 90 minutes after each start, mapped here onto
-- the real players so the whole pipeline can be watched before the 2026 Wikipedia article exists.
-- No simulated clock and no invented fans here: staging runs on the real clock, like production.
-- =====================================================================================================

-- Fixture slot → real player: fixture match 1 is fx-c v fx-f, match 2 fx-e v fx-d, byes fx-a and fx-b.
insert into public.provider_map (provider, kind, provider_ref, our_ref)
select 'fixture', 'match', 'fx-m' || n, n::text from generate_series(1, 6) n
union all
select 'fixture', 'player', ref, id
  from (values ('fx-a', 'alcaraz'), ('fx-b', 'djokovic'), ('fx-c', 'fritz'),
               ('fx-f', 'zverev'), ('fx-d', 'deminaur'), ('fx-e', 'sinner')) v(ref, id)
on conflict (provider, kind, provider_ref) do update set our_ref = excluded.our_ref;

-- Example prizes and terms link so the review shows the layout; replaced with the organiser's text.
update public.event_config set
  launch_at = '2026-10-02 00:00+03',
  prizes = '[{"place":1,"title":"First prize (organiser text to come)","title_ar":"الجائزة الأولى (نص المنظم لاحقاً)","image_path":null},
             {"place":2,"title":"Second prize (organiser text to come)","title_ar":"الجائزة الثانية (نص المنظم لاحقاً)","image_path":null},
             {"place":3,"title":"Third prize (organiser text to come)","title_ar":"الجائزة الثالثة (نص المنظم لاحقاً)","image_path":null}]'
 where id;
