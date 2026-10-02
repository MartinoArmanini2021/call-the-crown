// A pick while it is being made in the pick sheet, asked the way a fan thinks (first-time-fan test,
// 2 Oct 2026): who wins; 2–0 or 2–1; for 2–1, which set the other player takes; then each set's score
// from the set winner's side ("6-4"). It converts to the stored form, set scores in the match's fixed
// order (player 1's games first), which is also how the sheet's scoreboard shows it.
import type { Match, Pick } from "./api";
import type { SetScore } from "./validation";

export type Side = 1 | 2;
export type Format = "2-0" | "2-1";
export type Draft = {
  winner: Side | null;
  format: Format | null;
  /** for 2–1: the set (0 = set 1, 1 = set 2) the match loser takes */
  lost: 0 | 1 | null;
  /** per set: [set winner's games, set loser's games] */
  scores: ([number, number] | null)[];
};

export const other = (s: Side): Side => (s === 1 ? 2 : 1);
export const EMPTY: Draft = { winner: null, format: null, lost: null, scores: [null, null, null] };

export const setCount = (d: Draft) => (d.format === "2-1" ? 3 : 2);

/** Every question answered, so the set rows can show. */
export const shaped = (d: Draft) =>
  d.winner !== null && (d.format === "2-0" || (d.format === "2-1" && d.lost !== null));

/** Who wins set i. */
export function setWinner(d: Draft, i: number): Side {
  return d.format === "2-1" && i === d.lost ? other(d.winner!) : d.winner!;
}

/** Set scores in fixed order (player 1 first); null for a set not yet scored. */
export function toSetScores(d: Draft): (SetScore | null)[] {
  if (!shaped(d)) return [];
  return Array.from({ length: setCount(d) }, (_, i) => {
    const sc = d.scores[i];
    if (!sc) return null;
    return setWinner(d, i) === 1
      ? { p1_games: sc[0], p2_games: sc[1] }
      : { p1_games: sc[1], p2_games: sc[0] };
  });
}

/** The score the way a fan says it, the match winner's games first: "6-4, 3-6, 6-3". */
export function winnerLine(d: Draft): string {
  return d.scores
    .slice(0, setCount(d))
    .map((sc, i) =>
      sc ? (setWinner(d, i) === d.winner ? `${sc[0]}-${sc[1]}` : `${sc[1]}-${sc[0]}`) : "",
    )
    .join(", ");
}

export function fromPick(m: Match, pick: Pick | undefined): Draft {
  if (!pick) return EMPTY;
  const winner: Side = pick.winner_id === m.p1_id ? 1 : 2;
  const wonBy = (s: SetScore): Side => (s.p1_games > s.p2_games ? 1 : 2);
  const lostIdx = pick.set_scores.slice(0, 2).findIndex((s) => wonBy(s) !== winner);
  const scores = [0, 1, 2].map((i) => {
    const s = pick.set_scores[i];
    return s
      ? ([Math.max(s.p1_games, s.p2_games), Math.min(s.p1_games, s.p2_games)] as [number, number])
      : null;
  });
  return {
    winner,
    format: pick.sets === 3 ? "2-1" : "2-0",
    lost: pick.sets === 3 && lostIdx >= 0 ? (lostIdx as 0 | 1) : null,
    scores,
  };
}

/** Changing the winner keeps the shape (2–0, or 2–1 with the same set lost) and the set scores. */
export const withWinner = (d: Draft, w: Side): Draft => ({ ...d, winner: w });
export const withFormat = (d: Draft, f: Format): Draft => ({
  ...d,
  format: f,
  lost: f === "2-0" ? null : d.lost,
});
export const withLost = (d: Draft, i: 0 | 1): Draft => ({ ...d, lost: i });
export function withScore(d: Draft, i: number, sc: [number, number]): Draft {
  const scores = [...d.scores];
  scores[i] = sc;
  return { ...d, scores };
}
