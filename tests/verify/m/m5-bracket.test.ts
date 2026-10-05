// M5 — the bracket: advance_bracket routing, and what a CORRECTED quarter-final does to semi-final picks.
// The correction cases document behaviour (a rule question for Tino); they assert what the code does today
// so the report quotes measured facts, not the code comments.
import { afterAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { fillBracket, loadEventRules, winPoints } from "../oracle";
import {
  boot,
  ingest,
  matches,
  one,
  payload,
  q,
  savePicks,
  setNow,
  standings,
  uid,
} from "./harness";

const rules = loadEventRules();
const RANKS: Record<string, number> = { a: 1, b: 2, c: 3, d: 5, e: 7, f: 10 };
const dbs: PGlite[] = [];
afterAll(async () => {
  for (const d of dbs) await d.close();
});

const two = (w: 1 | 2) =>
  w === 1
    ? ([
        [6, 4],
        [6, 4],
      ] as [number, number][])
    : ([
        [4, 6],
        [4, 6],
      ] as [number, number][]);
async function settle(
  db: PGlite,
  m: number,
  winner: string,
  expectOutcome: string | null = "settled",
) {
  const x = (await matches(db)).find((y) => y.match_no === m)!;
  const slot = x.p1_id === winner ? 1 : 2;
  const out = await ingest(db, payload(m, x.p1_id!, x.p2_id!, "completed", slot, two(slot), false));
  if (expectOutcome !== null) expect(out.outcome).toBe(expectOutcome);
  return out;
}
const pickOn = (db: PGlite, u: number, m: number, w: string, slot: 1 | 2) =>
  savePicks(db, [
    {
      uid: uid(u),
      match: m,
      winner: w,
      sets: 2,
      scores: two(slot).map(([a, b]) => ({ p1_games: a, p2_games: b })),
    },
  ]);
const alerts = (db: PGlite) =>
  q<{ kind: string; detail: Record<string, unknown> }>(
    db,
    "select kind, detail from public.ops_alerts order by id",
  );

describe("M5 bracket", () => {
  it("every bracket outcome (16) routes QF winners to SF p2, SF losers to 3rd place, SF winners to the final", async () => {
    // Clock can move back in the simulated clock, but a settled SF cannot be un-settled, so each of the
    // 16 outcomes needs its own path: 4 databases × 4 SF outcomes (SF results re-settled before 3P/F).
    let checked = 0;
    for (const [w1, w2] of [
      ["c", "d"],
      ["c", "e"],
      ["f", "d"],
      ["f", "e"],
    ] as const) {
      const db = await boot();
      try {
        await db.query("select t.setup_event()");
        await setNow(db, "2026-10-21 20:00+00");
        await settle(db, 1, w1);
        await settle(db, 2, w2);
        await setNow(db, "2026-10-22 20:30+00");
        let first = true;
        for (const s1 of ["a", w1])
          for (const s2 of ["b", w2]) {
            await settle(db, 3, s1, first ? "settled" : null);
            await settle(db, 4, s2, first ? "settled" : null);
            first = false;
            const o = fillBracket(
              { sf1: "a", sf2: "b" },
              { qf1: ["c", "f"], qf2: ["d", "e"] },
              { 1: w1, 2: w2, 3: s1, 4: s2 },
            );
            for (const m of await matches(db)) {
              expect([m.match_no, m.p1_id, m.p2_id]).toEqual([
                m.match_no,
                o[m.match_no]!.p1,
                o[m.match_no]!.p2,
              ]);
              expect([m.p1_win_points, m.p2_win_points]).toEqual([
                winPoints(rules, m.round, RANKS[m.p1_id!]!, RANKS[m.p2_id!]!),
                winPoints(rules, m.round, RANKS[m.p2_id!]!, RANKS[m.p1_id!]!),
              ]);
              checked++;
            }
          }
      } finally {
        await db.close();
      }
    }
    expect(checked).toBe(16 * 6);
  }, 600_000);

  it("correction A: QF1 corrected BEFORE SF1 starts, SF1 picks on the removed player exist", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(n) from generate_series(1, 3) n");
    await setNow(db, "2026-10-21 20:00+00");
    await settle(db, 1, "c"); // provider first says C beat F
    await settle(db, 2, "d");
    // SF1 = A v C. Fan 1 backs C (who will be removed), fan 2 backs A, fan 3 backs C and also has an SF2 pick.
    await setNow(db, "2026-10-21 21:00+00");
    expect((await pickOn(db, 1, 3, "c", 2)).errors[0]).toBeNull();
    expect((await pickOn(db, 2, 3, "a", 1)).errors[0]).toBeNull();
    expect((await pickOn(db, 3, 3, "c", 2)).errors[0]).toBeNull();
    expect((await pickOn(db, 3, 4, "b", 1)).errors[0]).toBeNull();
    const before = (await matches(db)).find((m) => m.match_no === 3)!;
    // The provider corrects QF1 an hour later: F beat C (fixture provider: no stability wait).
    await setNow(db, "2026-10-21 22:00+00");
    const x = (await matches(db)).find((y) => y.match_no === 1)!;
    const out = await ingest(db, payload(1, x.p1_id!, x.p2_id!, "completed", 2, two(2), false));
    const after = (await matches(db)).find((m) => m.match_no === 3)!;
    const sfPicks = await q<{ user_id: string; winner_id: string }>(
      db,
      "select user_id, winner_id from public.picks where match_no = 3 order by user_id",
    );
    const al = await alerts(db);
    console.log(
      JSON.stringify({
        section: "M5.A",
        out,
        before: [before.p1_id, before.p2_id, before.p1_win_points, before.p2_win_points],
        after: [after.p1_id, after.p2_id, after.p1_win_points, after.p2_win_points],
        sfPicks,
        alerts: al,
      }),
    );
    expect(out.outcome).toBe("resettled");
    expect([after.p1_id, after.p2_id]).toEqual(["a", "f"]); // the slot is refilled
    expect([after.p1_win_points, after.p2_win_points]).toEqual([13, winPoints(rules, "SF", 10, 1)]); // 16
    expect(sfPicks.map((p) => p.user_id)).toEqual([uid(2)]); // fans 1 and 3: SF1 pick DELETED
    expect(
      await q(db, "select 1 from public.picks where user_id = $1 and match_no = 4", [uid(3)]),
    ).toHaveLength(1);
    expect(al.find((a) => a.kind === "bracket_refilled")?.detail["picks_dropped"]).toBe(2);
    // Nothing tells the fan: no row, no flag; the only trace is the operator alert.
    // The fans can pick again (SF1 has not started).
    expect((await pickOn(db, 1, 3, "f", 2)).errors[0]).toBeNull();
  }, 120_000);

  it("correction B: QF1 corrected AFTER SF1 started (not yet settled): SF1 paused, stuck until the operator reseats it", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(n) from generate_series(1, 2) n");
    await setNow(db, "2026-10-21 20:00+00");
    await settle(db, 1, "c");
    await settle(db, 2, "d");
    await setNow(db, "2026-10-21 21:00+00");
    await pickOn(db, 1, 3, "c", 2);
    await pickOn(db, 2, 3, "a", 1);
    await setNow(db, "2026-10-22 17:00+00"); // SF1 (16:30) under way
    const x = (await matches(db)).find((y) => y.match_no === 1)!;
    const out = await ingest(db, payload(1, x.p1_id!, x.p2_id!, "completed", 2, two(2), false));
    const sf1 = (await matches(db)).find((m) => m.match_no === 3)!;
    // The provider's SF1 (A v F) cannot settle: our SF1 still says A v C.
    await setNow(db, "2026-10-22 18:30+00");
    const sfFeed = await ingest(db, {
      match_ref: "fx-m3",
      status: "completed",
      players: ["fx-a", "fx-f"],
      winner: "fx-a",
      set_scores: [
        { p1_games: 6, p2_games: 4 },
        { p1_games: 6, p2_games: 4 },
      ],
    });
    // The operator reseats it; the provider's next reading settles it.
    const reseat = await one<{ e: string | null }>(
      db,
      "select mv.svc('select public.reseat_paused_match(3)') as e",
    );
    const sfFeed2 = await ingest(db, {
      match_ref: "fx-m3",
      status: "completed",
      players: ["fx-a", "fx-f"],
      winner: "fx-a",
      set_scores: [
        { p1_games: 6, p2_games: 4 },
        { p1_games: 6, p2_games: 4 },
      ],
    });
    const picks = await q<{ user_id: string; winner_id: string; pts_total: number | null }>(
      db,
      "select user_id, winner_id, pts_total from public.picks where match_no = 3 order by user_id",
    );
    const sf1b = (await matches(db)).find((m) => m.match_no === 3)!;
    console.log(
      JSON.stringify({
        section: "M5.B",
        out,
        pausedAfterCorrection: sf1.settlement_paused,
        playersAfterCorrection: [sf1.p1_id, sf1.p2_id],
        sfFeed,
        reseat,
        sfFeed2,
        after: [sf1b.p1_id, sf1b.p2_id, sf1b.status, sf1b.winner_id],
        picks,
        alerts: (await alerts(db)).map((a) => a.kind),
      }),
    );
    expect(sf1.settlement_paused).toBe(true);
    expect([sf1.p1_id, sf1.p2_id]).toEqual(["a", "c"]);
    expect(sfFeed.outcome).toBe("rejected_invalid");
    expect(reseat.e).toBeNull();
    expect(sfFeed2.outcome).toBe("settled");
    // Fan 1's pick on C stays and scores 0; fan 2's pick on A scores.
    expect(picks.map((p) => [p.winner_id, p.pts_total])).toEqual([
      ["c", 0],
      ["a", 23],
    ]); // 13 + 6 + 2·2
  }, 120_000);

  it("correction C: QF1 corrected AFTER SF1 was settled: SF1's result and points on the wrong player stand, the 3rd place gets the wrong player, nothing can reseat it", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(n) from generate_series(1, 2) n");
    await setNow(db, "2026-10-21 20:00+00");
    await settle(db, 1, "c");
    await settle(db, 2, "d");
    await setNow(db, "2026-10-21 21:00+00");
    await pickOn(db, 1, 3, "c", 2); // backs C; C "wins" SF1 below
    await pickOn(db, 2, 3, "a", 1);
    await setNow(db, "2026-10-22 20:30+00");
    await settle(db, 3, "c"); // provider: C beat A (C was never really in the semi-final, see below)
    await settle(db, 4, "b");
    const st0 = await standings(db);
    // The provider now corrects QF1: F beat C.
    const x = (await matches(db)).find((y) => y.match_no === 1)!;
    const out = await ingest(db, payload(1, x.p1_id!, x.p2_id!, "completed", 2, two(2), false));
    const ms = await matches(db);
    const reseat = await one<{ e: string | null }>(
      db,
      "select mv.svc('select public.reseat_paused_match(3)') as e",
    );
    const st1 = await standings(db);
    const p1 = await one<{ pts_total: number }>(
      db,
      "select pts_total from public.picks where user_id = $1 and match_no = 3",
      [uid(1)],
    );
    console.log(
      JSON.stringify({
        section: "M5.C",
        out,
        sf1: ms.find((m) => m.match_no === 3),
        third: ms.find((m) => m.match_no === 5),
        final: ms.find((m) => m.match_no === 6),
        reseat,
        fan1SfPoints: p1.pts_total,
        standingsBefore: st0.map((s) => [s.user_id.slice(-2), s.points, s.rank]),
        standingsAfter: st1.map((s) => [s.user_id.slice(-2), s.points, s.rank]),
        alerts: (await alerts(db)).map((a) => a.kind),
      }),
    );
    expect(out.outcome).toBe("resettled");
    const sf1 = ms.find((m) => m.match_no === 3)!;
    expect([sf1.p1_id, sf1.p2_id, sf1.status, sf1.settlement_paused]).toEqual([
      "a",
      "c",
      "completed",
      true,
    ]);
    expect(reseat.e).toContain("match_settled");
    expect(p1.pts_total).toBeGreaterThan(0); // points earned on a player who, per the corrected QF, lost
    expect(ms.find((m) => m.match_no === 6)!.p1_id).toBe("c"); // the final still has C
  }, 120_000);
});
