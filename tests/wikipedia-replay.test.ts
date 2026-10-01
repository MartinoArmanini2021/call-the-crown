// End to end with the real 2025 page: the Wikipedia adapter → the poller → ingest_result → settlement,
// on the real migrations, over simulated time. The 2025 bracket is replayed on the 2026 schedule.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb } from "../scripts/lib/db";
import { pollAsService } from "../scripts/lib/poller";
import { WikipediaAdapter } from "../supabase/functions/poll-results/adapters/wikipedia.ts";

const page = readFileSync(
  join(import.meta.dir, "fixtures", "wikipedia", "2025_Six_Kings_Slam.wikitext"),
  "utf8",
);
const fakeFetch = (async () =>
  new Response(
    JSON.stringify({
      query: {
        pages: [
          {
            revisions: [
              {
                revid: 1377220243,
                timestamp: "2026-09-28T10:28:56Z",
                slots: { main: { content: page } },
              },
            ],
          },
        ],
      },
    }),
    { status: 200 },
  )) as unknown as typeof fetch;
const wikipedia = () =>
  new WikipediaAdapter("2025 Six Kings Slam", "test (ops@example.test)", fakeFetch);

let db: PGlite;
const at = (iso: string) => db.query("select public.dev_set_now($1)", [iso]);
const poll = async () =>
  Object.fromEntries((await pollAsService(db, wikipedia())).map((o) => [o.match_no, o.outcome]));
const match = async (n: number) =>
  (
    await db.query<{
      status: string;
      p1_id: string;
      p2_id: string;
      winner_id: string;
      set_scores: unknown;
    }>(
      "select status, p1_id, p2_id, winner_id, set_scores from public.matches where match_no = $1",
      [n],
    )
  ).rows[0]!;

beforeAll(async () => {
  db = await bootDb();
  await at("2026-10-20 12:00+00");
  await db.exec(`
    set role service_role;
    select public.set_players(
      '[{"id":"alcaraz","name":"Carlos Alcaraz","rank":1},{"id":"sinner","name":"Jannik Sinner","rank":2},
        {"id":"djokovic","name":"Novak Djokovic","rank":4},{"id":"zverev","name":"Alexander Zverev","rank":3},
        {"id":"fritz","name":"Taylor Fritz","rank":5},{"id":"tsitsipas","name":"Stefanos Tsitsipas","rank":20}]',
      '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"fritz"},"p2":{"type":"player","id":"zverev"}},
        {"match_no":2,"round":"QF","p1":{"type":"player","id":"tsitsipas"},"p2":{"type":"player","id":"sinner"}},
        {"match_no":3,"round":"SF","p1":{"type":"player","id":"alcaraz"},"p2":{"type":"winner","match":1}},
        {"match_no":4,"round":"SF","p1":{"type":"winner","match":2},"p2":{"type":"player","id":"djokovic"}},
        {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},"p2":{"type":"loser","match":4}},
        {"match_no":6,"round":"F","p1":{"type":"winner","match":3},"p2":{"type":"winner","match":4}}]');
    select public.set_match_start(1, '2026-10-21 16:30+00'), public.set_match_start(2, '2026-10-21 17:40+00'),
           public.set_match_start(3, '2026-10-22 16:30+00'), public.set_match_start(4, '2026-10-22 18:20+00'),
           public.set_match_start(5, '2026-10-24 16:30+00'), public.set_match_start(6, '2026-10-24 18:40+00');
    reset role;
    insert into public.provider_map (provider, kind, provider_ref, our_ref) values
      ('wikipedia','match','RD1:3-4','1'), ('wikipedia','match','RD1:5-6','2'),
      ('wikipedia','match','RD2:1-2','3'), ('wikipedia','match','RD2:3-4','4'),
      ('wikipedia','match','3rd:1-2','5'), ('wikipedia','match','RD3:1-2','6'),
      ('wikipedia','player','Carlos Alcaraz','alcaraz'), ('wikipedia','player','Jannik Sinner','sinner'),
      ('wikipedia','player','Novak Djokovic','djokovic'), ('wikipedia','player','Alexander Zverev','zverev'),
      ('wikipedia','player','Taylor Fritz','fritz'), ('wikipedia','player','Stefanos Tsitsipas','tsitsipas');`);
});
afterAll(async () => {
  await db.close();
});

describe("the 2025 page, replayed", () => {
  it("before the start, a final result on the page is refused (picks are still open)", async () => {
    await at("2026-10-21 16:20+00");
    expect((await poll())[1]).toBe("rejected_invalid");
  });

  it("night 1: the first readings wait, 11 minutes later both quarter-finals settle", async () => {
    await at("2026-10-21 20:00+00");
    expect(await poll()).toEqual({ 1: "awaiting_stability", 2: "awaiting_stability" });
    await at("2026-10-21 20:05+00");
    expect(await poll()).toEqual({ 1: "awaiting_stability", 2: "awaiting_stability" });
    await at("2026-10-21 20:11+00");
    expect(await poll()).toEqual({ 1: "settled", 2: "settled" });
    expect(await match(1)).toMatchObject({ status: "completed", winner_id: "fritz" });
    // the page lists Tsitsipas first; our match too — Sinner won 6-2 6-3
    expect((await match(2)).set_scores).toEqual([
      { p1_games: 2, p2_games: 6 },
      { p1_games: 3, p2_games: 6 },
    ]);
  });

  it("the semi-finals open with the winners; settled matches stay watched (unchanged)", async () => {
    expect(await match(3)).toMatchObject({ p1_id: "alcaraz", p2_id: "fritz" });
    expect(await match(4)).toMatchObject({ p1_id: "sinner", p2_id: "djokovic" });
    await at("2026-10-21 20:20+00");
    expect(await poll()).toEqual({ 1: "unchanged", 2: "unchanged" });
  });

  it("nights 2 and 3: everything settles; the page's player order is mapped to ours", async () => {
    await at("2026-10-22 21:00+00");
    await poll();
    await at("2026-10-22 21:11+00");
    expect(await poll()).toMatchObject({ 3: "settled", 4: "settled" });
    await at("2026-10-24 21:00+00");
    await poll();
    await at("2026-10-24 21:11+00");
    expect(await poll()).toMatchObject({ 5: "settled", 6: "settled" });
    expect(await match(5)).toMatchObject({
      status: "retired",
      p1_id: "fritz",
      p2_id: "djokovic",
      winner_id: "fritz",
    });
    expect(await match(6)).toMatchObject({
      status: "completed",
      p1_id: "alcaraz",
      p2_id: "sinner",
      winner_id: "sinner",
    });
  });

  it("every settlement points at the page revision that produced it", async () => {
    const rows = (
      await db.query<{ revid: string; lines: number }>(
        "select raw->>'revid' as revid, jsonb_array_length(raw->'lines') as lines from public.result_log where outcome = 'settled'",
      )
    ).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.revid).toBe("1377220243");
      expect(r.lines).toBeGreaterThan(4);
    }
  });
});
