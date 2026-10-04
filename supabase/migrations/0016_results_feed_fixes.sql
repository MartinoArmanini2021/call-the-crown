-- =====================================================================================================
-- 0016 — results feed: fixes for audit findings F-03, F-05, F-06, F-07, F-08 and F-09 (3 Oct 2026)
-- F-05 ingest_result wrote "healthy" after every payload, so a failing or unmapped match was hidden by
--      the next match's healthy reading. Health is now written once per poller run, by the poller
--      (poll.ts), from every match it visited; ingest_result no longer touches it.
-- F-07 Retired and walkover payloads skipped every score check. A walkover now carries no sets; a
--      retirement has complete legal sets except the last, which may be unfinished, and neither player
--      had already won.
-- F-09 After the first 30 minutes a settled match was read only every 10 minutes, and "unchanged for
--      10 minutes" counted the first and last of a run of log rows: two readings 10 minutes apart could
--      re-settle a 2-minute vandal edit. Now a match whose result is waiting to be confirmed is read on
--      every run, and any gap of more than 3 minutes between readings restarts the clock.
-- F-08 A corrected result that changed a match already under way paused that match for good.
--      reseat_paused_match(n) takes the players from the corrected bracket and resumes settlement. It
--      takes no score: the provider still settles the match.
-- F-03 / F-06 A match really under way (or a walkover announced) before its scheduled start kept picks
--      open with nothing telling the operator. A live or final reading before the start now raises an
--      immediate "started_before_schedule" alert, and lock_match_now(n) closes the picks at once.
--      (Whether picks made after the real start are voided is a rule for Tino, not code.)
-- =====================================================================================================

-- One legal complete set (from the configured list, either player winning it).
create function public.is_complete_set(a int, b int) returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from jsonb_array_elements((select rules->'allowed_set_scores' from public.event_config)) e
     where ((e->>0)::int, (e->>1)::int) in ((a, b), (b, a)))
$$;
revoke all on function public.is_complete_set(int, int) from public, anon, authenticated;

-- A retirement: null when plausible, else the reason (F-07). Winner = 1 or 2, scores in our order.
create function public.validate_retirement(p_winner int, p_scores jsonb) returns text
language plpgsql stable
set search_path = public
as $$
declare
  n    int := jsonb_array_length(p_scores);
  a    int;
  b    int;
  won  int[] := array[0, 0];
begin
  if n > 3 then return 'a retirement has at most 3 sets'; end if;
  for i in 0 .. n - 1 loop
    a := (p_scores->i->>'p1_games')::int;
    b := (p_scores->i->>'p2_games')::int;
    if public.is_complete_set(a, b) then
      won[case when a > b then 1 else 2 end] := won[case when a > b then 1 else 2 end] + 1;
    elsif i < n - 1 then
      return 'only the last set of a retirement can be unfinished';
    elsif a > 6 or b > 6 then
      return 'the unfinished set is not a possible score';
    end if;
  end loop;
  if won[3 - p_winner] >= 2 then return 'the retiring player had already won the match'; end if;
  if won[p_winner] >= 2 then return 'the winner had already won the match: not a retirement'; end if;
  return null;
end;
$$;
revoke all on function public.validate_retirement(int, jsonb) from public, anon, authenticated;

create or replace function public.ingest_result(p_provider text, p_normalised jsonb, p_raw jsonb,
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
  v_canon   jsonb;
  v_stable  int;
  v_break_id bigint;
  v_start   timestamptz;
  v_gap     timestamptz;
  v_last    timestamptz;
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

    -- F-03 / F-06: the provider shows the match under way (or decided) before our scheduled start.
    -- Picks are still open, so tell the operator now (once an hour per match); lock_match_now closes them.
    if v_status in ('live', 'completed', 'retired', 'walkover') and m.status = 'scheduled'
       and m.starts_at is not null and public.app_now() < m.starts_at
       and not exists (select 1 from public.ops_alerts a
                        where a.kind = 'started_before_schedule' and (a.detail->>'match_no')::int = v_match
                          and a.at > clock_timestamp() - interval '1 hour') then
      insert into public.ops_alerts (kind, detail) values ('started_before_schedule',
        jsonb_build_object('match_no', v_match, 'provider', p_provider, 'provider_status', v_status,
                           'scheduled_start', m.starts_at,
                           'action', 'picks are still open: run lock_match_now(' || v_match || ') if it has started'));
    end if;

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
      -- F-07: a walkover has no sets; a retirement is a possible unfinished match.
      if v_reason is null and v_status = 'walkover' and jsonb_array_length(v_scores) > 0 then
        v_reason := 'a walkover carries no set scores';
      end if;
      if v_reason is null and v_status = 'retired' then
        v_reason := public.validate_retirement(case when v_w = m.p1_id then 1 else 2 end, v_scores);
      end if;

      -- A final result before our scheduled start means the schedule or the payload is wrong. Settling
      -- would publish a result while picks are still open, so refuse (and alert, above). If the match
      -- really started early, the operator runs lock_match_now; the next poll settles.
      if v_reason is null and (m.starts_at is null or public.app_now() < m.starts_at) then
        v_reason := 'final result before the scheduled start';
      end if;

      if v_reason is null then
        v_canon := jsonb_build_object('status', v_status, 'winner', v_w, 'set_scores', v_scores);
        v_stable := coalesce((select (results_policy->'stable_minutes'->>p_provider)::int
                                from public.event_config), 0);
        if v_stable > 0 then
          -- the current run of identical readings started after the last different reading (log order)
          select max(id) into v_break_id from public.result_log
           where match_no = v_match and provider = p_provider and canonical is distinct from v_canon;
          select min(seen_at), max(seen_at) into v_start, v_last from public.result_log
           where match_no = v_match and provider = p_provider and canonical = v_canon
             and id > coalesce(v_break_id, 0);
          -- F-09: the run must be watched without a gap; a gap of more than 3 minutes (a missed poll, the
          -- slow watch) restarts the clock at the first reading after it.
          select max(seen_at) into v_gap from (
            select seen_at, seen_at - lag(seen_at) over (order by id) as gap
              from public.result_log
             where match_no = v_match and provider = p_provider and id > coalesce(v_break_id, 0)) x
           where gap > interval '3 minutes';
          if v_gap is not null and v_gap > v_start then v_start := v_gap; end if;
          if v_last is not null and public.app_now() - v_last > interval '3 minutes' then
            v_start := null;   -- this reading itself comes after a gap: the clock starts now
          end if;
        end if;
      end if;

      if v_reason is not null then
        v_outcome := 'rejected_invalid';
      elsif m.settlement_paused then
        v_outcome := 'paused';
      elsif m.status <> 'scheduled'
            and (m.status, m.winner_id, m.set_scores) is not distinct from (v_status, v_w, v_scores) then
        v_outcome := 'unchanged';
      elsif v_stable > 0
            and (v_start is null or v_start > public.app_now() - make_interval(mins => v_stable)) then
        v_outcome := 'awaiting_stability';
        -- F-09: keep reading this match on every run until it is confirmed or gone.
        update public.matches set refetch_requested_at = clock_timestamp() where match_no = v_match;
        -- A settled result now reads differently: say so at once, settle only if it holds.
        if v_start is null and m.status <> 'scheduled' then
          insert into public.ops_alerts (kind, detail) values ('result_change_pending',
            jsonb_build_object('match_no', v_match, 'provider', p_provider, 'stable_minutes', v_stable,
                               'settled', jsonb_build_object('status', m.status, 'winner', m.winner_id, 'set_scores', m.set_scores),
                               'now_reads', v_canon));
        end if;
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

  insert into public.result_log (match_no, provider, http_status, raw, raw_sha256, normalised, outcome, diff, note, canonical)
  values (v_match, p_provider, p_http_status, p_raw, v_hash, p_normalised, v_outcome, v_diff, v_reason, v_canon);

  -- The same rejection alerts once an hour, not on every poll (a half-finished edit can sit for a while).
  if v_outcome in ('rejected_unmapped', 'rejected_invalid') and not exists (
       select 1 from public.ops_alerts a
        where a.kind = 'result_rejected' and a.detail->>'match_ref' = v_ref
          and a.detail->>'reason' = v_reason and a.at > clock_timestamp() - interval '1 hour') then
    insert into public.ops_alerts (kind, detail) values ('result_rejected',
      jsonb_build_object('match_no', v_match, 'provider', p_provider, 'match_ref', v_ref, 'reason', v_reason));
  elsif v_outcome = 'resettled' then
    insert into public.ops_alerts (kind, detail) values ('result_changed',
      jsonb_build_object('match_no', v_match, 'provider', p_provider) || v_diff);
  end if;

  -- F-05: no health write here. The poller writes one heartbeat per run, from every match it visited.
  return jsonb_build_object('outcome', v_outcome, 'match_no', v_match, 'reason', v_reason);
end;
$$;

-- F-03 / F-06 ------------------------------------------------------------------------------------------
-- Close the picks for a match now: its start becomes this moment. For a match that really started early,
-- or a walkover announced before the start. Takes no score.
create function public.lock_match_now(p_match int) returns void
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
  update public.matches set starts_at = public.app_now() where match_no = p_match;
end;
$$;

-- F-08 -------------------------------------------------------------------------------------------------
-- A match paused because a corrected earlier result changed its players after it started: take its
-- players from the corrected bracket, store their potential points, resume settlement. The provider's
-- result then settles it as usual. Picks are untouched (one naming a player who is no longer in the
-- match simply scores nothing). Takes no score.
create function public.reseat_paused_match(p_match int) returns jsonb
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

do $$
declare f text;
begin
  foreach f in array array['lock_match_now(int)', 'reseat_paused_match(int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
