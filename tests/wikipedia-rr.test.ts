// The Wikipedia adapter on the ATP Finals shape: two {{4TeamRR-TennisWide}} groups plus a
// {{4TeamBracket-Tennis3}} knockout, from the real 2025 article (attributed excerpt in
// tests/fixtures/wikipedia), and the edit states a live group table goes through.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBracket,
  parseRoundRobin,
  WikipediaAdapter,
} from "../supabase/functions/poll-results/adapters/wikipedia.ts";

const page = readFileSync(
  join(import.meta.dir, "fixtures", "wikipedia", "2025_ATP_Finals_Singles.wikitext"),
  "utf8",
);
const s = (...sets: [number, number][]) => sets.map(([a, b]) => ({ p1_games: a, p2_games: b }));

describe("2025 ATP Finals: the two groups", () => {
  const rr = parseRoundRobin(page);
  it("finds all twelve group matches, six per group", () => {
    const keys = [...rr.keys()].sort();
    expect(keys.length).toBe(12);
    expect(keys.filter((k) => k.startsWith("Jimmy Connors Group:")).length).toBe(6);
    expect(keys.filter((k) => k.startsWith("Björn Borg Group:")).length).toBe(6);
  });
  it("a three-set match with a tiebreak set, read from the winner's row", () => {
    expect(rr.get("Jimmy Connors Group:1v2")!.result).toEqual({
      status: "completed",
      players: ["Carlos Alcaraz", "Taylor Fritz"],
      winner: "Carlos Alcaraz",
      set_scores: s([6, 7], [7, 5], [6, 3]),
    });
  });
  it("a match won by the lower row's player keeps the upper row's player first", () => {
    expect(rr.get("Jimmy Connors Group:3v4")!.result).toEqual({
      status: "completed",
      players: ["Alex de Minaur", "Lorenzo Musetti"],
      winner: "Lorenzo Musetti",
      set_scores: s([5, 7], [6, 3], [5, 7]),
    });
  });
  it("the second group is read separately", () => {
    expect(rr.get("Björn Borg Group:1v2")!.result).toEqual({
      status: "completed",
      players: ["Jannik Sinner", "Alexander Zverev"],
      winner: "Jannik Sinner",
      set_scores: s([6, 4], [6, 3]),
    });
    expect(rr.get("Björn Borg Group:2v4")!.result.winner).toBe("Félix Auger-Aliassime");
  });
  it("every finished match has a winner who won the deciding set count", () => {
    for (const [, m] of rr) {
      expect(m.result.status).toBe("completed");
      const won = m.result.set_scores.filter((x) =>
        m.result.winner === m.result.players[0] ? x.p1_games > x.p2_games : x.p2_games > x.p1_games,
      ).length;
      expect(won).toBe(2);
    }
  });
  it("the lines that produced a reading are kept for the audit trail", () => {
    const m = rr.get("Jimmy Connors Group:1v4")!;
    expect(m.lines.some((l) => l.includes("1v4="))).toBe(true);
    expect(m.lines.some((l) => l.includes("team-4="))).toBe(true);
  });
});

describe("2025 ATP Finals: the knockout bracket uses the existing reader", () => {
  const ko = parseBracket(page);
  it("semi-finals and final", () => {
    expect([...ko.keys()].sort()).toEqual(["RD1:1-2", "RD1:3-4", "RD2:1-2"]);
    expect(ko.get("RD1:1-2")!.result).toEqual({
      status: "completed",
      players: ["Carlos Alcaraz", "Félix Auger-Aliassime"],
      winner: "Carlos Alcaraz",
      set_scores: s([6, 2], [6, 4]),
    });
    expect(ko.get("RD2:1-2")!.result).toEqual({
      status: "completed",
      players: ["Carlos Alcaraz", "Jannik Sinner"],
      winner: "Jannik Sinner",
      set_scores: s([6, 7], [5, 7]),
    });
  });
  it("group refs never collide with bracket refs", () => {
    const rr = parseRoundRobin(page);
    for (const k of rr.keys()) expect(ko.has(k)).toBe(false);
  });
});

// A blank 2026-style group table, then the states it passes through during a match.
const blank = `===[[John McEnroe]] Group===
{{4TeamRR-TennisWide
| seed-1=1
| team-1={{nowrap|{{flagicon|GER}} [[Alexander Zverev]]}}
| team-2={{flagicon|USA}} [[Ben Shelton]]
| team-3={{flagicon|FRA}} [[Arthur Fils]]
| team-4={{flagicon|ESP}} [[Rafael Jódar]]
|color-row-1= |1v2= |1v3= |1v4=CELL14
|color-row-2= |2v1= |2v3=CELL23 |2v4=
|color-row-3= |3v1= |3v2=CELL32 |3v4=
|color-row-4= |4v1=CELL41 |4v2= |4v3=
}}`;
const group = (c14: string, c41: string, c23 = "", c32 = "") =>
  parseRoundRobin(
    blank
      .replace("CELL14", c14)
      .replace("CELL41", c41)
      .replace("CELL23", c23)
      .replace("CELL32", c32),
  );

describe("a live group table", () => {
  it("empty cells: scheduled, players known", () => {
    expect(group("", "").get("John McEnroe Group:1v4")!.result).toEqual({
      status: "scheduled",
      players: ["Alexander Zverev", "Rafael Jódar"],
      winner: null,
      set_scores: [],
    });
  });
  it("games but no bold: live (play has begun)", () => {
    expect(group("6–4, 2–3", "").get("John McEnroe Group:1v4")!.result.status).toBe("live");
  });
  it("bold in the lower row's cell: that player won, sets turned to the upper row's view", () => {
    expect(
      group("", "'''6–4, 7–6<sup>(7–3)</sup>'''").get("John McEnroe Group:1v4")!.result,
    ).toEqual({
      status: "completed",
      players: ["Alexander Zverev", "Rafael Jódar"],
      winner: "Rafael Jódar",
      set_scores: s([4, 6], [6, 7]),
    });
  });
  it("both cells bold: unknown, never final", () => {
    expect(
      group("'''6–4, 6–4'''", "'''4–6, 4–6'''").get("John McEnroe Group:1v4")!.result.status,
    ).toBe("unknown");
  });
  it("the two cells disagree: unknown, never final", () => {
    expect(group("'''6–4, 6–4'''", "4–6, 3–6").get("John McEnroe Group:1v4")!.result.status).toBe(
      "unknown",
    );
  });
  it("a retirement", () => {
    const r = group("'''6–4, 2–1 ret.'''", "4–6, 1–2").get("John McEnroe Group:1v4")!.result;
    expect(r.status).toBe("retired");
    expect(r.winner).toBe("Alexander Zverev");
    expect(r.set_scores).toEqual(s([6, 4], [2, 1]));
  });
  it("a walkover", () => {
    const r = group("'''w/o'''", "").get("John McEnroe Group:1v4")!.result;
    expect(r.status).toBe("walkover");
    expect(r.set_scores).toEqual([]);
  });
  it("cells on the same line are kept apart", () => {
    const g = group("", "", "'''6–3, 6–3'''", "3–6, 3–6");
    expect(g.get("John McEnroe Group:2v3")!.result.winner).toBe("Ben Shelton");
    expect(g.get("John McEnroe Group:1v4")!.result.status).toBe("scheduled");
  });
});

describe("the adapter serves group refs from the same page request", () => {
  it("fetchMatch finds a group match", async () => {
    const body = {
      query: {
        pages: [
          {
            revisions: [
              { revid: 7, timestamp: "2025-12-04T06:20:28Z", slots: { main: { content: page } } },
            ],
          },
        ],
      },
    };
    const a = new WikipediaAdapter(
      "2025 ATP Finals – Singles",
      "test-agent",
      (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch,
    );
    const r = await a.fetchMatch("Björn Borg Group:1v2", { now: new Date() } as never);
    expect(r.normalised.status).toBe("completed");
    expect(r.normalised.winner).toBe("Jannik Sinner");
    const ko = await a.fetchMatch("RD2:1-2", { now: new Date() } as never);
    expect(ko.normalised.winner).toBe("Jannik Sinner");
  });
});
