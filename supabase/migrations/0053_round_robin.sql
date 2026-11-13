-- =====================================================================================================
-- 0053 Round robin: the ATP Finals shape (Tino, 13 Nov 2026: "adapt the prediction game to the ATP
-- Finals and make it perfect"). Additive: the Six Kings bracket (QF/SF/3P/F, winner/loser sources)
-- works exactly as before.
--
--   · round 'RR' with a group name (matches.grp) and, for the first day of each group, matchday 1;
--   · the second and third group days are scheduled by the database itself: once both day-1 matches
--     of a group are settled, the two day-1 winners meet on day 2, the two day-1 losers too (the ATP
--     Finals' own scheduling rule), and the other two pairs play on day 3. Each gets the group's
--     day at event_config.group_schedule.time (local), a conservative lock an operator may move later
--     with set_match_start before it passes;
--   · a slot source {"type":"group","group":"…","place":1|2} fills itself from the group standings
--     once all six group matches are settled, ordered by the ATP Finals rules (wins; two tied: head
--     to head; three tied: % sets won, then % games won, a pair still level by head to head; then
--     the ranking snapshot). A group with more than four players (an alternate came in) is not
--     ordered automatically: ops alert, and the operator fills the slot with set_group_slot;
--   · replace_player: an alternate takes a withdrawn player's unstarted group matches.
-- No result is ever entered by a person: standings are computed from settled results only.
-- =====================================================================================================

alter table public.matches drop constraint if exists matches_round_check;
alter table public.matches add constraint matches_round_check check (round in ('RR', 'QF', 'SF', '3P', 'F'));
alter table public.matches add column grp text;
alter table public.matches add column matchday int check (matchday between 1 and 3);
alter table public.matches add constraint rr_has_group check ((round = 'RR') = (grp is not null));

-- {"time": "14:00", "days": {"<group>": ["2026-11-15", "2026-11-17", "2026-11-19"], …}}
alter table public.event_config add column group_schedule jsonb;

-- ---------------------------------------------------------------------------------------------------
-- set_players: as 0007, plus "group" and "day" on a match. Same freezes.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.set_players(p_players jsonb, p_matches jsonb default null) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_has_picks boolean;
  r           record;
begin
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'players_required';
  end if;
  if exists (select 1 from public.matches
              where status <> 'scheduled' or (starts_at is not null and starts_at <= public.app_now())) then
    raise exception 'event_started';
  end if;
  select exists (select 1 from public.picks) into v_has_picks;

  if v_has_picks then
    if p_matches is not null then raise exception 'picks_exist_bracket_frozen'; end if;
    if exists (
      select 1 from public.players pl
        full join jsonb_array_elements(p_players) e on e->>'id' = pl.id
       where pl.id is null or e is null or (e->>'rank')::int is distinct from pl.rank_snapshot
    ) then
      raise exception 'picks_exist_players_frozen';
    end if;
    update public.players pl
       set name = e->>'name', name_ar = e->>'name_ar', country = e->>'country',
           seed = (e->>'seed')::int, image_path = e->>'image_path'
      from jsonb_array_elements(p_players) e
     where e->>'id' = pl.id;
    return;
  end if;

  if p_matches is not null then
    delete from public.matches where true;   -- "where true": the API role refuses DELETE and UPDATE without WHERE
  else
    update public.matches set p1_id = null, p2_id = null where true;
  end if;
  delete from public.players where id not in (select e->>'id' from jsonb_array_elements(p_players) e);
  insert into public.players (id, name, name_ar, country, seed, rank_snapshot, image_path)
  select e->>'id', e->>'name', e->>'name_ar', e->>'country', (e->>'seed')::int, (e->>'rank')::int,
         e->>'image_path'
    from jsonb_array_elements(p_players) e
  on conflict (id) do update
     set name = excluded.name, name_ar = excluded.name_ar, country = excluded.country,
         seed = excluded.seed, rank_snapshot = excluded.rank_snapshot, image_path = excluded.image_path;

  if p_matches is not null then
    insert into public.matches (match_no, round, p1_source, p2_source, grp, matchday)
    select (e->>'match_no')::int, e->>'round', e->'p1', e->'p2', e->>'group', (e->>'day')::int
      from jsonb_array_elements(p_matches) e;
  end if;
  update public.matches
     set p1_id = case when p1_source->>'type' = 'player' then p1_source->>'id' end,
         p2_id = case when p2_source->>'type' = 'player' then p2_source->>'id' end
   where true;
  for r in select match_no from public.matches loop
    perform public.refresh_match_points(r.match_no);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Group standings, computed from settled results only. Null rows (no result at all) until all of the
-- group's matches are settled. A group whose matches involve more than four players returns nothing.
-- ---------------------------------------------------------------------------------------------------
create function public.group_standings(p_group text)
returns table (place int, player_id text)
language plpgsql stable
set search_path = public
as $$
declare
  v_open   int;
  v_people int;
  v_stats  jsonb := '{}'::jsonb;   -- id → {w, sw, sl, gw, gl, rank}
  v_order  text[];
  v_tied   text[];
  v_out    text[] := '{}';
  v_wins   int;
  i        int;
  m        record;
  s        jsonb;
  a        text;
  b        text;
  c        text;

  -- the head-to-head winner of a and b (null if they did not meet)
begin
  select count(*) filter (where status = 'scheduled'), count(*) into v_open, i
    from public.matches where round = 'RR' and grp = p_group;
  if i = 0 or v_open > 0 then return; end if;

  select count(distinct pid) into v_people
    from (select p1_id as pid from public.matches where round = 'RR' and grp = p_group
          union select p2_id from public.matches where round = 'RR' and grp = p_group) z;
  if v_people <> 4 then return; end if;

  -- per player: wins, sets won/lost, games won/lost (a walkover counts the win, no sets or games)
  for m in select * from public.matches where round = 'RR' and grp = p_group loop
    foreach a in array array[m.p1_id, m.p2_id] loop
      if not v_stats ? a then
        v_stats := v_stats || jsonb_build_object(a, jsonb_build_object(
          'w', 0, 'sw', 0, 'sl', 0, 'gw', 0, 'gl', 0,
          'rank', coalesce((select rank_snapshot from public.players where id = a), 9999)));
      end if;
    end loop;
    v_stats := jsonb_set(v_stats, array[m.winner_id, 'w'], to_jsonb((v_stats->m.winner_id->>'w')::int + 1));
    for s in select * from jsonb_array_elements(coalesce(m.set_scores, '[]'::jsonb)) loop
      -- p1's view
      v_stats := jsonb_set(v_stats, array[m.p1_id, 'gw'], to_jsonb((v_stats->m.p1_id->>'gw')::int + (s->>'p1_games')::int));
      v_stats := jsonb_set(v_stats, array[m.p1_id, 'gl'], to_jsonb((v_stats->m.p1_id->>'gl')::int + (s->>'p2_games')::int));
      v_stats := jsonb_set(v_stats, array[m.p2_id, 'gw'], to_jsonb((v_stats->m.p2_id->>'gw')::int + (s->>'p2_games')::int));
      v_stats := jsonb_set(v_stats, array[m.p2_id, 'gl'], to_jsonb((v_stats->m.p2_id->>'gl')::int + (s->>'p1_games')::int));
      -- a set counts as won only when it was finished (6+ games and two clear, or 7-6)
      if (s->>'p1_games')::int > (s->>'p2_games')::int
         and ((s->>'p1_games')::int >= 6 and ((s->>'p1_games')::int - (s->>'p2_games')::int >= 2 or (s->>'p1_games')::int = 7)) then
        v_stats := jsonb_set(v_stats, array[m.p1_id, 'sw'], to_jsonb((v_stats->m.p1_id->>'sw')::int + 1));
        v_stats := jsonb_set(v_stats, array[m.p2_id, 'sl'], to_jsonb((v_stats->m.p2_id->>'sl')::int + 1));
      elsif (s->>'p2_games')::int > (s->>'p1_games')::int
         and ((s->>'p2_games')::int >= 6 and ((s->>'p2_games')::int - (s->>'p1_games')::int >= 2 or (s->>'p2_games')::int = 7)) then
        v_stats := jsonb_set(v_stats, array[m.p2_id, 'sw'], to_jsonb((v_stats->m.p2_id->>'sw')::int + 1));
        v_stats := jsonb_set(v_stats, array[m.p1_id, 'sl'], to_jsonb((v_stats->m.p1_id->>'sl')::int + 1));
      end if;
    end loop;
  end loop;

  -- wins, best first; each tied block is resolved by public.group_tiebreak
  for v_wins in select distinct (value->>'w')::int as w from jsonb_each(v_stats) order by 1 desc loop
    select array_agg(key order by key) into v_tied from jsonb_each(v_stats) where (value->>'w')::int = v_wins;
    v_out := v_out || public.group_tiebreak(p_group, v_tied, v_stats);
  end loop;

  return query select o.n::int, o.id from unnest(v_out) with ordinality as o(id, n);
end;
$$;

-- Orders players level on wins. Two: head to head. Three: % sets won, then % games won (a pair
-- still level: head to head), then the ranking snapshot. One: itself.
create function public.group_tiebreak(p_group text, p_ids text[], p_stats jsonb) returns text[]
language plpgsql stable
set search_path = public
as $$
declare
  v_n    int := cardinality(p_ids);
  v_keys text[] := array['set', 'game'];
  k      text;
  v_rows record;
  v_vals numeric[];
  v_sorted text[];
  v_groups int;
begin
  if v_n <= 1 then return p_ids; end if;
  if v_n = 2 then return public.group_h2h(p_group, p_ids[1], p_ids[2]); end if;

  -- three (or, with retirements, more) level: % sets, then % games
  foreach k in array v_keys loop
    select array_agg(id order by pct desc, id), count(distinct pct)
      into v_sorted, v_groups
      from (select id,
                   case when (p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int = 0 then 0
                        else round((p_stats->id->>(left(k,1) || 'w'))::numeric
                                   / ((p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int), 6) end as pct
              from unnest(p_ids) as id) z;
    if v_groups = v_n then return v_sorted; end if;          -- all separated
    if v_groups > 1 then
      -- some separated: keep the order, resolve each level block (size 2 → head to head)
      return (
        select array_agg(x order by blk_pct desc, pos)
          from (
            select pct as blk_pct, t.id as x, t.pos
              from (
                select pct, array_agg(id order by id) as ids
                  from (select id,
                               case when (p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int = 0 then 0
                                    else round((p_stats->id->>(left(k,1) || 'w'))::numeric
                                               / ((p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int), 6) end as pct
                          from unnest(p_ids) as id) z
                 group by pct
              ) g
              cross join lateral unnest(public.group_tiebreak(p_group, g.ids, p_stats)) with ordinality as t(id, pos)
          ) q);
    end if;
    -- all still level on this key: try the next one
  end loop;

  -- all level on sets and games: the ranking snapshot (lower is better), then id
  select array_agg(id order by (p_stats->id->>'rank')::int, id) into v_sorted from unnest(p_ids) as id;
  return v_sorted;
end;
$$;

-- Two players: the winner of their group match first (id order if they never met).
create function public.group_h2h(p_group text, a text, b text) returns text[]
language sql stable
set search_path = public
as $$
  select case
           when (select winner_id from public.matches
                  where round = 'RR' and grp = p_group and status <> 'scheduled'
                    and ((p1_id = a and p2_id = b) or (p1_id = b and p2_id = a))
                  order by match_no limit 1) = b then array[b, a]
           when (select winner_id from public.matches
                  where round = 'RR' and grp = p_group and status <> 'scheduled'
                    and ((p1_id = a and p2_id = b) or (p1_id = b and p2_id = a))
                  order by match_no limit 1) = a then array[a, b]
           else array[least(a, b), greatest(a, b)]
         end
$$;

-- ---------------------------------------------------------------------------------------------------
-- advance_groups: (1) schedule days 2 and 3 of a group once its day-1 matches are settled;
-- (2) fill every {"type":"group"} slot from complete standings, with advance_bracket's refill rules.
-- Called from advance_bracket after each settlement (and re-settlement).
-- ---------------------------------------------------------------------------------------------------
create function public.advance_groups() returns void
language plpgsql
set search_path = public
as $$
declare
  v_cfg    jsonb := (select group_schedule from public.event_config limit 1);
  v_tz     text  := coalesce((select timezone from public.event_config limit 1), 'UTC');
  g        text;
  d1       public.matches%rowtype;
  d2       public.matches%rowtype;
  v_win    text[];
  v_lose   text[];
  v_day2   timestamptz;
  v_day3   timestamptz;
  x        public.matches%rowtype;
  v_place  jsonb;
  v_p1     text;
  v_p2     text;
  v_gone   text[];
  v_drop   int;
  v_need   int;
  v_have   int;
begin
  -- (1) days 2 and 3
  if v_cfg is not null then
    for g in select distinct grp from public.matches where round = 'RR' loop
      continue when (select count(*) from public.matches where round = 'RR' and grp = g and matchday = 1) <> 2;
      continue when exists (select 1 from public.matches where round = 'RR' and grp = g and matchday = 1 and status = 'scheduled');
      continue when not exists (select 1 from public.matches where round = 'RR' and grp = g and matchday is null);
      select * into d1 from public.matches where round = 'RR' and grp = g and matchday = 1 order by match_no limit 1;
      select * into d2 from public.matches where round = 'RR' and grp = g and matchday = 1 order by match_no offset 1 limit 1;
      v_win  := array[d1.winner_id, d2.winner_id];
      v_lose := array[case when d1.winner_id = d1.p1_id then d1.p2_id else d1.p1_id end,
                      case when d2.winner_id = d2.p1_id then d2.p2_id else d2.p1_id end];
      v_day2 := ((v_cfg->'days'->g->>1) || ' ' || coalesce(v_cfg->>'time', '14:00'))::timestamp at time zone v_tz;
      v_day3 := ((v_cfg->'days'->g->>2) || ' ' || coalesce(v_cfg->>'time', '14:00'))::timestamp at time zone v_tz;
      continue when v_day2 is null or v_day3 is null;
      for x in select * from public.matches where round = 'RR' and grp = g and matchday is null for update loop
        if (x.p1_id = any (v_win) and x.p2_id = any (v_win)) or (x.p1_id = any (v_lose) and x.p2_id = any (v_lose)) then
          update public.matches set matchday = 2,
                 starts_at = case when starts_at is null and v_day2 > public.app_now() then v_day2 else starts_at end
           where match_no = x.match_no;
        else
          update public.matches set matchday = 3,
                 starts_at = case when starts_at is null and v_day3 > public.app_now() then v_day3 else starts_at end
           where match_no = x.match_no;
        end if;
      end loop;
      insert into public.ops_alerts (kind, detail) values ('group_days_scheduled',
        jsonb_build_object('group', g, 'day2', v_day2, 'day3', v_day3));
    end loop;
  end if;

  -- (2) group slots
  for x in select * from public.matches
            where p1_source->>'type' = 'group' or p2_source->>'type' = 'group'
            order by match_no for update loop
    v_p1 := x.p1_id;
    v_p2 := x.p2_id;
    foreach v_place in array array[x.p1_source, x.p2_source] loop
      continue when v_place->>'type' <> 'group';
      -- a complete group with no automatic order (an alternate came in): say so once, leave the slot
      select count(*), count(*) filter (where status <> 'scheduled') into v_need, v_have
        from public.matches where round = 'RR' and grp = v_place->>'group';
      if v_need > 0 and v_need = v_have
         and not exists (select 1 from public.group_standings(v_place->>'group'))
         and not exists (select 1 from public.ops_alerts a where a.kind = 'group_standings_manual'
                            and a.detail->>'group' = v_place->>'group') then
        insert into public.ops_alerts (kind, detail) values ('group_standings_manual',
          jsonb_build_object('group', v_place->>'group', 'match_no', x.match_no,
            'note', 'the group is complete but has more than four players; fill the slot with set_group_slot'));
      end if;
      if v_place is not distinct from x.p1_source then
        v_p1 := coalesce((select s.player_id from public.group_standings(v_place->>'group') s
                           where s.place = (v_place->>'place')::int), v_p1);
      else
        v_p2 := coalesce((select s.player_id from public.group_standings(v_place->>'group') s
                           where s.place = (v_place->>'place')::int), v_p2);
      end if;
    end loop;
    continue when (v_p1, v_p2) is not distinct from (x.p1_id, x.p2_id);

    v_gone := array_remove(array[
      case when x.p1_id is not null and x.p1_id is distinct from v_p1 then x.p1_id end,
      case when x.p2_id is not null and x.p2_id is distinct from v_p2 then x.p2_id end], null);
    if cardinality(v_gone) > 0 then
      if x.status <> 'scheduled' or (x.starts_at is not null and x.starts_at <= public.app_now()) then
        update public.matches set settlement_paused = true where match_no = x.match_no;
        insert into public.ops_alerts (kind, detail) values ('bracket_conflict',
          jsonb_build_object('match_no', x.match_no,
                             'note', 'a corrected group result changes the players of a match that already started; its settlement is paused'));
        continue;
      end if;
      delete from public.picks where match_no = x.match_no and winner_id = any (v_gone);
      get diagnostics v_drop = row_count;
      insert into public.ops_alerts (kind, detail) values ('bracket_refilled',
        jsonb_build_object('match_no', x.match_no, 'removed_players', to_jsonb(v_gone), 'picks_dropped', v_drop));
    end if;
    update public.matches set p1_id = v_p1, p2_id = v_p2 where match_no = x.match_no;
    perform public.refresh_match_points(x.match_no);
  end loop;
end;
$$;

-- advance_bracket as 0006, then the group step.
create or replace function public.advance_bracket(p_match int) returns void
language plpgsql
set search_path = public
as $$
declare
  m       public.matches%rowtype;
  d       public.matches%rowtype;
  v_loser text;
  v_p1    text;
  v_p2    text;
  v_gone  text[];
  v_drop  int;
begin
  select * into m from public.matches where match_no = p_match;
  if m.status = 'scheduled' then return; end if;
  v_loser := case when m.winner_id = m.p1_id then m.p2_id else m.p1_id end;

  for d in
    select * from public.matches x
     where (x.p1_source->>'type' in ('winner', 'loser') and (x.p1_source->>'match')::int = p_match)
        or (x.p2_source->>'type' in ('winner', 'loser') and (x.p2_source->>'match')::int = p_match)
     order by x.match_no
     for update
  loop
    v_p1 := d.p1_id;
    v_p2 := d.p2_id;
    if d.p1_source->>'type' in ('winner', 'loser') and (d.p1_source->>'match')::int = p_match then
      v_p1 := case d.p1_source->>'type' when 'winner' then m.winner_id else v_loser end;
    end if;
    if d.p2_source->>'type' in ('winner', 'loser') and (d.p2_source->>'match')::int = p_match then
      v_p2 := case d.p2_source->>'type' when 'winner' then m.winner_id else v_loser end;
    end if;
    continue when (v_p1, v_p2) is not distinct from (d.p1_id, d.p2_id);

    v_gone := array_remove(array[
      case when d.p1_id is not null and d.p1_id is distinct from v_p1 then d.p1_id end,
      case when d.p2_id is not null and d.p2_id is distinct from v_p2 then d.p2_id end], null);

    if cardinality(v_gone) > 0 then
      if d.status <> 'scheduled' or (d.starts_at is not null and d.starts_at <= public.app_now()) then
        update public.matches set settlement_paused = true where match_no = d.match_no;
        insert into public.ops_alerts (kind, detail) values ('bracket_conflict',
          jsonb_build_object('match_no', d.match_no, 'changed_by_match', p_match,
                             'note', 'a corrected result changes the players of a match that already started; its settlement is paused'));
        continue;
      end if;
      delete from public.picks where match_no = d.match_no and winner_id = any (v_gone);
      get diagnostics v_drop = row_count;
      insert into public.ops_alerts (kind, detail) values ('bracket_refilled',
        jsonb_build_object('match_no', d.match_no, 'changed_by_match', p_match,
                           'removed_players', to_jsonb(v_gone), 'picks_dropped', v_drop));
    end if;

    update public.matches set p1_id = v_p1, p2_id = v_p2 where match_no = d.match_no;
    perform public.refresh_match_points(d.match_no);
  end loop;

  if m.round = 'RR' then
    perform public.advance_groups();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Operator: an alternate replaces a withdrawn player in the group matches that have not started.
-- Picks on the withdrawn player in those matches are removed (the match he was picked to win no
-- longer has him); picks on the opponent stay, re-priced by refresh_match_points.
-- p_new = {"id","name","name_ar","country","seed","rank","image_path"}
-- ---------------------------------------------------------------------------------------------------
create function public.replace_player(p_old text, p_new jsonb) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  x      public.matches%rowtype;
  v_n    int := 0;
  v_drop int := 0;
  v_d    int;
begin
  if p_old is null or p_new->>'id' is null or (p_new->>'rank') is null then raise exception 'replacement_incomplete'; end if;
  if not exists (select 1 from public.players where id = p_old) then raise exception 'no_such_player'; end if;
  insert into public.players (id, name, name_ar, country, seed, rank_snapshot, image_path)
  values (p_new->>'id', p_new->>'name', p_new->>'name_ar', p_new->>'country', (p_new->>'seed')::int,
          (p_new->>'rank')::int, p_new->>'image_path')
  on conflict (id) do nothing;
  for x in select * from public.matches
            where round = 'RR' and status = 'scheduled' and (p1_id = p_old or p2_id = p_old)
              and (starts_at is null or starts_at > public.app_now())
            for update loop
    delete from public.picks where match_no = x.match_no and winner_id = p_old;
    get diagnostics v_d = row_count;
    v_drop := v_drop + v_d;
    update public.matches
       set p1_id = case when p1_id = p_old then p_new->>'id' else p1_id end,
           p2_id = case when p2_id = p_old then p_new->>'id' else p2_id end,
           p1_source = case when p1_id = p_old then jsonb_build_object('type', 'player', 'id', p_new->>'id') else p1_source end,
           p2_source = case when p2_id = p_old then jsonb_build_object('type', 'player', 'id', p_new->>'id') else p2_source end
     where match_no = x.match_no;
    perform public.refresh_match_points(x.match_no);
    v_n := v_n + 1;
  end loop;
  insert into public.ops_alerts (kind, detail) values ('player_replaced',
    jsonb_build_object('out', p_old, 'in', p_new->>'id', 'matches', v_n, 'picks_dropped', v_drop));
  return jsonb_build_object('matches', v_n, 'picks_dropped', v_drop);
end;
$$;

-- Operator fallback for a group the database cannot order (an alternate played): fills a group-sourced
-- slot from the official standings. Only an unstarted match, only players who played in that group.
create function public.set_group_slot(p_match int, p_side int, p_player text) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  x   public.matches%rowtype;
  src jsonb;
begin
  select * into x from public.matches where match_no = p_match for update;
  if not found then raise exception 'no_such_match'; end if;
  if x.status <> 'scheduled' or (x.starts_at is not null and x.starts_at <= public.app_now()) then
    raise exception 'match_started';
  end if;
  src := case p_side when 1 then x.p1_source when 2 then x.p2_source end;
  if src is null or src->>'type' <> 'group' then raise exception 'not_a_group_slot'; end if;
  if not exists (select 1 from public.matches m where m.round = 'RR' and m.grp = src->>'group'
                    and p_player in (m.p1_id, m.p2_id)) then
    raise exception 'player_not_in_group';
  end if;
  if p_side = 1 then
    delete from public.picks where match_no = p_match and winner_id = x.p1_id and x.p1_id is distinct from p_player;
    update public.matches set p1_id = p_player where match_no = p_match;
  else
    delete from public.picks where match_no = p_match and winner_id = x.p2_id and x.p2_id is distinct from p_player;
    update public.matches set p2_id = p_player where match_no = p_match;
  end if;
  perform public.refresh_match_points(p_match);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- The quick vote names whichever players the event has (0052 hard-coded the six Riyadh ids).
-- ---------------------------------------------------------------------------------------------------
alter table public.quick_votes drop constraint if exists quick_votes_player_id_check;

create or replace function public.cast_quick_vote(p_device uuid, p_player text)
returns table (player_id text, share numeric(5,1))
language plpgsql security definer
set search_path = public
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip      text  := btrim(split_part(coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-forwarded-for', ''), ',', 1));
  v_hash    text  := case when v_ip <> '' then md5('ctc-quick-vote:' || v_ip) end;
begin
  if p_device is null or p_player is null then raise exception 'vote_incomplete'; end if;
  if not exists (select 1 from public.players p where p.id = p_player) then
    raise exception 'unknown_player';
  end if;
  if exists (select 1 from public.matches where starts_at is not null and starts_at <= public.app_now()) then
    raise exception 'voting_closed';
  end if;
  if v_hash is not null
     and not exists (select 1 from public.quick_votes q where q.device_id = p_device)
     and (select count(*) from public.quick_votes q
           where q.ip_hash = v_hash and q.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_votes';
  end if;
  insert into public.quick_votes as q (device_id, player_id, ip_hash)
  values (p_device, p_player, v_hash)
  on conflict (device_id) do update set player_id = excluded.player_id, updated_at = now();
  return query select * from public.get_quick_vote_shares();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Privileges: internal helpers for nobody; operator RPCs for service_role only; the vote as before.
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.group_standings(text) from public, anon, authenticated, service_role;
revoke all on function public.group_tiebreak(text, text[], jsonb) from public, anon, authenticated, service_role;
revoke all on function public.group_h2h(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.advance_groups() from public, anon, authenticated, service_role;
revoke all on function public.advance_bracket(int) from public, anon, authenticated, service_role;
revoke all on function public.set_players(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.replace_player(text, jsonb) from public, anon, authenticated;
revoke all on function public.set_group_slot(int, int, text) from public, anon, authenticated;
grant execute on function public.set_players(jsonb, jsonb) to service_role;
grant execute on function public.replace_player(text, jsonb) to service_role;
grant execute on function public.set_group_slot(int, int, text) to service_role;
revoke all on function public.cast_quick_vote(uuid, text) from public;
grant execute on function public.cast_quick_vote(uuid, text) to anon, authenticated;
