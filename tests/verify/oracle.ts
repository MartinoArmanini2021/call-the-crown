// =====================================================================================================
// INDEPENDENT ORACLE for Call the Crown's scoring (audit section M, brief "Part 2 M" and "Part 1 D").
//
// Written from the rules ONLY:
//   · How to play (EN src/i18n/strings.ts, keys htp_*; AR src/i18n/ar.ts) — quoted below as [HTP …];
//   · event_config.rules in supabase/events/sixkings_2026.sql (read as DATA by loadEventRules());
//   · the full-debug brief, docs/briefs/full-debug/brief.md — quoted as [BRIEF …];
//   · Tino's recorded tiebreak decisions in README.md "Decisions taken in Phase 1" — quoted as [README …].
// It imports NO app code and calls NO SQL function: not src/lib/validation.ts, not the migrations, not
// scripts/lib. Its only imports are node built-ins (fs, path, crypto). Every function below says which
// rule sentence it implements. Where the rules are silent the choice is marked "RULES SILENT".
// =====================================================================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Round = "QF" | "SF" | "3P" | "F";
export type Slot = 1 | 2;
export type Status = "completed" | "retired" | "walkover";
/** A set in the match's fixed order: [player 1's games, player 2's games]. */
export type Set = [number, number];

export type Rules = {
  winner_points: Record<Round, number>;
  sets_points: Record<Round, number>;
  per_set_exact: number;
  upset_constant: number;
  allowed_set_scores: [number, number][];
  deciding_set: string;
};

/** Reads event_config.rules out of the event file as data (a JSON literal inside the SQL). */
export function loadEventRules(root = join(import.meta.dir, "..", "..")): Rules {
  const sql = readFileSync(join(root, "supabase", "events", "sixkings_2026.sql"), "utf8");
  const m = sql.match(/'(\{\s*"winner_points"[\s\S]*?\})'\s*,\s*\n/);
  if (!m) throw new Error("rules literal not found in the event file");
  return JSON.parse(m[1]!) as Rules;
}

// -----------------------------------------------------------------------------------------------------
// 1. A legal set.
// [HTP htp_enter_2] "For each set, tap who wins it, then the score (6-0, 6-1, 6-2, 6-3, 6-4, 7-5, 7-6)."
//   ({scores} is rendered from rules.allowed_set_scores, winner's games first.)
// [HTP htp_7_6] "A 7-6 set counts as 7-6, whatever the tiebreak score."
// So a set is legal iff its games are whole numbers ≥ 0 and {winner's games, loser's games} is one of
// allowed_set_scores. The set's winner is the player with more games.
// -----------------------------------------------------------------------------------------------------
export const isWholeGames = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

export function isLegalSet(rules: Rules, s: readonly unknown[]): boolean {
  const [a, b] = s;
  if (!isWholeGames(a) || !isWholeGames(b) || a === b) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return rules.allowed_set_scores.some(([w, l]) => w === hi && l === lo);
}
export const setWinner = (s: Set): Slot => (s[0] > s[1] ? 1 : 2);

// -----------------------------------------------------------------------------------------------------
// 2. A legal pick (and a legal completed result: the same shape of match).
// [HTP htp_enter_1] "Pick who wins the match."
// [HTP htp_enter_2] "… If the other player takes set 1 or 2, a third set appears: the winner of the
//   match takes it."  ⇒ 2 sets: the match winner takes both. 3 sets: sets 1 and 2 are split, the match
//   winner takes set 3. A third set never follows 2-0.
// [HTP htp_sets_row] "Right number of sets (2 or 3)".
// event_config.rules.deciding_set = "full": the third set is an ordinary set with the same score list.
//   Any other mode is not defined by the rules text, so the oracle refuses it ("unsupported").
// -----------------------------------------------------------------------------------------------------
export type Validity = { ok: true } | { ok: false; why: string };
const bad = (why: string): Validity => ({ ok: false, why });

export function pickValidity(
  rules: Rules,
  winner: unknown,
  sets: unknown,
  scores: unknown,
): Validity {
  if (rules.deciding_set !== "full") return bad("unsupported deciding set");
  if (winner !== 1 && winner !== 2) return bad("no winner");
  if (sets !== 2 && sets !== 3) return bad("sets not 2 or 3");
  if (!Array.isArray(scores) || scores.length !== sets) return bad("wrong number of set scores");
  const parsed: Set[] = [];
  for (const s of scores) {
    if (!Array.isArray(s) || s.length !== 2 || !isLegalSet(rules, s)) return bad("illegal set");
    parsed.push([s[0] as number, s[1] as number]);
  }
  const w = parsed.map(setWinner);
  if (sets === 2) return w[0] === winner && w[1] === winner ? { ok: true } : bad("winner not 2-0");
  if (w[0] === w[1]) return bad("third set after 2-0");
  return w[2] === winner ? { ok: true } : bad("third set not won by the winner");
}

// -----------------------------------------------------------------------------------------------------
// 3. A provider's final result.
//   completed: a legal match exactly as in 2 ([HTP htp_enter_2], same shape for results and picks).
//   walkover ("doesn't start", [HTP htp_void]): no set was played. RULES SILENT on the payload; the oracle
//     takes "doesn't start" literally: zero sets.
//   retired ([HTP htp_void] "If a player retires …"): RULES SILENT on which scores are possible. The oracle
//     uses tennis itself: every set but the last is a legal complete set, the last may be unfinished
//     (a score reachable during a set: both ≤ 6 and not already a complete set), at most 3 sets, and
//     neither player had already won two sets (the match would be over).
// -----------------------------------------------------------------------------------------------------
export function resultValidity(
  rules: Rules,
  status: Status,
  winner: Slot,
  scores: Set[],
): Validity {
  if (scores.some((s) => !isWholeGames(s[0]) || !isWholeGames(s[1]))) return bad("not whole games");
  if (status === "completed") return pickValidity(rules, winner, scores.length, scores);
  if (status === "walkover") return scores.length === 0 ? { ok: true } : bad("walkover with sets");
  if (scores.length > 3) return bad("retirement with more than 3 sets");
  const won = [0, 0, 0];
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i]!;
    if (isLegalSet(rules, s)) won[setWinner(s)]!++;
    else if (i < scores.length - 1) return bad("unfinished set before the last");
    else if (Math.max(s[0], s[1]) > 6) return bad("impossible unfinished set");
  }
  if (won[1]! >= 2 || won[2]! >= 2) return bad("match already won before the retirement");
  return { ok: true };
}

// -----------------------------------------------------------------------------------------------------
// 4. Winner points and the upset bonus.
// [HTP htp_upset] "Back the lower-ranked player and win more. The bigger the gap in the world ranking,
//   the bigger the bonus."
// [HTP htp_upset_maths] "Winner points × (1 + gap ÷ (gap + {k})), where gap is the difference in ranking
//   places, rounded to a whole point (halves round up). Rankings are fixed before the first match."
// [BRIEF Q1] winner points QF 8, SF 13, 3rd place 8, F 20; upset constant 30.
// Lower-ranked = the bigger ranking number. No bonus for the favourite or for equal ranks (gap 0 gives
// ×1 anyway). Exact rational arithmetic: value = base·(2g+k)/(g+k) = q + r/(g+k); halves round UP, so
// the result is q + 1 exactly when 2r ≥ (g+k).
// -----------------------------------------------------------------------------------------------------
export function exactUpsetValue(
  base: number,
  gap: number,
  k: number,
): { num: bigint; den: bigint } {
  return { num: BigInt(base) * BigInt(2 * gap + k), den: BigInt(gap + k) };
}
export function winPoints(rules: Rules, round: Round, rank: number, oppRank: number): number {
  const base = rules.winner_points[round];
  const gap = rank - oppRank; // positive when the picked player is ranked lower
  if (gap <= 0) return base;
  const { num, den } = exactUpsetValue(base, gap, rules.upset_constant);
  const q = num / den;
  const r = num - q * den;
  return Number(2n * r >= den ? q + 1n : q);
}

// -----------------------------------------------------------------------------------------------------
// 5. What one pick earns.
// [HTP htp_scoring_intro] "Nothing counts unless your winner is right: the wrong winner scores 0 for that
//   match."
// [HTP rows] "Right winner" → winner points (with upset bonus); "Right number of sets (2 or 3)" → the
//   round's sets points; "Each set exactly right (same player, same score)" → per_set_exact each.
// [HTP htp_two_on_three] "If you said 2 sets and the match goes to 3, sets 1 and 2 can still be exactly
//   right."  ⇒ set N of the pick is compared with set N of the result.
// [HTP htp_void] "If a player retires or doesn't start, only the winner counts: no points for sets or set
//   scores, for anyone."
// [HTP htp_lock] "… a pick saved after it really started does not count." ⇒ such a pick scores 0.
// Exact sets are counted (for tiebreaker 1) only where they score.
// -----------------------------------------------------------------------------------------------------
export type Pick = { winner: Slot; sets: Set[] };
export type Result = { status: Status; winner: Slot; sets: Set[] };
export type Score = {
  winner: number;
  sets: number;
  exact: number;
  exactSets: number;
  total: number;
  flags: (boolean | null)[] | null;
};
export function scorePick(
  rules: Rules,
  round: Round,
  ranks: [number, number], // [player 1's rank, player 2's rank], fixed before the first match
  result: Result,
  pick: Pick,
  voidPick = false,
): Score {
  if (voidPick || pick.winner !== result.winner)
    return { winner: 0, sets: 0, exact: 0, exactSets: 0, total: 0, flags: null };
  const me = pick.winner === 1 ? ranks[0] : ranks[1];
  const opp = pick.winner === 1 ? ranks[1] : ranks[0];
  const w = winPoints(rules, round, me, opp);
  if (result.status !== "completed")
    return { winner: w, sets: 0, exact: 0, exactSets: 0, total: w, flags: null };
  const s = pick.sets.length === result.sets.length ? rules.sets_points[round] : 0;
  const flags: (boolean | null)[] = [0, 1, 2].map((i) => {
    const a = pick.sets[i];
    const b = result.sets[i];
    return a && b ? a[0] === b[0] && a[1] === b[1] : null;
  });
  const n = flags.filter((f) => f === true).length;
  const e = n * rules.per_set_exact;
  return { winner: w, sets: s, exact: e, exactSets: n, total: w + s + e, flags };
}

// -----------------------------------------------------------------------------------------------------
// 6. The bracket (the draw file's header, supabase/events/sixkings_2026_draw.sql, Tino 2 Oct 2026):
//   "QF1 Fritz v Zverev → SF1 against Alcaraz (bye, seed 1); QF2 de Minaur v Sinner → SF2 against
//    Djokovic (bye, seed 2); Third place: the two semi-final losers. Final: the two semi-final winners."
//   [BRIEF M5] "quarter-final winners into the semi-final p2 slots; semi-final losers into the 3rd-place
//    match; semi-final winners into the final."  RULES SILENT on which SF feeds 3P/F slot 1: the oracle
//    puts SF1's player in slot 1 and SF2's in slot 2.
// -----------------------------------------------------------------------------------------------------
export type Bracket = Record<number, { round: Round; p1: string | null; p2: string | null }>;
export function fillBracket(
  byes: { sf1: string; sf2: string },
  qf: { qf1: [string, string]; qf2: [string, string] },
  winners: Partial<Record<number, string>>,
): Bracket {
  const other = (pair: [string | null, string | null], w: string | undefined) =>
    w === undefined ? null : pair[0] === w ? pair[1] : pair[0];
  const b: Bracket = {
    1: { round: "QF", p1: qf.qf1[0], p2: qf.qf1[1] },
    2: { round: "QF", p1: qf.qf2[0], p2: qf.qf2[1] },
    3: { round: "SF", p1: byes.sf1, p2: winners[1] ?? null },
    4: { round: "SF", p1: byes.sf2, p2: winners[2] ?? null },
    5: { round: "3P", p1: null, p2: null },
    6: { round: "F", p1: winners[3] ?? null, p2: winners[4] ?? null },
  };
  b[5]!.p1 = other([b[3]!.p1, b[3]!.p2], winners[3]);
  b[5]!.p2 = other([b[4]!.p1, b[4]!.p2], winners[4]);
  return b;
}

// -----------------------------------------------------------------------------------------------------
// 7. Standings and the tiebreak chain.
// Points first (the game). Then [HTP htp_ties] "If fans have the same points":
//   1 [htp_ties_1] "More sets exactly right over the whole event."
//   2 [htp_ties_2] "In the final: your total games closest to the real total."
//   3 [htp_ties_3] "Whoever made their final pick earlier (their last change counts)."
//   4 [htp_ties_4] "A computer draw, fixed before the first match. Its code: <tiebreak_seed>"
// [README] "With no call on the final, the fan ranks after everyone who has one. If the final ended by
//   retirement or walkover, the step is skipped for everyone."  (applied to steps 2 and 3)
// [README] "The last resort is a computer draw. Each fan's draw number is md5(tiebreak_seed || ':' ||
//   user_id)."  RULES SILENT on whether the lower or the higher draw number wins: the oracle takes the
//   lower (ascending), and the test reports this as an ambiguity.
// A pick that "does not count" ([HTP htp_lock]) is treated as no call on the final.
// -----------------------------------------------------------------------------------------------------
export type Fan = {
  id: string;
  points: number;
  exactSets: number;
  finalGames: number | null; // games in the fan's counting pick on the final; null = no call
  finalPickAt: number | null; // ms of the last change to that pick; null = no pick
};
export const drawNumber = (seed: string, id: string) =>
  createHash("md5").update(`${seed}:${id}`, "utf8").digest("hex");

export type Level = "points" | "exact" | "gap" | "time" | "draw";
export function compareFans(
  a: Fan,
  b: Fan,
  finalTotal: number | null,
  seed: string,
): { c: number; level: Level } {
  if (a.points !== b.points) return { c: b.points - a.points, level: "points" };
  if (a.exactSets !== b.exactSets) return { c: b.exactSets - a.exactSets, level: "exact" };
  const gap = (f: Fan) =>
    finalTotal === null || f.finalGames === null ? null : Math.abs(f.finalGames - finalTotal);
  const ga = gap(a);
  const gb = gap(b);
  if (ga !== gb) {
    if (ga === null) return { c: 1, level: "gap" };
    if (gb === null) return { c: -1, level: "gap" };
    return { c: ga - gb, level: "gap" };
  }
  if (a.finalPickAt !== b.finalPickAt) {
    if (a.finalPickAt === null) return { c: 1, level: "time" };
    if (b.finalPickAt === null) return { c: -1, level: "time" };
    return { c: a.finalPickAt - b.finalPickAt, level: "time" };
  }
  const da = drawNumber(seed, a.id);
  const db = drawNumber(seed, b.id);
  if (da !== db) return { c: da < db ? -1 : 1, level: "draw" };
  return { c: a.id < b.id ? -1 : 1, level: "draw" };
}
export function rankFans(fans: Fan[], finalTotal: number | null, seed: string): Fan[] {
  return [...fans].sort((a, b) => compareFans(a, b, finalTotal, seed).c);
}

export const gamesIn = (sets: Set[]) => sets.reduce((n, [a, b]) => n + a + b, 0);
