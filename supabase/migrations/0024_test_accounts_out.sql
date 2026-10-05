-- =====================================================================================================
-- 0024 — test accounts are left out of every ranking and every share (Tino, 5 Oct 2026: "Leave them out")
-- An account marked profiles.is_test (by the operator, service role: 0003) keeps its picks and points,
-- but:
--   - gets no rank: recompute_standings ranks the other accounts only (exactly as before among them),
--     a new test account is not ranked by rank_new_fan, and marking or unmarking an account re-ranks
--     everyone at once (trigger below);
--   - is not on any board: the global table walks ranks (already rank is not null), league tables
--     (board_rows) leave it out;
--   - does not count in Crews (members and the best 5), in how fans picked (get_match_crowd's snapshot),
--     or in the share card's percentages (get_my_call_stats).
-- Its own picks, points, Perfect Night badges and reminders work as for anyone.
-- Ranking change approved by Tino on 5 Oct 2026; the scoring of picks is untouched.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- Ranks: as 0006, with test accounts outside the ranking (rank null). Among everyone else the order and
-- every tiebreaker are unchanged.
-- ---------------------------------------------------------------------------------------------------
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
         case when t.is_test then null
              else (row_number() over (partition by t.is_test
                                       order by t.points desc, t.exact_sets desc, t.gap asc nulls last,
                                                t.final_pick_at asc nulls last,
                                                md5(v_seed || ':' || t.user_id::text) asc, t.user_id asc))::int
         end as rank
    from (
      select pr.user_id, pr.is_test,
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
                     from public.picks k where k.match_no = f.match_no) fp
               on fp.user_id = pr.user_id
    ) t
    ) t
   where s.user_id = t.user_id
     and (s.points, s.exact_sets, s.final_games_gap, s.final_pick_at, s.rank)
         is distinct from (t.points, t.exact_sets, t.gap, t.final_pick_at, t.rank);
end;
$$;

-- A new account after the first result is ranked last at once (0017), unless it is a test account.
create or replace function public.rank_new_fan() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_prev text := coalesce(current_setting('skg.settling', true), '');
begin
  if not exists (select 1 from public.standings where rank is not null) then return new; end if;
  if coalesce((select pr.is_test from public.profiles pr where pr.user_id = new.user_id), false) then
    return new;
  end if;
  -- One new fan at a time takes the next place (two sign-ups in the same instant never share one).
  perform pg_advisory_xact_lock(hashtext('skg.rank_new_fan'));
  perform set_config('skg.settling', '1', true);
  update public.standings
     set rank = (select coalesce(max(rank), 0) + 1 from public.standings), updated_at = clock_timestamp()
   where user_id = new.user_id and rank is null;
  perform set_config('skg.settling', v_prev, true);
  return new;
end;
$$;

-- Marking an account as a test account (or back) re-ranks everyone straight away, once ranks exist.
create function public.rerank_on_test_flag() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_prev text := coalesce(current_setting('skg.settling', true), '');
begin
  if not exists (select 1 from public.standings where rank is not null) then return null; end if;
  perform set_config('skg.settling', '1', true);
  perform public.recompute_standings();
  perform set_config('skg.settling', v_prev, true);
  return null;
end;
$$;
revoke all on function public.rerank_on_test_flag() from public, anon, authenticated, service_role;

create trigger profiles_rerank_on_test_flag after update of is_test on public.profiles
  for each row when (old.is_test is distinct from new.is_test)
  execute function public.rerank_on_test_flag();

-- League tables: members, test accounts left out (the global table already shows ranked rows only).
create or replace function public.board_rows(p_league uuid)
returns table (pos int, global_rank int, user_id uuid, display_name text, points int, exact_sets int)
language sql stable security definer
set search_path = public
as $$
  select case when p_league is null then s.rank
              else (row_number() over (order by s.rank nulls last, pr.created_at, s.user_id))::int end,
         s.rank, s.user_id, pr.display_name, s.points, s.exact_sets
    from public.standings s
    join public.profiles pr on pr.user_id = s.user_id
   where not pr.is_test
     and (p_league is null
          or s.user_id in (select lm.user_id from public.league_members lm where lm.league_id = p_league))
$$;

-- ---------------------------------------------------------------------------------------------------
-- How fans picked (0019): the snapshot counts picks of non-test accounts only. Same output, same grants.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.get_match_crowd(p_match int)
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

  -- The snapshot, as in 0012: counted once, by the first call after the start (test accounts left out).
  if not exists (select 1 from public.match_crowd c where c.match_no = p_match) then
    insert into public.match_crowd (match_no, picks, p1_picks, p2_picks, top_score, top_count)
    select p_match,
           count(*)::int,
           (count(*) filter (where k.winner_id = m.p1_id))::int,
           (count(*) filter (where k.winner_id = m.p2_id))::int,
           (select k2.set_scores from public.picks k2
              join public.profiles p2 on p2.user_id = k2.user_id and not p2.is_test
             where k2.match_no = p_match
             group by k2.set_scores order by count(*) desc, k2.set_scores::text limit 1),
           coalesce((select count(*) from public.picks k2
                       join public.profiles p2 on p2.user_id = k2.user_id and not p2.is_test
                      where k2.match_no = p_match
                      group by k2.set_scores order by count(*) desc, k2.set_scores::text limit 1), 0)::int
      from public.picks k
      join public.profiles pr on pr.user_id = k.user_id and not pr.is_test
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

-- ---------------------------------------------------------------------------------------------------
-- The share card (0023): percentages over non-test accounts' picks. Same output, same grants.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.get_my_call_stats(p_match int)
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
    join public.profiles pr on pr.user_id = k.user_id and not pr.is_test
   where k.match_no = p_match;

  if v_total < v_min then
    return query select false, null::int, null::int, null::boolean, null::boolean;
    return;
  end if;

  return query
    select true,
           floor(100.0 * v_winner / v_total)::int,
           floor(100.0 * v_exact / v_total)::int,
           v_winner * 100 <= 40 * v_total,
           v_exact * 100 <= 20 * v_total;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Crews (0021): members and the best 5 counted over non-test accounts. Same output, same grants.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.get_crew_board(p_limit int default 10)
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
    with members as (
      select m.league_id, m.user_id
        from public.league_members m
        join public.profiles pr on pr.user_id = m.user_id and not pr.is_test
    ),
    eligible as (
      select l.id, l.name, l.created_at
        from public.leagues l
       where not l.crew_hidden
         and (select count(*) from members m where m.league_id = l.id) >= v_min
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
        join members m on m.league_id = e.id
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
    select r.rank, r.id,
           btrim(left(btrim(regexp_replace(r.name, '\s+', ' ', 'g')), 24)),
           r.avg_points, r.is_mine
      from ranked r
     where r.rank <= v_limit or r.is_mine
     order by r.rank;
end;
$$;
