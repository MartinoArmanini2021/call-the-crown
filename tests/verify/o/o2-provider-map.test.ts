/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// O2: provider_map completeness for every provider in use.
//   wikipedia (production, supabase/events/sixkings_2026_draw.sql) and fixture (local, supabase/dev/seed_local.sql).
//   sportradar has an adapter but no map anywhere: it is not "in use" (README: added only if a contract lands).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../../scripts/lib/db";
import { parseBracket } from "../../../supabase/functions/poll-results/adapters/wikipedia.ts";
import { freshEvent } from "./lib";

let db: PGlite;
beforeAll(async () => {
  db = (await freshEvent()).db; // migrations + event file + the real 2026 draw file
}, 60_000);
afterAll(() => db.close());

const rows = async (sql: string) => (await db.query<any>(sql)).rows;

describe("O2 wikipedia map (production draw file)", () => {
  it("all 6 matches mapped, one slot each, no slot reused", async () => {
    const m = await rows(
      "select our_ref::int as n, provider_ref from public.provider_map where provider = 'wikipedia' and kind = 'match' order by 1",
    );
    expect(m.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(m.map((r) => r.provider_ref)).size).toBe(6);
  });

  it("all 6 players mapped, every mapped id is a real player, no player mapped twice", async () => {
    const missing = await rows(
      "select id from public.players where id not in (select our_ref from public.provider_map where provider = 'wikipedia' and kind = 'player')",
    );
    expect(missing).toEqual([]);
    const dangling = await rows(
      "select our_ref from public.provider_map where provider = 'wikipedia' and kind = 'player' and our_ref not in (select id from public.players)",
    );
    expect(dangling).toEqual([]);
    expect((await rows("select count(*)::int as n from public.players"))[0].n).toBe(6);
  });

  it("the slot layout agrees with the bracket topology: each SF/F/3P slot pair is fed by the slots our sources say", async () => {
    // In an 8-team bracket RD2 slot k is fed by RD1 match ceil(k)… : RD2:1-2 ← RD1:1-2 (bye) and RD1:3-4;
    // RD2:3-4 ← RD1:5-6 and RD1:7-8 (bye); RD3:1-2 ← RD2:1-2 and RD2:3-4; 3rd ← the two RD2 losers.
    const map = Object.fromEntries(
      (
        await rows(
          "select our_ref, provider_ref from public.provider_map where provider='wikipedia' and kind='match'",
        )
      ).map((r) => [r.our_ref, r.provider_ref]),
    );
    const feeds: Record<string, string[]> = {
      "RD2:1-2": ["RD1:3-4"],
      "RD2:3-4": ["RD1:5-6"],
      "RD3:1-2": ["RD2:1-2", "RD2:3-4"],
      "3rd:1-2": ["RD2:1-2", "RD2:3-4"],
    };
    const m = await rows(
      "select match_no::text as n, p1_source, p2_source from public.matches order by match_no",
    );
    for (const r of m) {
      const srcs = [r.p1_source, r.p2_source]
        .filter((s: any) => s.type !== "player")
        .map((s: any) => map[String(s.match)]);
      if (srcs.length) expect(srcs.sort()).toEqual([...feeds[map[r.n]]!].sort());
    }
  });

  it("the 2025 page (same layout) yields exactly the six mapped slots", () => {
    const page = readFileSync(
      join(ROOT, "tests", "fixtures", "wikipedia", "2025_Six_Kings_Slam.wikitext"),
      "utf8",
    );
    expect([...parseBracket(page).keys()].sort()).toEqual([
      "3rd:1-2",
      "RD1:3-4",
      "RD1:5-6",
      "RD2:1-2",
      "RD2:3-4",
      "RD3:1-2",
    ]);
  });
});

describe("O2 fixture map (local seed)", () => {
  it("every match ref in fixtures/event.json is mapped by the local seed, and so is every player it names", () => {
    const ev = JSON.parse(
      readFileSync(
        join(ROOT, "supabase", "functions", "poll-results", "fixtures", "event.json"),
        "utf8",
      ),
    ) as Record<string, any>;
    const seed = readFileSync(join(ROOT, "supabase", "dev", "seed_local.sql"), "utf8");
    expect(seed).toContain("'fx-m' || n");
    expect(Object.keys(ev).sort()).toEqual(["fx-m1", "fx-m2", "fx-m3", "fx-m4", "fx-m5", "fx-m6"]);
    const players = new Set(Object.values(ev).flatMap((p) => [...p.players, p.winner]));
    for (const p of players) expect(["fx-a", "fx-b", "fx-c", "fx-d", "fx-e", "fx-f"]).toContain(p);
  });
});
