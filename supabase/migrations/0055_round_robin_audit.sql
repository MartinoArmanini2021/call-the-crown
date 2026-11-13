-- =====================================================================================================
-- 0055 Round robin fixes from the backend audit of 13 Nov 2026 (before the first ATP Finals lock, Sun
-- 15 Nov 14:00). Changes against 0053 / 0016 only; grants as before. Tests:
-- supabase/tests/round_robin_tiebreak_rules.sql, round_robin_repair.sql, round_robin_reseat.sql.
--
-- 1 group_standings / group_tiebreak follow the ATP Finals rule on retirements (ATP Rulebook 2026, 4.01
--   "In applying the tie-breaking procedures, a conduct default or retirement shall count as a
--   straight-set win or loss", and games won or lost in matches with the retiring player do not count
--   for the % of games). 0053 counted only the sets finished before the retirement, so a player who
--   retired after winning a set kept it, and a three-way tie could put the wrong player in a semi-final
--   (the real semi-final would then never match ours: refused for good). Now a retirement is 2-0 in
--   sets for the winner. When a three-way tie has to go to % of games in a group with a retirement, the
--   rule (which matches are left out; "a player completing less than all three matches is eliminated")
--   is not something to guess: the group is left to the operator (ops alert, set_group_slot), as a
--   group with an alternate already is. The same for a group with a walkover (no ATP text on how it
--   counts in sets, games or "matches played").
-- 2 advance_groups re-pairs days 2 and 3 when a corrected day-1 result changes who won on day 1 (0053
--   paired them once, so the winners' match kept the losers' day and lock: picks stayed open while it
--   was played, and the poller did not read it until a day later). Only matches that have not started
--   and are between the group's day-1 players move (an alternate's matches stay where they are);
--   announced as "group_days_rescheduled". A day whose 14:00 has already passed when it is scheduled
--   (results arriving very late) locks at once instead of leaving the match with no start, which made it
--   unpickable and never polled.
-- 3 reseat_paused_match takes a group-fed slot from the corrected standings (0016 handled winner/loser
--   slots only, so a paused semi-final kept the players of the uncorrected group and was refused for good).
-- 4 replace_player refuses a "replacement" who is already in the draw or is the withdrawn player.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1 Standings
-- ---------------------------------------------------------------------------------------------------
create or replace function public.group_standings(p_group text)
returns table (place int, player_id text)
language plpgsql stable
set search_path = public
as $$
declare
  v_open   int;
  v_people int;
  v_retired boolean;
  v_stats  jsonb := '{}'::jsonb;   -- id → {w, sw, sl, gw, gl, rank, nog}
  v_out    text[] := '{}';
  v_wins   int;
  v_tied   text[];
  v_loser  text;
  i        int;
  m        record;
  s        jsonb;
  a        text;
begin
  select count(*) filter (where status = 'scheduled'), count(*) into v_open, i
    from public.matches where round = 'RR' and grp = p_group;
  if i = 0 or v_open > 0 then return; end if;

  select count(distinct pid) into v_people
    from (select p1_id as pid from public.matches where round = 'RR' and grp = p_group
          union select p2_id from public.matches where round = 'RR' and grp = p_group) z;
  if v_people <> 4 then return; end if;
  -- a walkover: how it counts (sets, games, "matches played") is not written down: the operator decides
  if exists (select 1 from public.matches where round = 'RR' and grp = p_group and status = 'walkover') then
    return;
  end if;
  v_retired := exists (select 1 from public.matches where round = 'RR' and grp = p_group and status = 'retired');

  for m in select * from public.matches where round = 'RR' and grp = p_group loop
    foreach a in array array[m.p1_id, m.p2_id] loop
      if not v_stats ? a then
        v_stats := v_stats || jsonb_build_object(a, jsonb_build_object(
          'w', 0, 'sw', 0, 'sl', 0, 'gw', 0, 'gl', 0,
          'rank', coalesce((select rank_snapshot from public.players where id = a), 9999),
          'nog', v_retired));       -- % of games is not decided automatically in a group with a retirement
      end if;
    end loop;
    v_stats := jsonb_set(v_stats, array[m.winner_id, 'w'], to_jsonb((v_stats->m.winner_id->>'w')::int + 1));
    if m.status = 'retired' then
      -- ATP: a retirement is a straight-set win or loss; its games are not counted
      v_loser := case when m.winner_id = m.p1_id then m.p2_id else m.p1_id end;
      v_stats := jsonb_set(v_stats, array[m.winner_id, 'sw'], to_jsonb((v_stats->m.winner_id->>'sw')::int + 2));
      v_stats := jsonb_set(v_stats, array[v_loser, 'sl'], to_jsonb((v_stats->v_loser->>'sl')::int + 2));
      continue;
    end if;
    for s in select * from jsonb_array_elements(coalesce(m.set_scores, '[]'::jsonb)) loop
      v_stats := jsonb_set(v_stats, array[m.p1_id, 'gw'], to_jsonb((v_stats->m.p1_id->>'gw')::int + (s->>'p1_games')::int));
      v_stats := jsonb_set(v_stats, array[m.p1_id, 'gl'], to_jsonb((v_stats->m.p1_id->>'gl')::int + (s->>'p2_games')::int));
      v_stats := jsonb_set(v_stats, array[m.p2_id, 'gw'], to_jsonb((v_stats->m.p2_id->>'gw')::int + (s->>'p2_games')::int));
      v_stats := jsonb_set(v_stats, array[m.p2_id, 'gl'], to_jsonb((v_stats->m.p2_id->>'gl')::int + (s->>'p1_games')::int));
      if (s->>'p1_games')::int > (s->>'p2_games')::int then
        v_stats := jsonb_set(v_stats, array[m.p1_id, 'sw'], to_jsonb((v_stats->m.p1_id->>'sw')::int + 1));
        v_stats := jsonb_set(v_stats, array[m.p2_id, 'sl'], to_jsonb((v_stats->m.p2_id->>'sl')::int + 1));
      else
        v_stats := jsonb_set(v_stats, array[m.p2_id, 'sw'], to_jsonb((v_stats->m.p2_id->>'sw')::int + 1));
        v_stats := jsonb_set(v_stats, array[m.p1_id, 'sl'], to_jsonb((v_stats->m.p1_id->>'sl')::int + 1));
      end if;
    end loop;
  end loop;

  for v_wins in select distinct (value->>'w')::int as w from jsonb_each(v_stats) order by 1 desc loop
    select array_agg(key order by key) into v_tied from jsonb_each(v_stats) where (value->>'w')::int = v_wins;
    v_out := v_out || public.group_tiebreak(p_group, v_tied, v_stats);
  end loop;
  -- a tie the rules leave to a person (group_tiebreak gave null for it): no automatic order at all
  if coalesce(cardinality(v_out), 0) <> v_people then return; end if;

  return query select o.n::int, o.id from unnest(v_out) with ordinality as o(id, n);
end;
$$;

-- As 0053, plus: null (no automatic order) when % of games must decide and the group had a retirement.
create or replace function public.group_tiebreak(p_group text, p_ids text[], p_stats jsonb) returns text[]
language plpgsql stable
set search_path = public
as $$
declare
  v_n    int := cardinality(p_ids);
  v_keys text[] := array['set', 'game'];
  k      text;
  v_sorted text[];
  v_groups int;
  v_part text[];
begin
  if v_n <= 1 then return p_ids; end if;
  if v_n = 2 then return public.group_h2h(p_group, p_ids[1], p_ids[2]); end if;

  foreach k in array v_keys loop
    if k = 'game' and coalesce((p_stats->p_ids[1]->>'nog')::boolean, false) then return null; end if;
    select array_agg(id order by pct desc, id), count(distinct pct)
      into v_sorted, v_groups
      from (select id,
                   case when (p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int = 0 then 0
                        else round((p_stats->id->>(left(k,1) || 'w'))::numeric
                                   / ((p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int), 6) end as pct
              from unnest(p_ids) as id) z;
    if v_groups = v_n then return v_sorted; end if;
    if v_groups > 1 then
      -- some separated: keep the order, resolve each level block (size 2 → head to head)
      v_sorted := '{}';
      for v_part in
        select array_agg(id order by id)
          from (select id,
                       case when (p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int = 0 then 0
                            else round((p_stats->id->>(left(k,1) || 'w'))::numeric
                                       / ((p_stats->id->>(left(k,1) || 'w'))::int + (p_stats->id->>(left(k,1) || 'l'))::int), 6) end as pct
                  from unnest(p_ids) as id) z
         group by pct order by pct desc
      loop
        v_part := public.group_tiebreak(p_group, v_part, p_stats);
        if v_part is null then return null; end if;
        v_sorted := v_sorted || v_part;
      end loop;
      return v_sorted;
    end if;
  end loop;

  select array_agg(id order by (p_stats->id->>'rank')::int, id) into v_sorted from unnest(p_ids) as id;
  return v_sorted;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2 advance_groups: days 2 and 3 (re-paired after a corrected day-1 result), then the group slots
-- ---------------------------------------------------------------------------------------------------
create or replace function public.advance_groups() returns void
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
  v_day1p  text[];
  v_day2   timestamptz;
  v_day3   timestamptz;
  v_day    int;
  v_at     timestamptz;
  v_new    int;
  v_moved  jsonb;
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
      select * into d1 from public.matches where round = 'RR' and grp = g and matchday = 1 order by match_no limit 1;
      select * into d2 from public.matches where round = 'RR' and grp = g and matchday = 1 order by match_no offset 1 limit 1;
      v_win  := array[d1.winner_id, d2.winner_id];
      v_lose := array[case when d1.winner_id = d1.p1_id then d1.p2_id else d1.p1_id end,
                      case when d2.winner_id = d2.p1_id then d2.p2_id else d2.p1_id end];
      v_day1p := v_win || v_lose;
      v_day2 := ((v_cfg->'days'->g->>1) || ' ' || coalesce(v_cfg->>'time', '14:00'))::timestamp at time zone v_tz;
      v_day3 := ((v_cfg->'days'->g->>2) || ' ' || coalesce(v_cfg->>'time', '14:00'))::timestamp at time zone v_tz;
      continue when v_day2 is null or v_day3 is null;
      v_new := 0;
      v_moved := '[]'::jsonb;
      for x in select * from public.matches where round = 'RR' and grp = g and matchday is distinct from 1
                order by match_no for update loop
        v_day := case when (x.p1_id = any (v_win) and x.p2_id = any (v_win))
                        or (x.p1_id = any (v_lose) and x.p2_id = any (v_lose)) then 2 else 3 end;
        continue when x.matchday = v_day;
        -- a day whose time has passed locks now: a match with no start is never pickable nor polled
        v_at := greatest(case v_day when 2 then v_day2 else v_day3 end, public.app_now());
        if x.matchday is null then
          update public.matches set matchday = v_day, starts_at = coalesce(starts_at, v_at)
           where match_no = x.match_no;
          v_new := v_new + 1;
        else
          -- a corrected day-1 result: move only an unstarted match between the group's day-1 players
          continue when x.status <> 'scheduled' or (x.starts_at is not null and x.starts_at <= public.app_now());
          continue when not (x.p1_id = any (v_day1p) and x.p2_id = any (v_day1p));
          update public.matches set matchday = v_day, starts_at = v_at where match_no = x.match_no;
          v_moved := v_moved || jsonb_build_object('match_no', x.match_no, 'day', v_day, 'starts_at', v_at,
                                                   'was', jsonb_build_object('day', x.matchday, 'starts_at', x.starts_at));
        end if;
      end loop;
      if v_new > 0 then
        insert into public.ops_alerts (kind, detail) values ('group_days_scheduled',
          jsonb_build_object('group', g, 'day2', v_day2, 'day3', v_day3));
      end if;
      if jsonb_array_length(v_moved) > 0 then
        insert into public.ops_alerts (kind, detail) values ('group_days_rescheduled',
          jsonb_build_object('group', g, 'moved', v_moved,
            'note', 'a corrected day-1 result changed the day-2 pairs; check the real order of play (set_match_start)'));
      end if;
    end loop;
  end if;

  -- (2) group slots (as 0053; the manual note covers every case group_standings leaves to a person)
  for x in select * from public.matches
            where p1_source->>'type' = 'group' or p2_source->>'type' = 'group'
            order by match_no for update loop
    v_p1 := x.p1_id;
    v_p2 := x.p2_id;
    foreach v_place in array array[x.p1_source, x.p2_source] loop
      continue when v_place->>'type' <> 'group';
      select count(*), count(*) filter (where status <> 'scheduled') into v_need, v_have
        from public.matches where round = 'RR' and grp = v_place->>'group';
      if v_need > 0 and v_need = v_have
         and not exists (select 1 from public.group_standings(v_place->>'group'))
         and not exists (select 1 from public.ops_alerts a where a.kind = 'group_standings_manual'
                            and a.detail->>'group' = v_place->>'group') then
        insert into public.ops_alerts (kind, detail) values ('group_standings_manual',
          jsonb_build_object('group', v_place->>'group', 'match_no', x.match_no,
            'note', 'the group is complete but is not ordered automatically (an alternate played, a walkover, '
                    || 'or a three-way tie on % of games after a retirement); fill the slot from the official '
                    || 'standings with set_group_slot'));
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

-- ---------------------------------------------------------------------------------------------------
-- 3 reseat_paused_match: as 0016, plus group-fed slots from the (corrected) standings
-- ---------------------------------------------------------------------------------------------------
create or replace function public.reseat_paused_match(p_match int) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  d    public.matches%rowtype;
  v_p  text[];
  s    jsonb;
  src  public.matches%rowtype;
begin
  select * into d from public.matches where match_no = p_match for update;
  if not found then raise exception 'no_such_match'; end if;
  if not d.settlement_paused then raise exception 'not_paused'; end if;
  if d.status <> 'scheduled' then raise exception 'match_settled'; end if;
  v_p := array[d.p1_id, d.p2_id];
  for i in 1 .. 2 loop
    s := case i when 1 then d.p1_source else d.p2_source end;
    if s->>'type' in ('winner', 'loser') then
      select * into src from public.matches where match_no = (s->>'match')::int;
      if src.status <> 'scheduled' and src.winner_id is not null then
        v_p[i] := case s->>'type' when 'winner' then src.winner_id
                  else case when src.winner_id = src.p1_id then src.p2_id else src.p1_id end end;
      end if;
    elsif s->>'type' = 'group' then
      v_p[i] := coalesce((select g.player_id from public.group_standings(s->>'group') g
                           where g.place = (s->>'place')::int), v_p[i]);
    end if;
  end loop;
  update public.matches set p1_id = v_p[1], p2_id = v_p[2], settlement_paused = false
   where match_no = p_match;
  perform public.refresh_match_points(p_match);
  insert into public.ops_alerts (kind, detail) values ('match_reseated',
    jsonb_build_object('match_no', p_match, 'before', to_jsonb(array[d.p1_id, d.p2_id]), 'after', to_jsonb(v_p)));
  return jsonb_build_object('match_no', p_match, 'p1', v_p[1], 'p2', v_p[2]);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4 replace_player: as 0053, plus the replacement must be new to the draw
-- ---------------------------------------------------------------------------------------------------
create or replace function public.replace_player(p_old text, p_new jsonb) returns jsonb
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
  if p_new->>'id' = p_old or exists (select 1 from public.matches where p_new->>'id' in (p1_id, p2_id)) then
    raise exception 'replacement_already_in_draw';
  end if;
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

-- Privileges exactly as 0053 / 0016 (create or replace keeps them; restated so this file stands alone).
revoke all on function public.group_standings(text) from public, anon, authenticated, service_role;
revoke all on function public.group_tiebreak(text, text[], jsonb) from public, anon, authenticated, service_role;
revoke all on function public.advance_groups() from public, anon, authenticated, service_role;
revoke all on function public.reseat_paused_match(int) from public, anon, authenticated;
revoke all on function public.replace_player(text, jsonb) from public, anon, authenticated;
grant execute on function public.reseat_paused_match(int) to service_role;
grant execute on function public.replace_player(text, jsonb) to service_role;
