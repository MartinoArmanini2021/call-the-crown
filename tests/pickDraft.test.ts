import { describe, expect, test } from "bun:test";
import type { Match, Pick } from "../src/lib/api";
import {
  EMPTY,
  fromPick,
  shaped,
  toSetScores,
  winnerLine,
  withFormat,
  withLost,
  withScore,
  withWinner,
} from "../src/lib/pickDraft";

// Invented players (AGENTS.md): match 1 is C (player 1) v F (player 2).
const match = { match_no: 1, p1_id: "c", p2_id: "f" } as Match;

describe("the pick sheet's draft", () => {
  test("F wins 6-4 6-3: winner-side chips, stored player 1 first", () => {
    let d = withFormat(withWinner(EMPTY, 2), "2-0");
    d = withScore(withScore(d, 0, [6, 4]), 1, [6, 3]);
    expect(toSetScores(d)).toEqual([
      { p1_games: 4, p2_games: 6 },
      { p1_games: 3, p2_games: 6 },
    ]);
    expect(winnerLine(d)).toBe("6-4, 6-3");
  });

  test("F wins 2-1, C takes set 1: set 1 stored C first, set 3 goes to F", () => {
    let d = withLost(withFormat(withWinner(EMPTY, 2), "2-1"), 0);
    d = withScore(withScore(withScore(d, 0, [7, 5]), 1, [6, 2]), 2, [7, 6]);
    expect(toSetScores(d)).toEqual([
      { p1_games: 7, p2_games: 5 },
      { p1_games: 2, p2_games: 6 },
      { p1_games: 6, p2_games: 7 },
    ]);
    expect(winnerLine(d)).toBe("5-7, 6-2, 7-6");
  });

  test("2-1 needs the lost set before the set rows show", () => {
    expect(shaped(withFormat(withWinner(EMPTY, 1), "2-1"))).toBe(false);
    expect(shaped(withLost(withFormat(withWinner(EMPTY, 1), "2-1"), 1))).toBe(true);
  });

  test("a saved pick reopens as the same answers", () => {
    const pick = {
      winner_id: "f",
      sets: 3,
      set_scores: [
        { p1_games: 6, p2_games: 4 },
        { p1_games: 3, p2_games: 6 },
        { p1_games: 4, p2_games: 6 },
      ],
    } as Pick;
    const d = fromPick(match, pick);
    expect([d.winner, d.format, d.lost]).toEqual([2, "2-1", 0]);
    expect(toSetScores(d)).toEqual(pick.set_scores);
  });

  test("switching the winner keeps the shape and the set scores", () => {
    let d = withLost(withFormat(withWinner(EMPTY, 2), "2-1"), 1);
    d = withScore(d, 0, [6, 4]);
    const flipped = withWinner(d, 1);
    expect([flipped.format, flipped.lost]).toEqual(["2-1", 1]);
    expect(toSetScores(flipped)[0]).toEqual({ p1_games: 6, p2_games: 4 });
  });
});
