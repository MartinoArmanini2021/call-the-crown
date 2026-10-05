-- =====================================================================================================
-- 0023 — a night does not split at midnight in Riyadh (full debug F1).
-- 0022 numbered nights by the Riyadh calendar date of starts_at. A match that starts after midnight
-- (21:30 UTC = 00:30 Riyadh) then joined the NEXT night (night 1's last match → night 2, whose reminder
-- fired during night 1 and swallowed the real night-2 reminder), or opened a fourth night (on 22 or
-- 24 Oct). A night now runs 06:00 → 05:59 event time: the date of (local start − 6 hours). The app's
-- nightOf (src/lib/callCard.ts) uses the same cut-off. Dense numbering is unchanged.
-- Rule 4 (the night definition): signed off by Tino, 5 Oct 2026. Tests: supabase/tests/nights.sql.
-- =====================================================================================================
create or replace function public.match_nights()
returns table (match_no int, night_no int)
language sql stable
set search_path = public
as $$
  select m.match_no,
         (dense_rank() over (order by ((m.starts_at at time zone c.timezone) - interval '6 hours')::date))::int
    from public.matches m
   cross join public.event_config c
   where m.starts_at is not null
$$;
revoke all on function public.match_nights() from public, anon, authenticated;
