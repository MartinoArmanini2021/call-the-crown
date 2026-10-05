-- =====================================================================================================
-- PROPOSED (Rule 4: RLS policy; NOT applied). Would become supabase/migrations/0019_picks_own_rows.sql.
-- K7: a fan reads only their own picks from the table. Other fans' picks reach a fan only through the
-- two definer RPCs that scope them: get_league_picks (a league the caller belongs to, after the start)
-- and get_match_crowd (totals only, after the start). The app reads the table only for its own picks
-- (src/lib/api.ts myPicksQuery: .eq("user_id", uid)), so nothing in the client changes.
-- Closes: every signed-in fan reading every pick of every started match across all leagues (who picked
-- what, with points and timestamps, joinable to display names via get_leaderboard), and the exact pick
-- count per match (the player count) straight from the table.
-- Verified by tests/verify/k/k.test.ts ("K7 patch …"): the six supabase/tests files (with the one check
-- in security.sql §3 inverted, see k7-security-sql.patch) and tests/verify/k/k7-picks-leak.sql all pass.
-- =====================================================================================================

drop policy "picks: own, or the match has started" on public.picks;
create policy "picks: own rows" on public.picks for select to authenticated
  using (user_id = (select auth.uid()));
