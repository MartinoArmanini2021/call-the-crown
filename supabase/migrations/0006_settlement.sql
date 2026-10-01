-- =====================================================================================================
-- 0006 — settlement: score every pick for a match, rebuild the standings, fill the next round.
-- All of it runs in the caller's transaction (ingest_result, 0007) and is idempotent: scores are
-- recomputed from the stored result, never added to, so a corrected result rescores cleanly.
-- None of these functions is executable by anon, authenticated or service_role.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- Guards: a result, a pick's points and a standings line can only change inside settlement, which sets
-- a transaction-local marker. A plain UPDATE from the SQL editor is refused, whatever the role.
-- ---------------------------------------------------------------------------------------------------
create function public.settling() returns boolean
language sql stable
set search_path = public
as $$ select coalesce(current_setting('skg.settling', true), '') = '1' $$;

create function public.guard_match_result() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.settling() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status <> 'scheduled' then raise exception 'result_columns_are_settlement_only'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' or new.winner_id is not null or new.set_scores is not null
       or new.settled_at is not null or new.result_rev <> 0 then
      raise exception 'result_columns_are_settlement_only';
    end if;
    return new;
  end if;
  if (new.status, new.winner_id, new.set_scores, new.settled_at, new.result_rev)
     is distinct from (old.status, old.winner_id, old.set_scores, old.settled_at, old.result_rev) then
    raise exception 'result_columns_are_settlement_only';
  end if;
  return new;
end;
$$;
create trigger matches_result_guard before insert or update or delete on public.matches
  for each row execute function public.guard_match_result();

create function public.guard_settlement_only() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.settling() then raise exception 'scores_are_settlement_only'; end if;
  return new;
end;
$$;
create trigger picks_score_guard before update on public.picks
  for each row
  when ((old.pts_winner, old.pts_sets, old.pts_exact, old.exact_sets, old.pts_total, old.scored_rev)
        is distinct from
        (new.pts_winner, new.pts_sets, new.pts_exact, new.exact_sets, new.pts_total, new.scored_rev))
  execute function public.guard_settlement_only();
create trigger standings_score_guard before update on public.standings
  for each row
  when ((old.points, old.exact_sets, old.final_games_gap, old.final_pick_at, old.rank)
        is distinct from (new.points, new.exact_sets, new.final_games_gap, new.final_pick_at, new.rank))
  execute function public.guard_settlement_only();

-- ---------------------------------------------------------------------------------------------------
-- Potential winner points, stored on the match as soon as both players are known. The app shows these
-- numbers and settlement pays these numbers; nothing recomputes them on the client.
-- ---------------------------------------------------------------------------------------------------
create function public.refresh_match_points(p_match int) returns void
language sql
set search_path = public
as $$
  update public.matches m
     set p1_win_points = case when m.p1_id is not null and m.p2_id is not null then
           public.win_points(m.round,
             (select rank_snapshot from public.players where id = m.p1_id),
             (select rank_snapshot from public.players where id = m.p2_id)) end,
         p2_win_points = case when m.p1_id is not null and m.p2_id is not null then
           public.win_points(m.round,
             (select rank_snapshot from public.players where id = m.p2_id),
             (select rank_snapshot from public.players where id = m.p1_id)) end
   where m.match_no = p_match
$$;

-- ---------------------------------------------------------------------------------------------------
-- Score every pick on one match from its stored result.
--   wrong winner            → 0 on every component
--   right winner            → the stored winner points for that player
--   right number of sets    → the round's flat sets points (completed matches only)
--   each set called exactly → per-set credit when set N of the pick equals set N of the result
--   retired or walkover     → the winner component only; the other two are void for everyone
-- ---------------------------------------------------------------------------------------------------
create function public.score_match(p_match int) returns void
language plpgsql
set search_path = public
as $$
declare
  m          public.matches%rowtype;
  v_rules    jsonb;
  v_sets_pts int;
  v_per_set  int;
  v_len      int;
begin
  select * into m from public.matches where match_no = p_match;
  if m.status = 'scheduled' then return; end if;
  select rules into v_rules from public.event_config;
  v_sets_pts := (v_rules->'sets_points'->>m.round)::int;
  v_per_set  := (v_rules->>'per_set_exact')::int;
  v_len      := coalesce(jsonb_array_length(m.set_scores), 0);

  update public.picks p
     set (pts_winner, pts_sets, exact_sets, pts_exact, pts_total, scored_rev) = (
       select q.w, q.s, q.x, q.x * v_per_set, q.w + q.s + q.x * v_per_set, m.result_rev
         from (
           select
             case when p.winner_id = m.winner_id
                  then case when m.winner_id = m.p1_id then m.p1_win_points else m.p2_win_points end
                  else 0 end as w,
             case when p.winner_id = m.winner_id and m.status = 'completed' and p.sets = v_len
                  then v_sets_pts else 0 end as s,
             case when p.winner_id = m.winner_id and m.status = 'completed'
                  then (select count(*)::int from generate_series(0, least(p.sets, v_len) - 1) i
                         where p.set_scores->i = m.set_scores->i)
                  else 0 end as x
         ) q
     )
   where p.match_no = p_match;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Standings: one pass, a strict rank for every account.
--   1 points ↓   2 sets called exactly ↓   3 distance between the games in the predicted final and
--   the real final ↑ (no call, or a final that was not completed: after everyone who has one)
--   4 time of the last change to the pick on the final ↑ (no pick on the final: last)
--   5 last resort: the earlier account, then the account id. Always decides, so ranks never tie.
-- ---------------------------------------------------------------------------------------------------
create function public.recompute_standings() returns void
language plpgsql
set search_path = public
as $$
declare
  f             public.matches%rowtype;
  v_final_games int;
begin
  select * into f from public.matches where round = 'F' order by match_no limit 1;
  if f.status = 'completed' then
    select sum((e->>'p1_games')::int + (e->>'p2_games')::int)::int into v_final_games
      from jsonb_array_elements(f.set_scores) e;
  end if;

  insert into public.standings as s
    (user_id, points, exact_sets, final_games_gap, final_pick_at, rank, updated_at)
  select t.user_id, t.points, t.exact_sets, t.gap, t.final_pick_at,
         (row_number() over (order by t.points desc, t.exact_sets desc, t.gap asc nulls last,
                                      t.final_pick_at asc nulls last, t.created_at asc, t.user_id asc))::int,
         clock_timestamp()
    from (
      select pr.user_id, pr.created_at,
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
  on conflict (user_id) do update
     set points = excluded.points, exact_sets = excluded.exact_sets,
         final_games_gap = excluded.final_games_gap, final_pick_at = excluded.final_pick_at,
         rank = excluded.rank, updated_at = excluded.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Fill the matches fed by this one (winner → next round, loser of a semi-final → third place).
-- If a corrected result changes a slot that was already filled:
--   next match not started → swap the player, drop the picks that named the removed player, alert;
--   next match started or settled → change nothing, pause that match's settlement, alert.
-- ---------------------------------------------------------------------------------------------------
create function public.advance_bracket(p_match int) returns void
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
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- The one place a result is written. Called only by ingest_result.
-- ---------------------------------------------------------------------------------------------------
create function public.settle_match(p_match int, p_status text, p_winner text, p_set_scores jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform set_config('skg.settling', '1', true);
  update public.matches
     set status = p_status, winner_id = p_winner, set_scores = p_set_scores,
         settled_at = clock_timestamp(), result_rev = result_rev + 1
   where match_no = p_match;
  perform public.score_match(p_match);
  perform public.advance_bracket(p_match);
  perform public.recompute_standings();
  perform set_config('skg.settling', '0', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'settling()', 'guard_match_result()', 'guard_settlement_only()', 'refresh_match_points(int)',
    'score_match(int)', 'recompute_standings()', 'advance_bracket(int)',
    'settle_match(int, text, text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
  end loop;
end $$;
