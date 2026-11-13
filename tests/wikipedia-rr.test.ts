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

// ---------------------------------------------------------------------------------------------------
// Audit 13 Nov 2026: the live 2026 article, saved before play (revision 1385229882), read against the
// event's own draw file, so a heading, a row order or a link title that does not produce exactly our
// provider_map refs and our pairings fails here and not on Sunday.
// ---------------------------------------------------------------------------------------------------
const live = readFileSync(
  join(import.meta.dir, "fixtures", "wikipedia", "2026_ATP_Finals_Singles.wikitext"),
  "utf8",
);
const drawSql = readFileSync(
  join(import.meta.dir, "..", "supabase", "events", "atp_finals_2026_draw.sql"),
  "utf8",
);
const mapRows = [
  ...drawSql.matchAll(/\('wikipedia', '(match|player)', '([^']+)',\s*'([^']+)'\)/g),
].map((m) => ({ kind: m[1]!, ref: m[2]!, our: m[3]! }));
const matchRef = new Map(
  mapRows.filter((r) => r.kind === "match").map((r) => [Number(r.our), r.ref]),
);
const playerOf = new Map(mapRows.filter((r) => r.kind === "player").map((r) => [r.ref, r.our]));
const ourPair = new Map(
  [
    ...drawSql.matchAll(
      /"match_no":(\d+),\s*"round":"RR".*?"p1":\{"type":"player","id":"(\w+)"\},\s*"p2":\{"type":"player","id":"(\w+)"\}/g,
    ),
  ].map((m) => [Number(m[1]), [m[2]!, m[3]!].sort().join(" v ")]),
);

describe("2026 ATP Finals: the live article before play", () => {
  const rr = parseRoundRobin(live);
  const ko = parseBracket(live);
  it("the draw file maps twelve group matches and three knockout matches", () => {
    expect(ourPair.size).toBe(12);
    expect(matchRef.size).toBe(15);
  });
  it("the page has exactly the twelve group refs of provider_map, all scheduled", () => {
    const refs = [...matchRef.entries()]
      .filter(([n]) => n <= 12)
      .map(([, r]) => r)
      .sort();
    expect([...rr.keys()].sort()).toEqual(refs);
    for (const [, m] of rr) expect(m.result.status).toBe("scheduled");
  });
  it("each ref pairs the same two players as our match (titles with diacritics resolve)", () => {
    for (let n = 1; n <= 12; n++) {
      const got = rr
        .get(matchRef.get(n)!)!
        .result.players.map((t) => playerOf.get(t) ?? `unmapped:${t}`);
      expect(`${n}: ${[...got].sort().join(" v ")}`).toBe(`${n}: ${ourPair.get(n)}`);
    }
  });
  it("the knockout refs exist, empty until the groups end", () => {
    expect([...ko.keys()].sort()).toEqual(
      [matchRef.get(13), matchRef.get(14), matchRef.get(15)].sort(),
    );
    for (const [, m] of ko) {
      expect(m.result).toEqual({ status: "scheduled", players: [], winner: null, set_scores: [] });
    }
  });
  it("a heading tidied to sentence case keeps the refs", () => {
    const tidied = parseRoundRobin(
      live.replace("===[[John McEnroe]] Group===", "===[[John McEnroe]] group==="),
    );
    expect(tidied.get("John McEnroe Group:1v4")?.result.players).toEqual([
      "Alexander Zverev",
      "Rafael Jódar",
    ]);
  });
});

// The real 2021 article: Norrie in for Tsitsipas, Sinner in for Berrettini (each sharing the row of the
// player he replaced, every cell noting who played), and Berrettini's retirement against Zverev.
const y2021 = readFileSync(
  join(import.meta.dir, "fixtures", "wikipedia", "2021_ATP_Finals_Singles.wikitext"),
  "utf8",
);

describe("2021 ATP Finals: alternates and a retirement", () => {
  const rr = parseRoundRobin(y2021);
  it("headings in sentence case ('Red group') are read, the ref says 'Group'", () => {
    expect([...rr.keys()].filter((k) => k.startsWith("Red Group:")).length).toBe(6);
    expect([...rr.keys()].filter((k) => k.startsWith("Green Group:")).length).toBe(6);
  });
  it("a match the alternate played names the alternate", () => {
    expect(rr.get("Red Group:1v3")!.result).toEqual({
      status: "completed",
      players: ["Daniil Medvedev", "Jannik Sinner"],
      winner: "Daniil Medvedev",
      set_scores: s([6, 0], [6, 7], [7, 6]),
    });
    expect(rr.get("Red Group:3v4")!.result.players).toEqual(["Jannik Sinner", "Hubert Hurkacz"]);
    expect(rr.get("Green Group:1v2")!.result.players).toEqual(["Novak Djokovic", "Cameron Norrie"]);
    expect(rr.get("Green Group:2v4")!.result.players).toEqual(["Cameron Norrie", "Casper Ruud"]);
  });
  it("a match the withdrawn player played still names him", () => {
    expect(rr.get("Green Group:2v3")!.result).toEqual({
      status: "completed",
      players: ["Stefanos Tsitsipas", "Andrey Rublev"],
      winner: "Andrey Rublev",
      set_scores: s([4, 6], [4, 6]),
    });
  });
  it("the retirement, with the unfinished set", () => {
    expect(rr.get("Red Group:2v3")!.result).toEqual({
      status: "retired",
      players: ["Alexander Zverev", "Matteo Berrettini"],
      winner: "Alexander Zverev",
      set_scores: s([7, 6], [1, 0]),
    });
  });
  it("an alternate's match not yet played names the alternate (the row's last player)", () => {
    const before = y2021
      .replace(
        "|3v4='''6–2, 6–2''' <small><br />''(w/ [[Jannik Sinner|Sinner]])''</small>",
        "|3v4=",
      )
      .replace("|4v3=2–6, 2–6 <small><br />''(w/ [[Jannik Sinner|Sinner]])''</small>", "|4v3=");
    expect(before).not.toBe(y2021);
    expect(parseRoundRobin(before).get("Red Group:3v4")!.result).toEqual({
      status: "scheduled",
      players: ["Jannik Sinner", "Hubert Hurkacz"],
      winner: null,
      set_scores: [],
    });
  });
});

describe("cells with more than a score", () => {
  it("a citation in a cell is not read as games", () => {
    const g = group("'''6–4, 6–4'''<ref name=atp>Scores of 2026-11-15</ref>", "4–6, 4–6");
    expect(g.get("John McEnroe Group:1v4")!.result).toEqual({
      status: "completed",
      players: ["Alexander Zverev", "Rafael Jódar"],
      winner: "Alexander Zverev",
      set_scores: s([6, 4], [6, 4]),
    });
  });
  it("a default mid-match reads like a retirement, not as a finished match", () => {
    const r = group("'''6–4, 3–1 def.'''", "4–6, 1–3 def.").get("John McEnroe Group:1v4")!.result;
    expect(r.status).toBe("retired");
    expect(r.set_scores).toEqual(s([6, 4], [3, 1]));
  });
});
