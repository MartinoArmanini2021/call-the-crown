-- =====================================================================================================
-- 0041 - a fan reads only their own picks from the table (audit 5-6 Oct 2026, finding K7; applied on
-- Tino's word, 6 Oct 2026)
-- 0003 let every signed-in fan read every pick of every started match, across all leagues: who picked
-- what, with points and times, joinable to display names through get_leaderboard, and the exact pick
-- count per match (the player count). Other fans' picks now reach a fan only through the two definer
-- functions that scope them: get_league_picks (a league the caller belongs to, after the start) and
-- get_match_crowd (totals, after the start). The app reads the table only for its own picks
-- (src/lib/api.ts, .eq("user_id", uid)), so nothing in the client changes.
-- =====================================================================================================
drop policy "picks: own, or the match has started" on public.picks;
create policy "picks: own rows" on public.picks for select to authenticated
  using (user_id = (select auth.uid()));
