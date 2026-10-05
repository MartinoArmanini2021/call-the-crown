-- =====================================================================================================
-- 0020 — how rare a fan's own call was, for the share cards (brief "bragging rights", Phase 3)
-- get_my_call_stats(match) answers one question for the signed-in fan, about their own pick only:
-- of everyone who picked this match, how many backed the same winner, and how many called the same
-- exact score. The card turns that into "Only 7% of fans called this exact score".
--   - No row unless the caller is signed in, has a pick on the match, and the match has started.
--   - Below flags.rarity_min_picks (50) picks: threshold_met = false and every count null. The minimum
--     is enforced here, so a count below it never reaches the browser.
--   - Picks are counted as get_match_crowd counts them (0012, 0019): every pick row on the match.
--   - "Same exact score": the same winner and equal canonical_set_scores (0004), so the same score in
--     a different JSON key order or number form (6 vs 6.0) counts as the same.
-- Reads only; writes nothing. No change to any existing function, table, policy or grant.
-- =====================================================================================================

create function public.get_my_call_stats(p_match int)
returns table (threshold_met boolean, picks_total int, same_winner int, same_exact int)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_min   int := coalesce((select (flags->>'rarity_min_picks')::int from public.event_config), 50);
  v_start timestamptz;
  v_mine  public.picks%rowtype;
  v_total int;
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

  select count(*)::int into v_total from public.picks where match_no = p_match;
  if v_total < v_min then
    return query select false, null::int, null::int, null::int;
    return;
  end if;

  return query
    select true,
           v_total,
           (count(*) filter (where k.winner_id = v_mine.winner_id))::int,
           (count(*) filter (where k.winner_id = v_mine.winner_id
                              and public.canonical_set_scores(k.set_scores)
                                  = public.canonical_set_scores(v_mine.set_scores)))::int
      from public.picks k
     where k.match_no = p_match;
end;
$$;

revoke all on function public.get_my_call_stats(int) from public, anon;
grant execute on function public.get_my_call_stats(int) to authenticated;
