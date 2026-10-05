-- =====================================================================================================
-- 0019 — no prizes; how fans picked as shares only, above a minimum (brief "bragging rights", Phase 1)
-- Call the Crown runs with no prizes of any kind (bragging rights only), and never shows absolute pick
-- counts. Data changes allowed by the brief: event_config.prizes and event_config.flags.
-- get_match_crowd now returns shares (one decimal) instead of counts, and nothing at all when the match
-- has fewer picks than flags.rarity_min_picks (50). The frozen snapshot in match_crowd is unchanged:
-- counted once by the first call after the start, then read. A new return type needs drop and
-- recreate, which drops the grants: they were "postgres=X, authenticated=X" (anon and public none) and
-- are re-applied exactly below.
-- =====================================================================================================

update public.event_config set prizes = '[]'::jsonb;
update public.event_config set flags = coalesce(flags, '{}'::jsonb) || '{"rarity_min_picks": 50}'::jsonb;

drop function public.get_match_crowd(int);

create function public.get_match_crowd(p_match int)
returns table (p1_share numeric(5,1), p2_share numeric(5,1), top_score jsonb, top_share numeric(5,1))
language plpgsql security definer
set search_path = public
as $$
declare
  m     public.matches%rowtype;
  v_min int := coalesce((select (flags->>'rarity_min_picks')::int from public.event_config), 50);
begin
  select * into m from public.matches where match_no = p_match;
  if not found or m.starts_at is null or m.starts_at > public.app_now() then
    return;
  end if;

  -- The snapshot, exactly as in 0012: counted once, by the first call after the start.
  if not exists (select 1 from public.match_crowd c where c.match_no = p_match) then
    insert into public.match_crowd (match_no, picks, p1_picks, p2_picks, top_score, top_count)
    select p_match,
           count(*)::int,
           (count(*) filter (where k.winner_id = m.p1_id))::int,
           (count(*) filter (where k.winner_id = m.p2_id))::int,
           (select k2.set_scores from public.picks k2 where k2.match_no = p_match
             group by k2.set_scores order by count(*) desc, k2.set_scores::text limit 1),
           coalesce((select count(*) from public.picks k2 where k2.match_no = p_match
                      group by k2.set_scores order by count(*) desc, k2.set_scores::text limit 1), 0)::int
      from public.picks k
     where k.match_no = p_match
    on conflict (match_no) do nothing;
  end if;

  -- Shares only, and only from rarity_min_picks picks up: a count never leaves the database.
  return query
    select round(100.0 * c.p1_picks / c.picks, 1)::numeric(5,1),
           round(100.0 * c.p2_picks / c.picks, 1)::numeric(5,1),
           c.top_score,
           round(100.0 * c.top_count / c.picks, 1)::numeric(5,1)
      from public.match_crowd c
     where c.match_no = p_match and c.picks >= v_min;
end;
$$;

revoke all on function public.get_match_crowd(int) from public, anon;
grant execute on function public.get_match_crowd(int) to authenticated;
