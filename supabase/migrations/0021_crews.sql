-- =====================================================================================================
-- 0021 — Crews: friends leagues ranked against each other (brief "bragging rights", Phase 4)
-- A league enters the Crews table once it has league_limits.crew_min_members (5) members. Its score is
-- the average points of its best 5 members, so a big league has no edge over a group of five.
--   - leagues.crew_hidden: staff moderation (an offensive name), set by SQL only. No function exposes
--     it; a hidden league just never appears on the Crews table.
--   - Members are counted as the global ranking counts fans: every account (recompute_standings ranks
--     every profile, test accounts included), so the two tables agree.
--   - Tiebreak: the best 5's sets called exactly (more first), then the older league, then id.
--   - get_crew_board returns the top p_limit plus the caller's own eligible leagues below it, and never
--     a member count or the number of eligible leagues.
-- Reads only. Data change allowed by the brief: event_config.league_limits.
-- =====================================================================================================

alter table public.leagues add column crew_hidden boolean not null default false;

update public.event_config
   set league_limits = league_limits || '{"crew_min_members": 5}'::jsonb;

create function public.get_crew_board(p_limit int default 10)
returns table (rank int, league_id uuid, name text, avg_points numeric(6,1), is_mine boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_min   int := coalesce((select (league_limits->>'crew_min_members')::int from public.event_config), 5);
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if v_uid is null then
    return;
  end if;
  return query
    with eligible as (
      select l.id, l.name, l.created_at
        from public.leagues l
       where not l.crew_hidden
         and (select count(*) from public.league_members m where m.league_id = l.id) >= v_min
    ),
    best as (
      -- each eligible league's members, best first; no standings row counts as 0
      select e.id,
             coalesce(s.points, 0)     as points,
             coalesce(s.exact_sets, 0) as exact_sets,
             row_number() over (partition by e.id
                                order by coalesce(s.points, 0) desc, coalesce(s.exact_sets, 0) desc,
                                         m.user_id) as n
        from eligible e
        join public.league_members m on m.league_id = e.id
        left join public.standings s on s.user_id = m.user_id
    ),
    scored as (
      select e.id, e.name, e.created_at,
             round(sum(b.points)::numeric / 5, 1)::numeric(6,1) as avg_points,
             sum(b.exact_sets) as exact_sets
        from eligible e
        join best b on b.id = e.id and b.n <= 5
       group by e.id, e.name, e.created_at
    ),
    ranked as (
      select (row_number() over (order by sc.avg_points desc, sc.exact_sets desc,
                                          sc.created_at asc, sc.id asc))::int as rank,
             sc.id, sc.name, sc.avg_points,
             exists (select 1 from public.league_members m
                      where m.league_id = sc.id and m.user_id = v_uid) as is_mine
        from scored sc
    )
    -- the name cleaned as clean_display_name cleans (runs of spaces to one, trimmed), cut to 24
    select r.rank, r.id,
           btrim(left(btrim(regexp_replace(r.name, '\s+', ' ', 'g')), 24)),
           r.avg_points, r.is_mine
      from ranked r
     where r.rank <= v_limit or r.is_mine
     order by r.rank;
end;
$$;

revoke all on function public.get_crew_board(int) from public, anon;
grant execute on function public.get_crew_board(int) to authenticated;
