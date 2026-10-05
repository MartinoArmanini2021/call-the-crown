// Part 1 B2 (full debug brief): tests for mutants of the bragging-rights code that left the build's own
// suite green. Each test passes on feat/bragging-rights 84dfadd and fails on the mutant named above it.
// (The nightOf UTC-vs-timezone test waits on the F1 night decision and is not here yet.)
// Invented players and fans only (AGENTS.md).
import { describe, expect, test } from "bun:test";
import { checkUnsubToken, unsubToken } from "../supabase/functions/_shared/unsubToken";
import { handleUnsubscribe } from "../supabase/functions/reminder-unsubscribe/handler";
import {
  runReminders,
  type Candidate,
  type Config,
  type RemindersDb,
} from "../supabase/functions/send-reminders/reminders";
import { en } from "../src/i18n/strings";
import type { CallStats, Match, Pick } from "../src/lib/api";
import { cardSpec, shareText } from "../src/lib/callCard";
import type { SetScore } from "../src/lib/validation";

const tEn = (key: string, vars?: Record<string, string | number>) =>
  ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) =>
    vars && k in vars ? String(vars[k]) : m,
  );
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
    status: "completed",
    winner_id: "a",
    set_scores: ss("6-4 6-4"),
    started_at: null,
    ...over,
  }) as Match;
const draw = (m: Match) => [
  match({ match_no: 1, round: "QF", starts_at: "2026-10-21T16:30:00Z" }),
  match({ match_no: 2, round: "QF", starts_at: "2026-10-21T18:40:00Z" }),
  m,
  match({ match_no: 4, starts_at: "2026-10-22T18:40:00Z" }),
  match({ match_no: 5, round: "3P", starts_at: "2026-10-24T14:00:00Z" }),
  match({ match_no: 6, round: "F", starts_at: "2026-10-24T16:30:00Z" }),
];
const scored = (over: Partial<Pick> = {}): Pick => ({
  match_no: 3,
  winner_id: "a",
  sets: 2,
  set_scores: ss("6-4 6-4"),
  updated_at: "2026-10-22T10:00:00Z",
  pts_winner: 13,
  pts_sets: null,
  pts_exact: null,
  exact_sets: null,
  pts_total: 23,
  exact_flags: [true, true, null],
  ...over,
});
const stats = (total: number, winner: number, exact: number): CallStats => ({
  threshold_met: true,
  picks_total: total,
  same_winner: winner,
  same_exact: exact,
});
const spec = (m: Match, p: Pick, s: CallStats | null, perfect?: boolean) =>
  cardSpec({
    kind: "called_it",
    match: m,
    matches: draw(m),
    pick: p,
    names: ["Alpha", "Foxtrot"],
    locale: "en",
    t: tEn,
    timezone: "Asia/Riyadh",
    brand: ["Call", "the", "Crown"],
    stats: s,
    perfect,
    code: null,
    host: "example.test",
  });

// Mutants: `pct < 1` → `pct < 0.5`, and `pct < 1` → `pct <= 1` (brief: "Below 1%, use pct_under_1").
describe("pct_under_1 boundary", () => {
  test("0.5% and 0.9% are under 1%; exactly 1% is 1%", () => {
    expect(shareText(5, 1000, tEn)).toBe("under 1%");
    expect(shareText(9, 1000, tEn)).toBe("under 1%");
    expect(shareText(10, 1000, tEn)).toBe("1%");
  });
});

// Mutant: the winner-only rarity line also drawn on an exact card (`variant !== "exact"` dropped).
// Brief: exact variant → the exact line (≤ 20%); winner-only variant → the winner line (≤ 40%).
describe("rarity line by variant", () => {
  test("an exact card never carries the winner-only line", () => {
    // exact 25% (> 20%: no exact line); winner 30% (≤ 40%, but this is not a winner-only card)
    expect(spec(match({}), scored(), stats(100, 30, 25)).lines).toEqual([]);
    // exact 10%: only the exact line, even though the winner share (30%) is also rare
    expect(spec(match({}), scored(), stats(100, 30, 10)).lines.map((l) => l.text)).toEqual([
      "Only 10% of fans called this exact score.",
    ]);
  });
});

// Mutant: `ribbon: input.perfect ? t("card_perfect_ribbon") : null` → `ribbon: null`.
describe("Perfect Night ribbon", () => {
  test("shown on an I-called-it card of a perfect night, and only then", () => {
    expect(spec(match({}), scored(), null, true).ribbon).toBe("PERFECT NIGHT");
    expect(spec(match({}), scored(), null, false).ribbon).toBeNull();
    expect(spec(match({}), scored(), null).ribbon).toBeNull();
  });
});

// Mutant: a real send claimed with dryRun = true, so reminder_sends says "dry_run" for an email that
// went out (claim(c.user_id, c.night_no, false) → true). The build's fake only checked dry runs.
describe("send-reminders: the claim's status", () => {
  test("a real run claims with dryRun = false (row 'sent'); a dry run with true", async () => {
    const U = "00000000-0000-0000-0000-00000000f001";
    const cand: Candidate = {
      user_id: U,
      email: "f001@example.test",
      locale: "en",
      night_no: 1,
      first_start: "2026-10-21T16:30:00Z",
      open_count: 1,
      total_count: 2,
      league_name: null,
      league_rank: null,
      league_size: null,
    };
    const cfg: Config = {
      apiKey: "re_test",
      from: "Call the Crown <reminders@example.test>",
      appUrl: "https://app.example.test",
      functionsUrl: "https://fn.example.test/functions/v1",
      secret: "test-secret-not-real",
    };
    const claims: boolean[] = [];
    const db: RemindersDb = {
      candidates: async () => [cand],
      timezone: async () => "Asia/Riyadh",
      claim: async (_u, _n, dry) => (claims.push(dry), true),
      failed: async () => {},
      heartbeat: async () => {},
    };
    let sent = 0;
    await runReminders(db, cfg, async () => void sent++);
    expect(sent).toBe(1);
    expect(claims).toEqual([false]);
    await runReminders(db, { ...cfg, apiKey: undefined }, async () => void sent++);
    expect(sent).toBe(1);
    expect(claims).toEqual([false, true]);
  });
});

// Mutant: the length check in checkUnsubToken removed. The loop then runs over the expected token
// only, so the right token with anything appended is accepted.
describe("unsubscribe token: exact match only", () => {
  test("the right token with extra characters is refused (and the handler answers 403)", async () => {
    const SECRET = "test-secret-not-real";
    const U = "00000000-0000-0000-0000-00000000f001";
    const tok = await unsubToken(SECRET, U);
    expect(await checkUnsubToken(SECRET, U, tok + "A")).toBe(false);
    expect(await checkUnsubToken(SECRET, U, tok + tok)).toBe(false);
    const calls: string[] = [];
    const res = await handleUnsubscribe(
      new Request(`https://fn.example.test/functions/v1/reminder-unsubscribe?u=${U}&t=${tok}x`, {
        method: "POST",
      }),
      { secret: SECRET, unsubscribe: async (id) => (calls.push(id), true) },
    );
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });
});
