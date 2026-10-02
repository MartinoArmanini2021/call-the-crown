-- =====================================================================================================
-- 0012 — how fans picked each match, as totals (first-time-fan test, 2 Oct 2026)
-- Once a match has started its picks are public to signed-in fans (picks policy, 0003); this shows them
-- as totals only, never names: how many picked each player, and the most picked score.
-- Picks cannot change once a match starts, so the totals are final at the first ball. They are counted
-- once, by the first call after the start, and kept in match_crowd: thousands of fans refreshing Results
-- during a match read one row instead of re-counting up to 100,000 picks each time.
-- =====================================================================================================

create table public.match_crowd (
  match_no      int primary key references public.matches (match_no) on delete cascade,
  picks         int not null,
  p1_picks      int not null,
  p2_picks      int not null,
  top_score     jsonb,          -- the most picked set scores, fixed order (player 1's games first)
  top_count     int not null,
  computed_at   timestamptz not null default public.app_now()
);
alter table public.match_crowd enable row level security;
revoke all on public.match_crowd from anon, authenticated;
-- No policy: served only by get_match_crowd.

-- Nothing before the match starts (the same moment the picks policy opens them).
create function public.get_match_crowd(p_match int)
returns table (picks int, p1_picks int, p2_picks int, top_score jsonb, top_count int)
language plpgsql security definer
set search_path = public
as $$
declare m public.matches%rowtype;
begin
  select * into m from public.matches where match_no = p_match;
  if not found or m.starts_at is null or m.starts_at > public.app_now() then
    return;
  end if;

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

  return query
    select c.picks, c.p1_picks, c.p2_picks, c.top_score, c.top_count
      from public.match_crowd c where c.match_no = p_match;
end;
$$;

revoke all on function public.get_match_crowd(int) from public, anon;
grant execute on function public.get_match_crowd(int) to authenticated;
