// The client's copy of the set-score rules, for instant feedback while a fan fills in a pick.
// The server (public.validate_set_scores, supabase/migrations/0004_validation.sql) is the authority;
// both are run against tests/vectors/set-scores.json so they cannot drift apart.
// The rules come from event_config.rules; nothing here is specific to one event.

export type SetScore = { p1_games: number; p2_games: number };
export type ScoreRules = { allowed_set_scores: [number, number][]; deciding_set: string };

export type ScoreError =
  | "deciding_set_mode_not_supported"
  | "winner_required"
  | "sets_must_be_2_or_3"
  | "set_scores_required"
  | "set_scores_incomplete"
  | "illegal_set_score"
  | "third_set_after_two_nil"
  | "winner_must_win_two_sets";

const isNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// winnerSlot: 1 or 2, which of the match's two players the fan says wins.
export function validateSetScores(
  rules: ScoreRules,
  winnerSlot: number | null | undefined,
  sets: number | null | undefined,
  scores: (Partial<SetScore> | null)[] | null | undefined,
): ScoreError | null {
  if (rules.deciding_set !== "full") return "deciding_set_mode_not_supported";
  if (winnerSlot !== 1 && winnerSlot !== 2) return "winner_required";
  if (sets !== 2 && sets !== 3) return "sets_must_be_2_or_3";
  if (!Array.isArray(scores)) return "set_scores_required";
  if (scores.length !== sets) return "set_scores_incomplete";

  const slots: number[] = [];
  let wins = 0;
  for (const set of scores) {
    if (!set || !isNumber(set.p1_games) || !isNumber(set.p2_games)) return "set_scores_incomplete";
    const hi = Math.max(set.p1_games, set.p2_games);
    const lo = Math.min(set.p1_games, set.p2_games);
    if (!rules.allowed_set_scores.some(([a, b]) => a === hi && b === lo)) return "illegal_set_score";
    const slot = set.p1_games > set.p2_games ? 1 : 2;
    slots.push(slot);
    if (slot === winnerSlot) wins++;
  }

  if (sets === 2 && wins !== 2) return "winner_must_win_two_sets";
  if (sets === 3) {
    if (slots[0] === slots[1]) return "third_set_after_two_nil";
    if (slots[2] !== winnerSlot) return "winner_must_win_two_sets";
  }
  return null;
}

// The games a set score can take from the winner's point of view, e.g. "6-4", in the config's order.
export const setScoreOptions = (rules: ScoreRules): [number, number][] => rules.allowed_set_scores;
