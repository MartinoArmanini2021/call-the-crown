-- =====================================================================================================
-- 0007 — results in, and the operator's controls
-- A result reaches the database through ingest_result and nowhere else. It is called by the results
-- poller (supabase/functions/poll-results) with what the provider said; it checks the payload, logs it
-- and, only if the provider marks the match final and the payload is consistent, settles the match.
-- The operator can set the players and the schedule, pause a match's settlement and ask for a re-fetch.
-- No operator function takes a score.
-- =====================================================================================================

-- result_log is append-only.
create function public.result_log_immutable() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'result_log_is_append_only';
end;
$$;
create trigger result_log_no_change before update or delete on public.result_log
  for each row execute function public.result_log_immutable();
create trigger result_log_no_truncate before truncate on public.result_log
  for each statement execute function public.result_log_immutable();

-- Turns a provider's score array into ours: checks the shape, and swaps the two columns when the
-- provider lists the players the other way round. Returns null when the shape is wrong.
create function public.orient_set_scores(p_scores jsonb, p_flip boolean) returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  v_set jsonb;
  v_out jsonb := '[]'::jsonb;
  v_a   numeric;
  v_b   numeric;
begin
  if p_scores is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_scores) <> 'array' then return null; end if;
  for v_set in select e from jsonb_array_elements(p_scores) with ordinality as t(e, ord) order by ord loop
    if jsonb_typeof(v_set) <> 'object'
       or jsonb_typeof(v_set->'p1_games') is distinct from 'number'
       or jsonb_typeof(v_set->'p2_games') is distinct from 'number' then
      return null;
    end if;
    v_a := (v_set->>'p1_games')::numeric;
    v_b := (v_set->>'p2_games')::numeric;
    if v_a <> trunc(v_a) or v_b <> trunc(v_b) or v_a < 0 or v_b < 0 or v_a > 99 or v_b > 99 then
      return null;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'p1_games', (case when p_flip then v_b else v_a end)::int,
      'p2_games', (case when p_flip then v_a else v_b end)::int));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- ingest_result(provider, normalised, raw, http_status)
--   normalised = {"match_ref": "...", "status": "scheduled|live|completed|retired|walkover",
--                 "players": ["ref of the first player", "ref of the second"],
--                 "winner": "ref", "set_scores": [{"p1_games": 6, "p2_games": 4}, ...]}
--   set_scores follow the order of "players"; provider refs are translated through provider_map.
-- It never raises on a bad payload: it logs the payload with its outcome and returns, so the log and
-- the alert survive. Outcomes: not_final · rejected_unmapped · rejected_invalid · paused · unchanged ·
-- settled · resettled.
-- ---------------------------------------------------------------------------------------------------
create function public.ingest_result(p_provider text, p_normalised jsonb, p_raw jsonb,
                                     p_http_status int default 200)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_ref     text := p_normalised->>'match_ref';
  v_status  text := p_normalised->>'status';
  v_hash    text := encode(sha256(convert_to(coalesce(p_raw::text, ''), 'UTF8')), 'hex');
  v_match   int;
  m         public.matches%rowtype;
  v_a       text;
  v_b       text;
  v_w       text;
  v_flip    boolean;
  v_scores  jsonb;
  v_reason  text;
  v_outcome text;
  v_diff    jsonb;
begin
  select our_ref::int into v_match from public.provider_map
   where provider = p_provider and kind = 'match' and provider_ref = v_ref;

  if v_match is null then
    v_outcome := 'rejected_unmapped';
    v_reason  := 'no provider_map row for this match';
  else
    select * into m from public.matches where match_no = v_match for update;
    if not found then
      v_outcome := 'rejected_unmapped';
      v_reason  := 'provider_map points at a match that does not exist';
    end if;
  end if;

  if v_outcome is null then
    update public.matches set refetch_requested_at = null
     where match_no = v_match and refetch_requested_at is not null;

    if v_status is null or v_status not in ('completed', 'retired', 'walkover') then
      v_outcome := 'not_final';
    else
      select our_ref into v_a from public.provider_map
       where provider = p_provider and kind = 'player' and provider_ref = p_normalised->'players'->>0;
      select our_ref into v_b from public.provider_map
       where provider = p_provider and kind = 'player' and provider_ref = p_normalised->'players'->>1;
      select our_ref into v_w from public.provider_map
       where provider = p_provider and kind = 'player' and provider_ref = p_normalised->>'winner';

      if m.p1_id is null or m.p2_id is null then
        v_reason := 'our match has no players yet';
      elsif v_a is null or v_b is null or v_w is null then
        v_reason := 'a player is missing from provider_map';
      elsif (v_a, v_b) = (m.p1_id, m.p2_id) then
        v_flip := false;
      elsif (v_a, v_b) = (m.p2_id, m.p1_id) then
        v_flip := true;
      else
        v_reason := 'the provider''s players are not the players of our match';
      end if;

      if v_reason is null and v_w not in (m.p1_id, m.p2_id) then
        v_reason := 'the winner is not one of the two players';
      end if;
      if v_reason is null then
        v_scores := public.orient_set_scores(p_normalised->'set_scores', v_flip);
        if v_scores is null then v_reason := 'set_scores is not a list of {p1_games, p2_games}'; end if;
      end if;
      -- A completed match must be a legal score that the stated winner actually wins.
      if v_reason is null and v_status = 'completed' then
        v_reason := public.validate_set_scores(case when v_w = m.p1_id then 1 else 2 end,
                                               jsonb_array_length(v_scores), v_scores);
      end if;

      if v_reason is not null then
        v_outcome := 'rejected_invalid';
      elsif m.settlement_paused then
        v_outcome := 'paused';
      elsif m.status <> 'scheduled'
            and (m.status, m.winner_id, m.set_scores) is not distinct from (v_status, v_w, v_scores) then
        v_outcome := 'unchanged';
      else
        if m.status = 'scheduled' then
          v_outcome := 'settled';
        else
          v_outcome := 'resettled';
          v_diff := jsonb_build_object(
            'before', jsonb_build_object('status', m.status, 'winner', m.winner_id, 'set_scores', m.set_scores),
            'after',  jsonb_build_object('status', v_status, 'winner', v_w, 'set_scores', v_scores));
        end if;
        perform public.settle_match(v_match, v_status, v_w, v_scores);
      end if;
    end if;
  end if;

  insert into public.result_log (match_no, provider, http_status, raw, raw_sha256, normalised, outcome, diff, note)
  values (v_match, p_provider, p_http_status, p_raw, v_hash, p_normalised, v_outcome, v_diff, v_reason);

  if v_outcome in ('rejected_unmapped', 'rejected_invalid') then
    insert into public.ops_alerts (kind, detail) values ('result_rejected',
      jsonb_build_object('match_no', v_match, 'provider', p_provider, 'match_ref', v_ref, 'reason', v_reason));
  elsif v_outcome = 'resettled' then
    insert into public.ops_alerts (kind, detail) values ('result_changed',
      jsonb_build_object('match_no', v_match, 'provider', p_provider) || v_diff);
  end if;

  insert into public.ops_health (key, ok, detail, at) values ('poll-results', true, v_outcome, clock_timestamp())
  on conflict (key) do update set ok = true, detail = excluded.detail, at = excluded.at;

  return jsonb_build_object('outcome', v_outcome, 'match_no', v_match, 'reason', v_reason);
end;
$$;

-- The poller reports its own failures (provider down, bad HTTP status) so a fresh heartbeat is never
-- mistaken for health. Lesson from tennis-fantasy: write the heartbeat on failure too, and check ok.
create function public.ingest_heartbeat(p_ok boolean, p_detail text) returns void
language sql security definer
set search_path = public
as $$
  insert into public.ops_health (key, ok, detail, at)
  values ('poll-results', p_ok, left(p_detail, 500), clock_timestamp())
  on conflict (key) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at
$$;

-- ---------------------------------------------------------------------------------------------------
-- Operator: players and bracket, start times, pause, re-fetch.
-- ---------------------------------------------------------------------------------------------------

-- set_players(players, matches)
--   players = [{"id","name","name_ar","country","seed","rank","image_path"}]
--   matches = [{"match_no","round","p1":{source},"p2":{source}}]   (omit to keep the bracket)
-- Refused once any match has started. Once picks exist, only names and images may change: the ids,
-- the ranks (the upset-bonus snapshot) and the bracket are frozen.
create function public.set_players(p_players jsonb, p_matches jsonb default null) returns void
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
    insert into public.matches (match_no, round, p1_source, p2_source)
    select (e->>'match_no')::int, e->>'round', e->'p1', e->'p2' from jsonb_array_elements(p_matches) e;
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

-- A start time is the lock. It stays editable until the match starts; it cannot be set in the past.
create function public.set_match_start(p_match int, p_starts_at timestamptz) returns void
language plpgsql security definer
set search_path = public
as $$
declare m public.matches%rowtype;
begin
  select * into m from public.matches where match_no = p_match for update;
  if not found then raise exception 'no_such_match'; end if;
  if m.status <> 'scheduled' or (m.starts_at is not null and m.starts_at <= public.app_now()) then
    raise exception 'match_started';
  end if;
  if p_starts_at is null or p_starts_at <= public.app_now() then raise exception 'start_must_be_future'; end if;
  update public.matches set starts_at = p_starts_at where match_no = p_match;
end;
$$;

create function public.pause_settlement(p_match int, p_paused boolean) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.matches set settlement_paused = coalesce(p_paused, false) where match_no = p_match;
  if not found then raise exception 'no_such_match'; end if;
end;
$$;

-- Asks the poller to fetch this match again on its next run, whatever the time window.
create function public.request_refetch(p_match int) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.matches set refetch_requested_at = clock_timestamp() where match_no = p_match;
  if not found then raise exception 'no_such_match'; end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Watchdog checks (the sending is in 0009). Each finding is queued once per hour at most.
-- ---------------------------------------------------------------------------------------------------
create function public.watchdog_check() returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.app_now();
  v_new int := 0;
  r     record;
  h     public.ops_health%rowtype;
begin
  -- a match more than 4 hours past its start with no final result
  for r in select match_no, starts_at from public.matches
            where status = 'scheduled' and starts_at is not null and starts_at < v_now - interval '4 hours' loop
    if not exists (select 1 from public.ops_alerts a
                    where a.kind = 'result_overdue' and (a.detail->>'match_no')::int = r.match_no
                      and a.at > clock_timestamp() - interval '1 hour') then
      insert into public.ops_alerts (kind, detail) values ('result_overdue',
        jsonb_build_object('match_no', r.match_no, 'starts_at', r.starts_at));
      v_new := v_new + 1;
    end if;
  end loop;

  -- during a match window (start − 15 min until settled) the poller must be alive and healthy
  if exists (select 1 from public.matches
              where status = 'scheduled' and starts_at is not null and starts_at - interval '15 minutes' <= v_now) then
    select * into h from public.ops_health where key = 'poll-results';
    if (not found or not h.ok or h.at < clock_timestamp() - interval '5 minutes')
       and not exists (select 1 from public.ops_alerts a
                        where a.kind = 'poller_unhealthy' and a.at > clock_timestamp() - interval '1 hour') then
      insert into public.ops_alerts (kind, detail) values ('poller_unhealthy',
        jsonb_build_object('ok', h.ok, 'detail', h.detail, 'last_seen', h.at));
      v_new := v_new + 1;
    end if;
  end if;
  return v_new;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ingest_result(text, jsonb, jsonb, int)', 'ingest_heartbeat(boolean, text)',
    'set_players(jsonb, jsonb)', 'set_match_start(int, timestamptz)',
    'pause_settlement(int, boolean)', 'request_refetch(int)', 'watchdog_check()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke all on function public.result_log_immutable() from public, anon, authenticated, service_role';
  execute 'revoke all on function public.orient_set_scores(jsonb, boolean) from public, anon, authenticated, service_role';
end $$;
