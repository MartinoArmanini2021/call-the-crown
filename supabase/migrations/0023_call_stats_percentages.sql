-- =====================================================================================================
-- 0023 — the share card's rarity in percentages only, never counts (Tino, 5 Oct 2026: "Send % only")
-- get_my_call_stats (0020) returned picks_total, same_winner and same_exact. From 50 picks up, those let
-- anyone read how many fans picked a match. It now returns only what the card shows:
--   winner_pct, exact_pct   whole percentages, rounded down (0 = "under 1%" on the card);
--   winner_rare             same winner on 40% of picks or fewer (the card's "Only 12% backed Fritz");
--   exact_rare              same exact score on 20% of picks or fewer.
-- The comparisons are made here on the exact fractions, so a boundary is never decided by a rounded
-- number. Same conditions as before: no row unless signed in, with a pick, after the start; below
-- flags.rarity_min_picks (50) threshold_met = false and everything else null. Reads only.
-- A new return type needs drop and recreate, which drops the grants: they were "authenticated" only
-- (public and anon revoked) and are re-applied exactly below.
-- =====================================================================================================

drop function public.get_my_call_stats(int);

create function public.get_my_call_stats(p_match int)
returns table (threshold_met boolean, winner_pct int, exact_pct int, winner_rare boolean, exact_rare boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_min    int := coalesce((select (flags->>'rarity_min_picks')::int from public.event_config), 50);
  v_start  timestamptz;
  v_mine   public.picks%rowtype;
  v_total  int;
  v_winner int;
  v_exact  int;
begin
  if v_uid is null then
    return;
  end if;
  select starts_at into v_start from public.matches where match_no = p_match;
  if v_start is null or v_start > public.app_now() then
    return;
  end if;
  select * into v_mine from public.picks where user_id = v_uid and match_no = p_match;
  if not found then
    return;
  end if;

  select count(*)::int,
         (count(*) filter (where k.winner_id = v_mine.winner_id))::int,
         (count(*) filter (where k.winner_id = v_mine.winner_id
                            and public.canonical_set_scores(k.set_scores)
                                = public.canonical_set_scores(v_mine.set_scores)))::int
    into v_total, v_winner, v_exact
    from public.picks k
   where k.match_no = p_match;

  if v_total < v_min then
    return query select false, null::int, null::int, null::boolean, null::boolean;
    return;
  end if;

  return query
    select true,
           floor(100.0 * v_winner / v_total)::int,
           floor(100.0 * v_exact / v_total)::int,
           v_winner * 100 <= 40 * v_total,     -- 40% or fewer, on whole numbers
           v_exact * 100 <= 20 * v_total;      -- 20% or fewer
end;
$$;

revoke all on function public.get_my_call_stats(int) from public, anon;
grant execute on function public.get_my_call_stats(int) to authenticated;
