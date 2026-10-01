// The Wikipedia adapter against the real 2024 and 2025 brackets (attributed excerpts in
// tests/fixtures/wikipedia), plus the edit states a live page goes through.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBracket,
  WikipediaAdapter,
} from "../supabase/functions/poll-results/adapters/wikipedia.ts";
import { validateSetScores, type ScoreRules } from "../src/lib/validation";
import vectors from "./vectors/set-scores.json";

const fixture = (year: number) =>
  readFileSync(
    join(import.meta.dir, "fixtures", "wikipedia", `${year}_Six_Kings_Slam.wikitext`),
    "utf8",
  );
const s = (...sets: [number, number][]) => sets.map(([a, b]) => ({ p1_games: a, p2_games: b }));

describe("2025 bracket (zero-padded and plain slot numbers, a retirement)", () => {
  const m = parseBracket(fixture(2025));
  it("finds all six matches", () => {
    expect([...m.keys()].sort()).toEqual([
      "3rd:1-2",
      "RD1:3-4",
      "RD1:5-6",
      "RD2:1-2",
      "RD2:3-4",
      "RD3:1-2",
    ]);
  });
  it("quarter-finals", () => {
    expect(m.get("RD1:3-4")!.result).toEqual({
      status: "completed",
      players: ["Taylor Fritz", "Alexander Zverev"],
      winner: "Taylor Fritz",
      set_scores: s([6, 3], [6, 4]),
    });
    expect(m.get("RD1:5-6")!.result).toEqual({
      status: "completed",
      players: ["Stefanos Tsitsipas", "Jannik Sinner"],
      winner: "Jannik Sinner",
      set_scores: s([2, 6], [3, 6]),
    });
  });
  it("semi-finals and final", () => {
    expect(m.get("RD2:1-2")!.result.winner).toBe("Carlos Alcaraz");
    expect(m.get("RD2:1-2")!.result.set_scores).toEqual(s([6, 4], [6, 2]));
    expect(m.get("RD2:3-4")!.result.winner).toBe("Jannik Sinner");
    expect(m.get("RD3:1-2")!.result).toEqual({
      status: "completed",
      players: ["Carlos Alcaraz", "Jannik Sinner"],
      winner: "Jannik Sinner",
      set_scores: s([2, 6], [4, 6]),
    });
  });
  it("third place: Djokovic retired, the tiebreak points are dropped (7-6, not 77-64)", () => {
    expect(m.get("3rd:1-2")!.result).toEqual({
      status: "retired",
      players: ["Taylor Fritz", "Novak Djokovic"],
      winner: "Taylor Fritz",
      set_scores: s([7, 6], [0, 0]),
    });
  });
});

describe("2024 bracket (three-set matches)", () => {
  const m = parseBracket(fixture(2024));
  it("semi-final 1: Sinner beat Djokovic 6-2 6-7 6-4 (Djokovic listed first)", () => {
    expect(m.get("RD2:1-2")!.result).toEqual({
      status: "completed",
      players: ["Novak Djokovic", "Jannik Sinner"],
      winner: "Jannik Sinner",
      set_scores: s([2, 6], [7, 6], [4, 6]),
    });
  });
  it("final: Sinner beat Alcaraz 6-7 6-3 6-3", () => {
    expect(m.get("RD3:1-2")!.result.set_scores).toEqual(s([6, 7], [6, 3], [6, 3]));
    expect(m.get("RD3:1-2")!.result.winner).toBe("Jannik Sinner");
  });
  it("every completed result of both years passes the game's own score rules", () => {
    const rules = vectors.rules as ScoreRules;
    for (const year of [2024, 2025]) {
      for (const { result } of parseBracket(fixture(year)).values()) {
        if (result.status !== "completed") continue;
        const slot = result.winner === result.players[0] ? 1 : 2;
        expect(
          validateSetScores(rules, slot, result.set_scores.length, result.set_scores),
        ).toBeNull();
      }
    }
  });
});

describe("a live page, edit by edit", () => {
  const bracket = (t1: string, t2: string, sc1: string[], sc2: string[]) =>
    [
      "{{#invoke:bracket|8TeamBracket|compact=y|sets=3|byes=1",
      `| RD1-team03=${t1}`,
      ...sc1.map((v, i) => `| RD1-score03-${i + 1}=${v}`),
      `| RD1-team04=${t2}`,
      ...sc2.map((v, i) => `| RD1-score04-${i + 1}=${v}`),
      "}}",
    ].join("\n");
  const read = (t1: string, t2: string, sc1: string[], sc2: string[]) =>
    parseBracket(bracket(t1, t2, sc1, sc2)).get("RD1:3-4")!.result;
  const A = "{{flagicon|AAA}} [[Player A]]";
  const B = "{{flagicon|BBB}} [[Player B (tennis)|Player B]]";

  it("players not known yet: scheduled, no players", () => {
    expect(read("", "", [], []).status).toBe("scheduled");
    expect(read("TBD", B, [], []).players).toEqual([]);
  });
  it("both known, no score: scheduled", () => {
    expect(read(A, B, ["", "", ""], ["", "", ""])).toMatchObject({
      status: "scheduled",
      players: ["Player A", "Player B (tennis)"],
    });
  });
  it("scores going in, nobody in bold: live, never final", () => {
    expect(read(A, B, ["6", "3", ""], ["4", "2", ""])).toMatchObject({
      status: "live",
      winner: null,
    });
  });
  it("winner in bold: completed", () => {
    expect(read(`'''${A}'''`, B, ["'''6'''", "'''6'''", ""], ["4", "2", ""])).toMatchObject({
      status: "completed",
      winner: "Player A",
      set_scores: s([6, 4], [6, 2]),
    });
  });
  it("both in bold (an editing mistake): unknown, never final", () => {
    expect(read(`'''${A}'''`, `'''${B}'''`, ["6", "6"], ["4", "2"]).status).toBe("unknown");
  });
  it("a walkover", () => {
    expect(read(`'''${A}'''`, B, ["w/o", ""], ["", ""])).toMatchObject({
      status: "walkover",
      winner: "Player A",
      set_scores: [],
    });
  });
  it("a retirement written as 'ret.'", () => {
    expect(read(`'''${A}'''`, B, ["6", "2"], ["4", "1 ret."]).status).toBe("retired");
  });
  it("junk in a score cell is not read as a number", () => {
    expect(read(`'''${A}'''`, B, ["'''6'''", "six"], ["4", "2"]).set_scores).toEqual(s([6, 4]));
  });
});

describe("the adapter", () => {
  const apiBody = (content: string, revid = 42) => ({
    query: {
      pages: [
        { revisions: [{ revid, timestamp: "2026-10-21T18:00:00Z", slots: { main: { content } } }] },
      ],
    },
  });
  const ctx = { nowMs: 0, startsAt: null };

  it("one request per run, with the User-Agent, and the revision recorded for the audit", async () => {
    const calls: { url: string; ua: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ua: new Headers(init?.headers).get("User-Agent") });
      return new Response(JSON.stringify(apiBody(fixture(2025))), { status: 200 });
    }) as unknown as typeof fetch;
    const wp = new WikipediaAdapter(
      "2025 Six Kings Slam",
      "SixKingsPredictor/1.0 (ops@example.test)",
      fakeFetch,
    );
    const qf = await wp.fetchMatch("RD1:3-4", ctx);
    const f = await wp.fetchMatch("RD3:1-2", ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ua).toBe("SixKingsPredictor/1.0 (ops@example.test)");
    expect(calls[0]!.url).toContain("titles=2025%20Six%20Kings%20Slam");
    expect(calls[0]!.url).toContain("maxlag=5");
    expect(qf.normalised.winner).toBe("Taylor Fritz");
    expect(f.normalised.match_ref).toBe("RD3:1-2");
    expect(qf.raw).toMatchObject({
      revid: 42,
      url: "https://en.wikipedia.org/w/index.php?oldid=42",
    });
    expect((qf.raw as { lines: string[] }).lines.length).toBeGreaterThan(4);
  });

  it("a page that does not exist yet, an HTTP error, a lagging server: unknown, never a result", async () => {
    const respond = (body: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const missing = await new WikipediaAdapter(
      "x",
      "ua",
      respond({ query: { pages: [{ missing: true }] } }),
    ).fetchMatch("RD1:3-4", ctx);
    expect([missing.http_status, missing.normalised.status]).toEqual([404, "unknown"]);
    const down = await new WikipediaAdapter("x", "ua", respond({}, 503)).fetchMatch("RD1:3-4", ctx);
    expect([down.http_status, down.normalised.status]).toEqual([503, "unknown"]);
    const lag = await new WikipediaAdapter(
      "x",
      "ua",
      respond({ error: { code: "maxlag", info: "lagged" } }),
    ).fetchMatch("RD1:3-4", ctx);
    expect([lag.http_status, lag.normalised.status]).toEqual([503, "unknown"]);
  });

  it("refuses to run without a contact User-Agent", () => {
    expect(() => new WikipediaAdapter("2026 Six Kings Slam", "")).toThrow();
  });
});
