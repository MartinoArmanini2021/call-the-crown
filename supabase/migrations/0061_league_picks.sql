-- =====================================================================================================
-- 0061 - league picks: who picked what, among the people you share a league with, once the match has
-- started (Tino, 13 Nov 2026: "Can I see what everyone has predicted in each stage?", for the ATP
-- Finals among friends).
-- get_league_picks(p_match) returns, for a match that has started (its lock has passed, or it really
-- began, or it is settled), the picks of the caller and of every fan who shares at least one league
-- with the caller: display name, whether it is the caller, the picked winner, the picked set scores
-- (in the match's player order, as stored) and the stored points (null until settled). Nothing before
-- the start, so nobody can copy a pick; nothing for a caller in no league; never a user id or email;
-- test accounts (profiles.is_test) are left out unless it is the caller's own row.
-- The client shows the rows; it computes nothing.
-- =====================================================================================================
create function public.get_league_picks(p_match int)
returns table (display_name text, is_me boolean, winner_id text, set_scores jsonb, pts_total int)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  m     public.matches%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select * into m from public.matches where match_no = p_match;
  if not found then return; end if;
  -- not started yet: picks are still open, so they stay private
  if m.status = 'scheduled' and m.started_at is null
     and (m.starts_at is null or m.starts_at > public.app_now()) then
    return;
  end if;
  if not exists (select 1 from public.league_members lm where lm.user_id = v_uid) then return; end if;
  return query
    select pr.display_name, k.user_id = v_uid, k.winner_id, k.set_scores, k.pts_total
      from public.picks k
      join public.profiles pr on pr.user_id = k.user_id
     where k.match_no = p_match
       and (k.user_id = v_uid
            or (not pr.is_test
                and exists (select 1
                              from public.league_members a
                              join public.league_members b on b.league_id = a.league_id
                             where a.user_id = v_uid and b.user_id = k.user_id)))
     order by k.pts_total desc nulls last, (k.user_id = v_uid) desc, pr.display_name;
end;
$$;
revoke all on function public.get_league_picks(int) from public, anon;
grant execute on function public.get_league_picks(int) to authenticated;
