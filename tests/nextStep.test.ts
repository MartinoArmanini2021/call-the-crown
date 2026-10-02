import { describe, expect, test } from "bun:test";
import type { Match, SlotSource } from "../src/lib/api";
import { nextStep } from "../src/lib/nextStep";

const P = (id: string): SlotSource => ({ type: "player", id });
const W = (match: number): SlotSource => ({ type: "winner", match });
const L = (match: number): SlotSource => ({ type: "loser", match });
const H = 3_600_000;
const NOW = Date.parse("2026-10-21T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * H).toISOString();

function draw(): Match[] {
  const m = (
    match_no: number,
    round: Match["round"],
    p1: SlotSource,
    p2: SlotSource,
    start: number,
  ) =>
    ({
      match_no,
      round,
      p1_source: p1,
      p2_source: p2,
      p1_id: p1.type === "player" ? p1.id : null,
      p2_id: p2.type === "player" ? p2.id : null,
      starts_at: at(start),
      status: "scheduled",
      winner_id: null,
      set_scores: null,
      p1_win_points: 8,
      p2_win_points: 8,
    }) as unknown as Match;
  return [
    m(1, "QF", P("c"), P("f"), 4),
    m(2, "QF", P("d"), P("e"), 5),
    m(3, "SF", P("a"), W(1), 28),
    m(4, "SF", P("b"), W(2), 30),
    m(5, "3P", L(3), L(4), 76),
    m(6, "F", W(3), W(4), 78),
  ];
}

describe("next step", () => {
  test("the open match that locks first and has no pick", () => {
    const s = nextStep(draw(), new Set([1]), NOW);
    expect(s.kind).toBe("pick");
    if (s.kind === "pick") {
      expect(s.match.match_no).toBe(2);
      expect(s.msLeft).toBe(5 * H);
    }
  });

  test("all open matches picked: time to the next lock", () => {
    expect(nextStep(draw(), new Set([1, 2]), NOW)).toEqual({ kind: "all_set", msLeft: 4 * H });
  });

  test("both quarter-finals in play: semi-final 1 opens after quarter-final 1", () => {
    const s = nextStep(draw(), new Set([1, 2]), NOW + 6 * H);
    expect(s.kind).toBe("waiting");
    if (s.kind === "waiting") expect([s.match.match_no, s.after.match_no]).toEqual([3, 1]);
  });

  test("final day waits for the later semi-final", () => {
    const ms = draw().map((m) =>
      m.round === "QF"
        ? { ...m, status: "completed" as const }
        : m.match_no === 3
          ? { ...m, status: "completed" as const }
          : m,
    );
    const s = nextStep(ms, new Set(), NOW + 31 * H);
    expect(s.kind).toBe("waiting");
    if (s.kind === "waiting") expect([s.match.match_no, s.after.match_no]).toEqual([5, 4]);
  });

  test("every match finished", () => {
    const ms = draw().map((m) => ({ ...m, status: "completed" as const }));
    expect(nextStep(ms, new Set(), NOW)).toEqual({ kind: "over" });
  });
});
