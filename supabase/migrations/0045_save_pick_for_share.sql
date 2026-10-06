-- =====================================================================================================
-- 0045 - save_pick reads the match row FOR SHARE (audit 5-6 Oct 2026, finding N2/N3; applied on Tino's
-- word, 6 Oct 2026).
-- lock_match_now, set_match_start and a corrected result (advance_bracket) lock the match row FOR UPDATE
-- and change it. save_pick read the row with a plain SELECT, so while the operator's transaction was open
-- a fan's save judged the pick on the OLD row:
--   * after lock_match_now or set_match_start moved the start earlier, a new or changed pick was accepted
--     and stamped after the NEW start (and nothing voids it later: 0018 voids by the real start);
--   * while a corrected quarter-final refilled a semi-final, a pick on the player being removed was
--     accepted after the cleanup had deleted the others, and survived.
-- FOR SHARE waits for the operator's commit and then re-reads the committed row (READ COMMITTED), so the
-- lock check and the players are the new ones. Fans' share locks do not block each other; they only
-- queue behind a writer of that one match row. Lock order is unchanged (the match row before picks, as
-- in settle_match and advance_bracket), so no new deadlock. Races: scripts/race-local.ts.
-- Only change against 0005: "for share" on the first select. Grants as in 0005.
-- =====================================================================================================
create or replace function public.save_pick(p_match int, p_winner text, p_sets int, p_set_scores jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := public.app_now();
  m       public.matches%rowtype;
  v_slot  int;
  v_err   text;
  v_canon jsonb;
  v_rows  int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select * into m from public.matches where match_no = p_match for share;
  if not found then raise exception 'no_such_match'; end if;
  if m.p1_id is null or m.p2_id is null then raise exception 'players_unknown'; end if;
  if m.starts_at is null then raise exception 'no_start_time'; end if;
  if v_now >= m.starts_at then raise exception 'locked'; end if;
  if m.status <> 'scheduled' then raise exception 'already_settled'; end if;

  v_slot := case when p_winner = m.p1_id then 1 when p_winner = m.p2_id then 2 end;
  if v_slot is null then raise exception 'winner_not_in_match'; end if;

  v_err := public.validate_set_scores(v_slot, p_sets, p_set_scores);
  if v_err is not null then raise exception '%', v_err; end if;
  v_canon := public.canonical_set_scores(p_set_scores);

  insert into public.picks as p (user_id, match_no, winner_id, sets, set_scores, created_at, updated_at)
  values (v_uid, p_match, p_winner, p_sets, v_canon, v_now, v_now)
  on conflict (user_id, match_no) do update
     set winner_id = excluded.winner_id, sets = excluded.sets, set_scores = excluded.set_scores,
         updated_at = excluded.updated_at
   where (p.winner_id, p.sets, p.set_scores) is distinct from
         (excluded.winner_id, excluded.sets, excluded.set_scores);
  get diagnostics v_rows = row_count;

  -- The billing record. Only a new pick or a real change counts; the day is the server's Riyadh day.
  if v_rows > 0 then
    insert into public.activity_days (user_id, day)
    values (v_uid, (v_now at time zone (select timezone from public.event_config))::date)
    on conflict do nothing;
  end if;

  return jsonb_build_object('changed', v_rows > 0);
end;
$$;
revoke all on function public.save_pick(int, text, int, jsonb) from public, anon;
grant execute on function public.save_pick(int, text, int, jsonb) to authenticated;
