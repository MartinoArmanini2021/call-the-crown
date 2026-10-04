-- =====================================================================================================
-- 0018 — a pick saved after a match really started does not count (Tino, 4 Oct 2026: "void picks
-- after the real start"; audit F-03)
-- Picks lock at the scheduled start. If a match really starts earlier, picks stay open until the
-- operator runs lock_match_now (0016), and a fan could pick with the match under way. Such a pick is
-- now void: it scores 0 in every component.
--
-- The real start is the provider's, not a person's: at settlement, the first accepted in-play reading
-- (live, completed or retired; refused payloads do not count) of the unbroken run of in-play readings
-- that ends in the result. A reading that
-- says the match has not started ("scheduled") breaks the run, so a short-lived vandal edit that showed
-- scores early and was reverted does not move the start; a feed outage in the middle ("unknown") does
-- not break it. A walkover has no in-play reading: nothing is void. Matches that start on time or late
-- void nothing either (every pick was saved before the scheduled start).
-- The comparison uses the pick's last change (picks.updated_at; a save with no change keeps it). Only
-- the latest version of a pick is kept, so a pick changed after the real start is void as a whole.
-- The real start is stored on the match (matches.started_at) so Results can say why a pick scored 0.
-- =====================================================================================================

alter table public.matches add column started_at timestamptz;   -- the real start, set by settlement

create function public.real_start(p_match int) returns timestamptz
language sql stable
set search_path = public
as $$
  select min(r.seen_at)
    from public.result_log r
   where r.match_no = p_match
     and r.normalised->>'status' in ('live', 'completed', 'retired')
     and r.outcome not like 'rejected%'   -- a refused payload (wrong players, impossible score, a final
                                          -- a day early) is bad data, not evidence of a start
     and r.id > coalesce((select max(x.id) from public.result_log x
                           where x.match_no = p_match and x.normalised->>'status' = 'scheduled'), 0)
$$;
revoke all on function public.real_start(int) from public, anon, authenticated, service_role;

-- score_match as in 0010, plus the real start: a pick last changed at or after it scores nothing.
create or replace function public.score_match(p_match int) returns void
language plpgsql
set search_path = public
as $$
declare
  m          public.matches%rowtype;
  v_rules    jsonb;
  v_sets_pts int;
  v_per_set  int;
  v_len      int;
  v_win_pts  int;
  v_done     boolean;
  v_start    timestamptz;
  v_cut      timestamptz;
begin
  select * into m from public.matches where match_no = p_match;
  if m.status = 'scheduled' then return; end if;
  v_start := case when m.status <> 'walkover' then public.real_start(p_match) end;
  v_cut   := coalesce(v_start, 'infinity');
  update public.matches set started_at = v_start where match_no = p_match;

  select rules into v_rules from public.event_config;
  v_sets_pts := (v_rules->'sets_points'->>m.round)::int;
  v_per_set  := (v_rules->>'per_set_exact')::int;
  v_len      := coalesce(jsonb_array_length(m.set_scores), 0);
  v_win_pts  := case when m.winner_id = m.p1_id then m.p1_win_points else m.p2_win_points end;
  v_done     := m.status = 'completed';

  -- One pass, no per-row sub-query (100,000 picks in one statement). "Right" = the right winner AND
  -- saved before the real start; everything else scores 0.
  update public.picks p
     set pts_winner = case when p.winner_id = m.winner_id and p.updated_at < v_cut then v_win_pts else 0 end,
         pts_sets   = case when p.winner_id = m.winner_id and p.updated_at < v_cut and v_done and p.sets = v_len
                           then v_sets_pts else 0 end,
         exact_sets = case when p.winner_id = m.winner_id and p.updated_at < v_cut and v_done then
                             coalesce((p.set_scores->0 = m.set_scores->0)::int, 0)
                           + coalesce((p.set_scores->1 = m.set_scores->1)::int, 0)
                           + coalesce((p.set_scores->2 = m.set_scores->2)::int, 0)
                           else 0 end,
         pts_exact  = v_per_set * case when p.winner_id = m.winner_id and p.updated_at < v_cut and v_done then
                             coalesce((p.set_scores->0 = m.set_scores->0)::int, 0)
                           + coalesce((p.set_scores->1 = m.set_scores->1)::int, 0)
                           + coalesce((p.set_scores->2 = m.set_scores->2)::int, 0)
                           else 0 end,
         pts_total  = case when p.winner_id = m.winner_id and p.updated_at < v_cut then
                             v_win_pts
                           + case when v_done and p.sets = v_len then v_sets_pts else 0 end
                           + case when v_done then v_per_set * (
                                 coalesce((p.set_scores->0 = m.set_scores->0)::int, 0)
                               + coalesce((p.set_scores->1 = m.set_scores->1)::int, 0)
                               + coalesce((p.set_scores->2 = m.set_scores->2)::int, 0)) else 0 end
                           else 0 end,
         exact_flags = case when p.winner_id = m.winner_id and p.updated_at < v_cut and v_done then
                             array[p.set_scores->0 = m.set_scores->0,
                                   p.set_scores->1 = m.set_scores->1,
                                   p.set_scores->2 = m.set_scores->2]
                           end,
         scored_rev = m.result_rev
   where p.match_no = p_match;
end;
$$;
revoke all on function public.score_match(int) from public, anon, authenticated, service_role;
