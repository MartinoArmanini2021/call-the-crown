import { describe, expect, test } from "bun:test";
import type { Match, SlotSource } from "../src/lib/api";
import { slotCandidates } from "../src/components/matchNames";

// Invented players (AGENTS.md): A and B have byes; QF1 C v F, QF2 D v E.
const P = (id: string): SlotSource => ({ type: "player", id });
const W = (match: number): SlotSource => ({ type: "winner", match });
const L = (match: number): SlotSource => ({ type: "loser", match });
const m = (match_no: number, round: Match["round"], p1: SlotSource, p2: SlotSource) =>
  ({
    match_no,
    round,
    p1_source: p1,
    p2_source: p2,
    p1_id: p1.type === "player" ? p1.id : null,
    p2_id: p2.type === "player" ? p2.id : null,
    status: "scheduled",
    winner_id: null,
  }) as unknown as Match;
const draw = () => [
  m(1, "QF", P("c"), P("f")),
  m(2, "QF", P("d"), P("e")),
  m(3, "SF", P("a"), W(1)),
  m(4, "SF", P("b"), W(2)),
  m(5, "3P", L(3), L(4)),
  m(6, "F", W(3), W(4)),
];

describe("who a slot can still be", () => {
  test("a known player is just that player", () => {
    expect(slotCandidates(draw()[2]!, 1, draw())).toEqual(["a"]);
  });
  test("the winner of a quarter-final: either of its players", () => {
    expect(slotCandidates(draw()[2]!, 2, draw())).toEqual(["c", "f"]);
  });
  test("the final before the semis: anyone from that half", () => {
    const d = draw();
    expect(slotCandidates(d[5]!, 1, d)).toEqual(["a", "c", "f"]);
    expect(slotCandidates(d[4]!, 2, d)).toEqual(["b", "d", "e"]);
  });
  test("a finished match passes on its winner (or loser) even before the next slot is filled", () => {
    const d = draw().map((x) =>
      x.match_no === 1 ? { ...x, status: "completed" as const, winner_id: "f" } : x,
    );
    expect(slotCandidates(d[2]!, 2, d)).toEqual(["f"]);
    expect(slotCandidates(d[5]!, 1, d)).toEqual(["a", "f"]);
  });
});
