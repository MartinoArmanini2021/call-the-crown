-- =====================================================================================================
-- 0010 — which sets were called exactly, set by set (UX review, 2 Oct 2026)
-- Settlement already counts the exact sets (picks.exact_sets). The Results screen now shows the pick
-- against the result set by set, with the exact ones marked, so settlement also stores the flags:
--   picks.exact_flags = [set 1, set 2, set 3]: true where set N of the pick equals set N of the
--   result; false where both exist and differ; null where either side has no such set.
--   null for the whole array when no set can count (wrong winner, retirement, walkover).
-- Like every other score column it is written only by settlement (the guard now covers it), and the
-- app only displays it.
-- =====================================================================================================

alter table public.picks add column exact_flags boolean[];

drop trigger picks_score_guard on public.picks;
create trigger picks_score_guard before update on public.picks
  for each row
  when ((old.pts_winner, old.pts_sets, old.pts_exact, old.exact_sets, old.pts_total, old.scored_rev, old.exact_flags)
        is distinct from
        (new.pts_winner, new.pts_sets, new.pts_exact, new.exact_sets, new.pts_total, new.scored_rev, new.exact_flags)
        and current_setting('skg.settling', true) is distinct from '1')
  execute function public.guard_settlement_only();

-- score_match as in 0006, plus exact_flags.
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
begin
  select * into m from public.matches where match_no = p_match;
  if m.status = 'scheduled' then return; end if;
  select rules into v_rules from public.event_config;
  v_sets_pts := (v_rules->'sets_points'->>m.round)::int;
  v_per_set  := (v_rules->>'per_set_exact')::int;
  v_len      := coalesce(jsonb_array_length(m.set_scores), 0);
  v_win_pts  := case when m.winner_id = m.p1_id then m.p1_win_points else m.p2_win_points end;
  v_done     := m.status = 'completed';

  -- One pass, no per-row sub-query (100,000 picks in one statement). A match has at most three sets,
  -- so "sets called exactly" is three direct comparisons of set N against set N; a set either side
  -- does not have compares as null and counts 0.
  -- (The components are written out in each column so the update needs no join.)
  update public.picks p
     set pts_winner = case when p.winner_id = m.winner_id then v_win_pts else 0 end,
         pts_sets   = case when p.winner_id = m.winner_id and v_done and p.sets = v_len then v_sets_pts else 0 end,
         exact_sets = case when p.winner_id = m.winner_id and v_done then
                             coalesce((p.set_scores->0 = m.set_scores->0)::int, 0)
                           + coalesce((p.set_scores->1 = m.set_scores->1)::int, 0)
                           + coalesce((p.set_scores->2 = m.set_scores->2)::int, 0)
                           else 0 end,
         pts_exact  = v_per_set * case when p.winner_id = m.winner_id and v_done then
                             coalesce((p.set_scores->0 = m.set_scores->0)::int, 0)
                           + coalesce((p.set_scores->1 = m.set_scores->1)::int, 0)
                           + coalesce((p.set_scores->2 = m.set_scores->2)::int, 0)
                           else 0 end,
         pts_total  = case when p.winner_id = m.winner_id then
                             v_win_pts
                           + case when v_done and p.sets = v_len then v_sets_pts else 0 end
                           + case when v_done then v_per_set * (
                                 coalesce((p.set_scores->0 = m.set_scores->0)::int, 0)
                               + coalesce((p.set_scores->1 = m.set_scores->1)::int, 0)
                               + coalesce((p.set_scores->2 = m.set_scores->2)::int, 0)) else 0 end
                           else 0 end,
         exact_flags = case when p.winner_id = m.winner_id and v_done then
                             array[p.set_scores->0 = m.set_scores->0,
                                   p.set_scores->1 = m.set_scores->1,
                                   p.set_scores->2 = m.set_scores->2]
                           end,
         scored_rev = m.result_rev
   where p.match_no = p_match;
end;
$$;
revoke all on function public.score_match(int) from public, anon, authenticated, service_role;
