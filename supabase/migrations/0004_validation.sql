-- =====================================================================================================
-- 0004 — the rule helpers shared by save_pick (a fan's prediction) and ingest_result (the provider's
-- result): what a legal set score is, and what a correct winner is worth.
-- The TypeScript mirror is src/lib/validation.ts; both are tested against tests/vectors/set-scores.json.
-- =====================================================================================================

-- Returns null when the score is legal, otherwise a short error code.
--   p_winner_slot  1 or 2: which of the match's two players is said to win
--   p_sets         2 or 3
--   p_scores       ordered [{p1_games, p2_games}], player 1's games first
create function public.validate_set_scores(p_winner_slot int, p_sets int, p_scores jsonb)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  v_rules   jsonb;
  v_set     jsonb;
  v_g1      numeric;
  v_g2      numeric;
  v_slot    int;
  v_slots   int[] := '{}';
  v_wins    int := 0;
begin
  select rules into v_rules from public.event_config;
  if v_rules is null then return 'no_event_config'; end if;
  -- Only the full deciding set is implemented. A 10-point match tiebreak changes the third-set input
  -- and its credit; that rule is an open question, so the switch is refused rather than guessed.
  if v_rules->>'deciding_set' is distinct from 'full' then return 'deciding_set_mode_not_supported'; end if;

  if p_winner_slot is null or p_winner_slot not in (1, 2) then return 'winner_required'; end if;
  if p_sets is null or p_sets not in (2, 3) then return 'sets_must_be_2_or_3'; end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'array' then return 'set_scores_required'; end if;
  if jsonb_array_length(p_scores) <> p_sets then return 'set_scores_incomplete'; end if;

  for v_set in select e from jsonb_array_elements(p_scores) with ordinality as t(e, ord) order by ord loop
    if jsonb_typeof(v_set) <> 'object'
       or jsonb_typeof(v_set->'p1_games') is distinct from 'number'
       or jsonb_typeof(v_set->'p2_games') is distinct from 'number' then
      return 'set_scores_incomplete';
    end if;
    v_g1 := (v_set->>'p1_games')::numeric;
    v_g2 := (v_set->>'p2_games')::numeric;
    if not exists (
      select 1 from jsonb_array_elements(v_rules->'allowed_set_scores') a
       where (a->>0)::numeric = greatest(v_g1, v_g2) and (a->>1)::numeric = least(v_g1, v_g2)
    ) then
      return 'illegal_set_score';
    end if;
    v_slot := case when v_g1 > v_g2 then 1 else 2 end;
    v_slots := v_slots || v_slot;
    if v_slot = p_winner_slot then v_wins := v_wins + 1; end if;
  end loop;

  if p_sets = 2 and v_wins <> 2 then return 'winner_must_win_two_sets'; end if;
  if p_sets = 3 then
    -- a third set exists only if the first two are split
    if v_slots[1] = v_slots[2] then return 'third_set_after_two_nil'; end if;
    if v_slots[3] <> p_winner_slot then return 'winner_must_win_two_sets'; end if;
  end if;
  return null;
end;
$$;

-- Rewrites a validated score array with exactly the two keys, as integers (6.0 → 6), so two equal
-- scores are always equal jsonb.
create function public.canonical_set_scores(p_scores jsonb) returns jsonb
language sql immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('p1_games', (e->>'p1_games')::numeric::int,
                                               'p2_games', (e->>'p2_games')::numeric::int) order by ord), '[]'::jsonb)
    from jsonb_array_elements(p_scores) with ordinality as t(e, ord)
$$;

-- Winner points for a correct pick on a player ranked p_rank against an opponent ranked p_opp_rank.
-- Upset bonus: only when the picked player is ranked lower (a bigger number); the round's points are
-- multiplied by 1 + gap / (gap + K) and rounded to a whole point, halves up. Done in whole-number
-- arithmetic so 8.5 is exactly 8.5 and never 8.4999: round(a / b) = floor((2a + b) / 2b).
create function public.win_points(p_round text, p_rank int, p_opp_rank int) returns int
language plpgsql stable
set search_path = public
as $$
declare
  v_rules jsonb;
  v_base  bigint;
  v_k     bigint;
  v_gap   bigint;
begin
  select rules into v_rules from public.event_config;
  v_base := (v_rules->'winner_points'->>p_round)::bigint;
  if p_rank is null or p_opp_rank is null or p_rank <= p_opp_rank then return v_base; end if;
  v_k   := (v_rules->>'upset_constant')::bigint;
  v_gap := p_rank - p_opp_rank;
  return ((2 * v_base * (2 * v_gap + v_k) + (v_gap + v_k)) / (2 * (v_gap + v_k)))::int;
end;
$$;

revoke all on function public.validate_set_scores(int, int, jsonb) from public, anon, authenticated;
revoke all on function public.canonical_set_scores(jsonb) from public, anon, authenticated;
revoke all on function public.win_points(text, int, int) from public, anon, authenticated;
