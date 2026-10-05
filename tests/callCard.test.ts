import { describe, expect, test } from "bun:test";
import { ar } from "../src/i18n/ar";
import { en } from "../src/i18n/strings";
import type { CallStats, Match, Pick } from "../src/lib/api";
import { calledIt, cardSpec, isExact, nightOf, shareText } from "../src/lib/callCard";
import type { SetScore } from "../src/lib/validation";

// Invented players and fans (AGENTS.md). Nights as in the event file: 21, 22 and 24 Oct, Riyadh.
const fill =
  (dict: Record<string, string>) => (key: string, vars?: Record<string, string | number>) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) =>
      vars && k in vars ? String(vars[k]) : m,
    );
const tEn = fill(en);
const tAr = fill(ar);
const ss = (s: string): SetScore[] =>
  s.split(" ").map((x) => {
    const [a, b] = x.split("-").map(Number);
    return { p1_games: a!, p2_games: b! };
  });
const match = (over: Partial<Match>): Match =>
  ({
    match_no: 3,
    round: "SF",
    p1_source: { type: "player", id: "a" },
    p2_source: { type: "winner", match: 1 },
    p1_id: "a",
    p2_id: "f",
    starts_at: "2026-10-22T16:30:00Z",
    p1_win_points: 13,
    p2_win_points: 16,
    status: "scheduled",
    winner_id: null,
    set_scores: null,
    started_at: null,
    ...over,
  }) as Match;
const draw = (sf1: Partial<Match> = {}) => [
  match({ match_no: 1, round: "QF", starts_at: "2026-10-21T16:30:00Z" }),
  match({ match_no: 2, round: "QF", starts_at: "2026-10-21T18:40:00Z" }),
  match(sf1),
  match({ match_no: 4, starts_at: "2026-10-22T18:40:00Z" }),
  match({ match_no: 5, round: "3P", starts_at: "2026-10-24T14:00:00Z" }),
  match({ match_no: 6, round: "F", starts_at: "2026-10-24T16:30:00Z" }),
];
const pick = (over: Partial<Pick>): Pick => ({
  match_no: 3,
  winner_id: "a",
  sets: 2,
  set_scores: ss("6-4 6-4"),
  updated_at: "2026-10-22T10:00:00Z",
  pts_winner: null,
  pts_sets: null,
  pts_exact: null,
  exact_sets: null,
  pts_total: null,
  exact_flags: null,
  ...over,
});
// What get_my_call_stats (0023) returns: whole percentages and the server's "rare" answers.
const stats = (
  winnerPct: number,
  exactPct: number,
  winnerRare: boolean,
  exactRare: boolean,
): CallStats => ({
  threshold_met: true,
  winner_pct: winnerPct,
  exact_pct: exactPct,
  winner_rare: winnerRare,
  exact_rare: exactRare,
});
const spec = (
  kind: "my_call" | "called_it",
  m: Match,
  p: Pick,
  s: CallStats | null = null,
  t = tEn,
  locale: "en" | "ar" = "en",
) =>
  cardSpec({
    kind,
    match: m,
    matches: draw(m),
    pick: p,
    names: ["Alpha", "Foxtrot"],
    locale,
    t,
    timezone: "Asia/Riyadh",
    brand: ["Call", "the", "Crown"],
    stats: s,
    code: "ABC234",
    host: "example.test",
  });

describe("percent on a card", () => {
  test("the server's whole percentage, as is", () => {
    expect(shareText(19, tEn)).toBe("19%");
  });
  test("0 (below 1%): the words", () => {
    expect(shareText(0, tEn)).toBe("under 1%");
    expect(shareText(0, tAr)).toBe("أقل من 1%");
  });
});

describe("nights", () => {
  test("21, 22 and 24 Oct are nights 1, 2 and 3 (Riyadh days)", () => {
    const d = draw();
    expect(d.map((m) => nightOf(m, d, "Asia/Riyadh"))).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe("My Call", () => {
  test("the pick's scoreboard, the question, the closing time in Riyadh time", () => {
    const s = spec("my_call", match({}), pick({ set_scores: ss("6-4 3-6 7-5"), sets: 3 }));
    expect(s.variant).toBe("my_call");
    expect(s.chip).toBe("MY CALL");
    expect(s.round).toBe("Semi-final 1 · Night 2");
    expect(s.winner).toBe(1);
    expect(s.sets).toEqual(ss("6-4 3-6 7-5"));
    expect(s.ticks).toEqual([]);
    expect(s.headline).toBe("What's your call?");
    expect(s.lines).toEqual([
      { text: "Picks close Thu 22 Oct · 19:30 Riyadh time", tone: "plain" },
    ]);
    expect(s.footerCta).toBe("Join my league");
  });
  test("no league: Play free and no code", () => {
    const s = cardSpec({ ...baseInput(), code: null });
    expect(s.footerCta).toBe("Play free");
    expect(s.code).toBeNull();
  });
  test("Arabic: the Arabic words", () => {
    const s = spec("my_call", match({}), pick({}), null, tAr, "ar");
    expect(s.chip).toBe("توقعي");
    expect(s.headline).toBe("وما توقعك أنت؟");
  });
});

function baseInput() {
  return {
    kind: "my_call" as const,
    match: match({}),
    matches: draw(),
    pick: pick({}),
    names: ["Alpha", "Foxtrot"] as [string, string],
    locale: "en" as const,
    t: tEn,
    timezone: "Asia/Riyadh",
    brand: ["Call", "the", "Crown"],
    stats: null,
    code: "ABC234",
    host: "example.test",
  };
}

describe("I called it", () => {
  const done = (over: Partial<Match> = {}) =>
    match({ status: "completed", winner_id: "a", set_scores: ss("6-4 6-4"), ...over });
  const scored = (over: Partial<Pick> = {}) =>
    pick({ pts_winner: 13, pts_total: 23, exact_flags: [true, true, null], ...over });

  test("offered only for a scored pick on the winner", () => {
    expect(calledIt(done(), scored())).toBe(true);
    expect(calledIt(done(), scored({ winner_id: "f" }))).toBe(false);
    expect(calledIt(done(), scored({ pts_winner: 0 }))).toBe(false); // a void late pick (0018)
    expect(calledIt(match({}), scored())).toBe(false);
    expect(calledIt(done(), undefined)).toBe(false);
  });
  test("exact: every played set exact, EXACT under every set", () => {
    const s = spec("called_it", done(), scored());
    expect(isExact(done(), scored())).toBe(true);
    expect(s.variant).toBe("exact");
    expect(s.headline).toBe("I called it.");
    expect(s.ticks).toEqual([true, true]);
    expect(s.sets).toEqual(ss("6-4 6-4"));
  });
  test("winner only: ticks only under the exact sets", () => {
    const m = done({ set_scores: ss("6-4 3-6 6-3") });
    const s = spec(
      "called_it",
      m,
      scored({ set_scores: ss("6-4 4-6 6-2"), sets: 3, exact_flags: [true, false, false] }),
    );
    expect(s.variant).toBe("winner");
    expect(s.headline).toBe("Called the winner.");
    expect(s.ticks).toEqual([true, false, false]);
  });
  test("retired: winner only, no ticks, the void line", () => {
    const m = done({ status: "retired", set_scores: ss("6-4 2-1") });
    const s = spec("called_it", m, scored({ exact_flags: null }));
    expect(s.variant).toBe("void");
    expect(s.headline).toBe("Called the winner.");
    expect(s.ticks).toEqual([]);
    expect(s.lines[0]).toEqual({ text: "Retirement: only the winner counts.", tone: "plain" });
  });
  test("rarity, exact: shown when the server says rare, never otherwise", () => {
    expect(spec("called_it", done(), scored(), stats(60, 20, false, true)).lines).toEqual([
      { text: "Only 20% of fans called this exact score.", tone: "gold" },
    ]);
    expect(spec("called_it", done(), scored(), stats(60, 21, false, false)).lines).toEqual([]);
  });
  test("rarity, winner only: shown at 40% or less, with the winner's name", () => {
    const m = done({ set_scores: ss("6-4 3-6 6-3") });
    const p = scored({ sets: 3, set_scores: ss("6-4 4-6 6-2"), exact_flags: [true, false, false] });
    expect(spec("called_it", m, p, stats(40, 0, true, true)).lines).toEqual([
      { text: "Only 40% backed Alpha.", tone: "gold" },
    ]);
    expect(spec("called_it", m, p, stats(40, 0, false, true)).lines).toEqual([]); // 40.1%: floored to 40, not rare
  });
  test("void with a rare winner: the void line, then the rarity line", () => {
    const m = done({ status: "retired", set_scores: ss("6-4 2-1") });
    const s = spec("called_it", m, scored({ exact_flags: null }), stats(15, 0, true, true));
    expect(s.lines.map((l) => l.text)).toEqual([
      "Retirement: only the winner counts.",
      "Only 15% backed Alpha.",
    ]);
  });
  test("below the minimum (threshold not met): no rarity line", () => {
    const below: CallStats = {
      threshold_met: false,
      winner_pct: null,
      exact_pct: null,
      winner_rare: null,
      exact_rare: null,
    };
    expect(spec("called_it", done(), scored(), below).lines).toEqual([]);
    expect(spec("called_it", done(), scored(), null).lines).toEqual([]);
  });
});

// full-debug F1 (0023, Tino 5 Oct 2026): a night runs 06:00 → 05:59 Riyadh time, as match_nights().
describe("nights across midnight in Riyadh", () => {
  const at = (n: number, iso: string) => (d: Match[]) =>
    d.map((m) => (m.match_no === n ? { ...m, starts_at: iso } : m));
  test("QF2 at 00:30 Riyadh (21:30 UTC) stays on night 1", () => {
    const d = at(2, "2026-10-21T21:30:00Z")(draw());
    expect(d.map((m) => nightOf(m, d, "Asia/Riyadh"))).toEqual([1, 1, 2, 2, 3, 3]);
  });
  test("the final at 00:30 Riyadh is still night 3", () => {
    const d = at(6, "2026-10-24T21:30:00Z")(draw());
    expect(d.map((m) => nightOf(m, d, "Asia/Riyadh"))).toEqual([1, 1, 2, 2, 3, 3]);
  });
  test("05:59 Riyadh belongs to the night before; 06:00 starts the next", () => {
    const early = at(2, "2026-10-22T02:59:00Z")(draw());
    expect(nightOf(early[1]!, early, "Asia/Riyadh")).toBe(1);
    const late = at(2, "2026-10-22T03:00:00Z")(draw());
    expect(nightOf(late[1]!, late, "Asia/Riyadh")).toBe(2);
  });
});
