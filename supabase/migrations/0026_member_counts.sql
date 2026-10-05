-- =====================================================================================================
-- 0026 — displayed member counts leave test accounts out
-- (Audit Part 1 review of 0025, Tino 5 Oct 2026)
-- 0025 left test accounts off the boards, but three numbers fans see still counted them:
--   - get_leaderboard(p_league).total: "#2 of 6 in Office Crew" on Picks while the table showed 5;
--   - my_leagues().member_count: Crews' "needs N more" (a league of 4 fans + 1 test account showed
--     neither on the board nor as "needs 1 more"), and the league bar's "N members";
--   - reminder_candidates().league_size: "You're #2 of 6 in …" in the reminder email.
-- They now count non-test members only. Seats are unchanged: max_members and the join/leave rules
-- (join_league, create_league) keep counting every member, so a test account still takes a seat.
-- Same signatures, outputs and grants (create or replace).
-- =====================================================================================================

create or replace function public.get_leaderboard(p_league uuid default null, p_offset int default 0, p_limit int default 50)
returns table (pos int, global_rank int, user_id uuid, display_name text, points int, exact_sets int,
               is_me boolean, total int)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.assert_board_access(p_league);
  if p_league is null then
    -- Global: walk the rank index, never sort 100,000 rows for one page. Accounts created since the
    -- last settlement have no rank yet and appear after the next one.
    return query
      select s.rank, s.rank, s.user_id, pr.display_name, s.points, s.exact_sets, s.user_id = auth.uid(),
             (select count(*)::int from public.standings x where x.rank is not null)
        from public.standings s join public.profiles pr on pr.user_id = s.user_id
       where s.rank is not null
       order by s.rank
       offset greatest(coalesce(p_offset, 0), 0)
       limit least(greatest(coalesce(p_limit, 50), 1), 100);
  else
    return query
      select b.pos, b.global_rank, b.user_id, b.display_name, b.points, b.exact_sets,
             b.user_id = auth.uid(),
             (select count(*)::int from public.league_members lm
                join public.profiles px on px.user_id = lm.user_id and not px.is_test
               where lm.league_id = p_league)
        from public.board_rows(p_league) b
       order by b.pos, b.user_id
       offset greatest(coalesce(p_offset, 0), 0)
       limit least(greatest(coalesce(p_limit, 50), 1), 100);
  end if;
end;
$$;

create or replace function public.my_leagues()
returns table (id uuid, name text, code text, is_owner boolean, member_count int)
language sql stable security definer
set search_path = public
as $$
  select l.id, l.name, l.code, l.owner_id = auth.uid(),
         (select count(*)::int from public.league_members x
            join public.profiles px on px.user_id = x.user_id and not px.is_test
           where x.league_id = l.id)
    from public.leagues l
    join public.league_members me on me.league_id = l.id and me.user_id = auth.uid()
   order by l.created_at
$$;

create or replace function public.reminder_candidates()
returns table (user_id uuid, email text, locale text, night_no int, first_start timestamptz,
               open_count int, total_count int,
               league_name text, league_rank int, league_size int)
language sql stable security definer
set search_path = public
as $$
  with nights as (
    select n.night_no, m.match_no, m.starts_at, m.p1_id, m.p2_id
      from public.match_nights() n join public.matches m on m.match_no = n.match_no
  ),
  due as (
    select night_no, min(starts_at) as first_start, count(*)::int as total_count
      from nights group by night_no
    having min(starts_at) > public.app_now() and min(starts_at) <= public.app_now() + interval '2 hours'
  ),
  opted as (
    select distinct on (c.user_id) c.user_id, c.granted
      from public.consents c where c.party = 'reminders'
     order by c.user_id, c.changed_at desc
  ),
  open_per_fan as (
    select o.user_id, d.night_no, d.first_start, d.total_count,
           (select count(*)::int from nights x
             where x.night_no = d.night_no and x.p1_id is not null and x.p2_id is not null
               and x.starts_at > public.app_now()
               and not exists (select 1 from public.picks k
                                where k.user_id = o.user_id and k.match_no = x.match_no)) as open_count
      from opted o cross join due d
     where o.granted
  )
  select f.user_id, u.email::text, coalesce(p.locale, 'en'), f.night_no, f.first_start,
         f.open_count, f.total_count, lg.name, lg.pos, lg.size
    from open_per_fan f
    join auth.users u on u.id = f.user_id and u.email_confirmed_at is not null
    left join public.profiles p on p.user_id = f.user_id
    left join lateral (
      select l.name,
             (select count(*)::int + 1 from public.league_members m2
                join public.standings s2 on s2.user_id = m2.user_id
               where m2.league_id = l.id and s2.rank < s.rank) as pos,
             (select count(*)::int from public.league_members m3
                join public.profiles p3 on p3.user_id = m3.user_id and not p3.is_test
               where m3.league_id = l.id) as size
        from public.league_members m
        join public.leagues l on l.id = m.league_id
        join public.standings s on s.user_id = f.user_id
       where m.user_id = f.user_id and s.rank is not null
         and exists (select 1 from public.matches z where z.settled_at is not null)
       order by m.joined_at desc
       limit 1
    ) lg on true
   where f.open_count > 0
     and not exists (select 1 from public.reminder_sends r
                      where r.user_id = f.user_id and r.night_no = f.night_no)
$$;
