-- =====================================================================================================
-- 0044 - a void final pick counts in no tiebreaker either (audit 5-6 Oct 2026, finding M4; applied on
-- Tino's word, 6 Oct 2026).
-- How to play (htp_lock): "If a match starts earlier than scheduled, a pick saved after it really started
-- does not count." 0018 made such a pick score 0, but recompute_standings (0006) still read every pick
-- on the final for tiebreakers 3 and 4, so a fan who picked DURING the final, knowing the score so far,
-- got the games gap and could win the tiebreak. Change vs 0006: one predicate in the fp sub-query,
-- k.updated_at < the final's real start (the same cut score_match uses; started_at is written by
-- score_match before recompute_standings runs). With no call that counts, the fan ranks after everyone
-- who has one (README). Grants as in 0006.
-- =====================================================================================================
create or replace function public.recompute_standings() returns void
language plpgsql
set search_path = public
as $$
declare
  f             public.matches%rowtype;
  v_final_games int;
  v_seed        text := (select tiebreak_seed from public.event_config);
begin
  select * into f from public.matches where round = 'F' order by match_no limit 1;
  if f.status = 'completed' then
    select sum((e->>'p1_games')::int + (e->>'p2_games')::int)::int into v_final_games
      from jsonb_array_elements(f.set_scores) e;
  end if;

  -- Every account has a row (handle_new_user creates it); this only covers a row that is missing.
  insert into public.standings (user_id)
  select pr.user_id from public.profiles pr
   where not exists (select 1 from public.standings s where s.user_id = pr.user_id)
  on conflict (user_id) do nothing;

  -- Rewrite only the rows whose numbers or rank actually changed.
  update public.standings s
     set points = t.points, exact_sets = t.exact_sets, final_games_gap = t.gap,
         final_pick_at = t.final_pick_at, rank = t.rank, updated_at = clock_timestamp()
    from (
  select t.user_id, t.points, t.exact_sets, t.gap, t.final_pick_at,
         (row_number() over (order by t.points desc, t.exact_sets desc, t.gap asc nulls last,
                                      t.final_pick_at asc nulls last,
                                      md5(v_seed || ':' || t.user_id::text) asc, t.user_id asc))::int as rank
    from (
      select pr.user_id,
             coalesce(a.points, 0)     as points,
             coalesce(a.exact_sets, 0) as exact_sets,
             case when v_final_games is not null and fp.user_id is not null
                  then abs(fp.games - v_final_games) end as gap,
             fp.updated_at as final_pick_at
        from public.profiles pr
        left join (select k.user_id, sum(k.pts_total)::int as points, sum(k.exact_sets)::int as exact_sets
                     from public.picks k where k.pts_total is not null group by k.user_id) a
               on a.user_id = pr.user_id
        left join (select k.user_id, k.updated_at,
                          (select sum((e->>'p1_games')::int + (e->>'p2_games')::int)::int
                             from jsonb_array_elements(k.set_scores) e) as games
                     from public.picks k
                    where k.match_no = f.match_no
                      -- a pick saved at or after the final's real start does not count (0018), here too
                      and k.updated_at < coalesce(f.started_at, 'infinity'::timestamptz)) fp
               on fp.user_id = pr.user_id
    ) t
    ) t
   where s.user_id = t.user_id
     and (s.points, s.exact_sets, s.final_games_gap, s.final_pick_at, s.rank)
         is distinct from (t.points, t.exact_sets, t.gap, t.final_pick_at, t.rank);
end;
$$;
revoke all on function public.recompute_standings() from public, anon, authenticated, service_role;
