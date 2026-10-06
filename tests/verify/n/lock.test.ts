// Section N1 + N3 (+ old-audit leads F-03, F-04, F-06): when a pick locks, and what survives when the
// start moves. PGlite, simulated clock (dev_set_now is fine here: private database).
//   bun test tests/verify/n/lock.test.ts
// Tests whose name starts with "BUG" FAIL today on purpose: they state the expected behaviour.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { at, boot, inTx, one, pick, pts, q, type Db } from "./_pglite";

let db: Db;
beforeAll(async () => {
  db = await boot();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

// Match 1 (QF): C (rank 3) v F (rank 10), scheduled 21 Oct 16:30 UTC.
const START = "2026-10-21 16:30:00+00";

describe("N1 server lock at the scheduled start", () => {
  test("1 s before the start: accepted", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 16:29:59+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBeNull();
    }));
  test("1 µs before the start: accepted (lock is v_now >= starts_at, no off-by-one)", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 16:29:59.999999+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBeNull();
    }));
  test("exactly at the start second: locked", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, START);
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBe("locked");
    }));
  test("1 s after the start: locked, and an existing pick cannot be changed", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 16:00+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBeNull();
      await at(db, "2026-10-21 16:30:01+00");
      expect(await pick(db, 1, 1, "f", "6-4 6-4")).toBe("locked");
      expect(
        await one(db, "select winner_id from picks where user_id = t.uid(1) and match_no = 1"),
      ).toBe("c");
    }));
  test("client and server agree on the boundary (client: starts_at <= now → locked)", async () => {
    const { matchState } = await import("../../../src/lib/format");
    const m = {
      status: "scheduled",
      p1_id: "c",
      p2_id: "f",
      starts_at: "2026-10-21T16:30:00Z",
    } as never;
    const t0 = Date.parse("2026-10-21T16:30:00Z");
    expect(matchState(m, t0 - 1000)).toBe("open");
    expect(matchState(m, t0)).toBe("locked");
    expect(matchState(m, t0 + 1000)).toBe("locked");
  });
  test("save_pick takes no time from the client: updated_at is the server's app_now()", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 15:00+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBeNull();
      expect(
        await one(
          db,
          "select updated_at = app_now() from picks where user_id = t.uid(1) and match_no = 1",
        ),
      ).toBe(true);
    }));
});

describe("N3 moving the start earlier after picks exist", () => {
  test("set_match_start earlier: picks lock at the new start; earlier picks kept", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1); select t.new_user(2)");
      await at(db, "2026-10-20 12:00+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBeNull();
      await db.exec(
        "select t.as_service(); select set_match_start(1, '2026-10-20 13:00+00'); select t.as_owner()",
      );
      await at(db, "2026-10-20 12:59:59+00");
      expect(await pick(db, 2, 1, "c", "6-3 6-3")).toBeNull();
      await at(db, "2026-10-20 13:00:00+00");
      expect(await pick(db, 2, 1, "f", "6-3 6-3")).toBe("locked");
      expect(await pick(db, 1, 1, "f", "6-3 6-3")).toBe("locked");
      expect(await one(db, "select count(*)::int from picks where match_no = 1")).toBe(2);
    }));
  test("set_match_start refuses a past time and a started match", () =>
    inTx(db, async () => {
      await at(db, "2026-10-21 16:30:00+00");
      const r = await q(
        db,
        `select t.as_service();
        select t.err($$select set_match_start(2, '2026-10-21 16:29+00')$$) as past,
               t.err($$select set_match_start(1, '2026-10-22 16:29+00')$$) as started`,
      );
      expect(r[0]).toEqual({ past: "start_must_be_future", started: "match_started" });
      await db.exec("select t.as_owner()");
    }));
  test("lock_match_now closes picks in the same instant (v_now = starts_at → locked)", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 15:00+00");
      await db.exec("select t.as_service(); select lock_match_now(1); select t.as_owner()");
      expect(await one(db, "select starts_at = app_now() from matches where match_no = 1")).toBe(
        true,
      );
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBe("locked");
      await at(db, "2026-10-21 15:00:01+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBe("locked");
    }));
  test("lock_match_now is service-role only (a fan cannot lock a match)", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1); select t.as_user(t.uid(1))");
      const e = await one<string>(db, "select t.err('select lock_match_now(1)')");
      await db.exec("select t.as_owner()");
      expect(e).toContain("permission denied");
    }));
});

describe("F-03 early real start: 0018 voids picks saved after the provider's first in-play reading", () => {
  test("starts 30 min early, inside the poll window: the pick saved during play scores 0 (fixed)", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1); select t.new_user(2)");
      await at(db, "2026-10-21 15:00+00");
      expect(await pick(db, 1, 1, "c", "6-4 6-4")).toBeNull(); // before the real start
      await at(db, "2026-10-21 16:00:30+00");
      const live = await one<{ outcome: string }>(db, "select t.feed(1, 'live', 'c', '3-1')");
      expect(live.outcome).toBe("not_final");
      expect(
        await one(
          db,
          "select count(*)::int from ops_alerts where kind = 'started_before_schedule'",
        ),
      ).toBe(1);
      await at(db, "2026-10-21 16:10+00");
      expect(await pick(db, 2, 1, "c", "6-4 6-4")).toBeNull(); // still open: accepted
      await at(db, "2026-10-21 16:15+00");
      await db.exec("select t.as_service(); select lock_match_now(1); select t.as_owner()");
      await at(db, "2026-10-21 17:20+00");
      expect(
        (await one<{ outcome: string }>(db, "select t.feed(1, 'completed', 'c', '6-4 6-4')"))
          .outcome,
      ).toBe("settled");
      expect(await pts(db, 1, 1)).toBe("8/4/4/16");
      expect(await pts(db, 2, 1)).toBe("0/0/0/0");
    }));

  // Real start 13:30 (schedule typed 3 h late, the old report's Riyadh-vs-UTC case). The poller only
  // reads a match from 60 min before its scheduled start (supabase/functions/poll-results/due.ts), so
  // its first reading is at 15:30, when the match is already over. That reading is refused
  // ("final result before the scheduled start") and real_start() ignores refused readings, so after
  // lock_match_now the first accepted reading is the settling one: nothing is void, and a fan who picked
  // at 15:35 with the final score already public scores full points.
  test("F-03 residue (fixed by 0048): a pick saved after the result was already read scores nothing once the operator locked early", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1); select t.new_user(2)");
      await at(db, "2026-10-21 15:30+00");
      const first = await one<{ outcome: string; reason: string }>(
        db,
        "select t.feed(1, 'completed', 'c', '6-4 6-4')",
      );
      expect(first.outcome).toBe("rejected_invalid");
      expect(first.reason).toBe("final result before the scheduled start");
      await at(db, "2026-10-21 15:35+00");
      expect(await pick(db, 2, 1, "c", "6-4 6-4")).toBeNull(); // the result is public; picks still open
      await at(db, "2026-10-21 15:40+00");
      await db.exec("select t.as_service(); select lock_match_now(1); select t.as_owner()");
      await at(db, "2026-10-21 15:41+00");
      expect(
        (await one<{ outcome: string }>(db, "select t.feed(1, 'completed', 'c', '6-4 6-4')"))
          .outcome,
      ).toBe("settled");
      // Expected: the match was provably under way by 15:30 (the provider showed a final), so the 15:35
      // pick is void. Today: started_at is null (the settling reading is logged after score_match runs, and
      // the refused 15:30 reading is ignored), so nothing is void and the pick scores 8/4/4/16.
      expect(await pts(db, 2, 1)).toBe("0/0/0/0"); // today: "8/4/4/16"
      expect(await one(db, "select started_at from matches where match_no = 1")).toEqual(
        new Date("2026-10-21T15:30:00Z"),
      );
    }));
});

describe("F-06 walkover announced before the start", () => {
  test("the provider's walkover before the start raises the alert and is refused until locked (mitigated)", () =>
    inTx(db, async () => {
      await at(db, "2026-10-21 12:00+00");
      const r = await one<{ outcome: string }>(db, "select t.feed(1, 'walkover', 'c', '')");
      expect(r.outcome).toBe("rejected_invalid");
      expect(
        await one(
          db,
          "select count(*)::int from ops_alerts where kind = 'started_before_schedule'",
        ),
      ).toBe(1);
    }));
  // 0018: "A walkover has no in-play reading: nothing is void." Decision 7a (Tino, 6 Oct 2026): the
  // operator locks the match as soon as the walkover is announced (runbook); picks saved before the
  // lock count. This test keeps the old timing (the lock an hour after the news) to show what an operator
  // delay costs: the pick made in that hour scores. supabase/tests/walkover_announced.sql is the rule.
  test("F-06, decision 7a: a pick saved in the hour before the operator's lock still scores (so lock at once)", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 12:00+00");
      await db.exec("select t.feed(1, 'walkover', 'f', '')"); // F advances, announced 12:00
      await at(db, "2026-10-21 12:30+00");
      expect(await pick(db, 1, 1, "f", "4-6 4-6")).toBeNull(); // accepted after the news
      await at(db, "2026-10-21 13:00+00");
      await db.exec("select t.as_service(); select lock_match_now(1); select t.as_owner()");
      await at(db, "2026-10-21 13:01+00");
      expect(
        (await one<{ outcome: string }>(db, "select t.feed(1, 'walkover', 'f', '')")).outcome,
      ).toBe("settled");
      expect(await pts(db, 1, 1)).toBe("10/0/0/10"); // counts: the lock came an hour after the news
    }));
});

describe("F-04 substituting a withdrawn player once picks exist", () => {
  // Tino, 5 Oct 2026: "no withdrawals conceived", so no substitution procedure is built (README,
  // decisions). This pins today's behaviour: once picks exist the players are frozen.
  test("F-04, decided won't-build: once any pick exists the players are frozen", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-20 12:00+00");
      expect(await pick(db, 1, 2, "d", "6-4 6-4")).toBeNull();
      // F withdraws; G replaces F in QF1. set_players is the only path that sets players.
      const e = await one<string | null>(
        db,
        `select t.as_service();
         select t.err($$select set_players('[{"id":"a","name":"Player A","seed":1,"rank":1},{"id":"b","name":"Player B","seed":2,"rank":2},
           {"id":"c","name":"Player C","seed":3,"rank":3},{"id":"d","name":"Player D","seed":4,"rank":5},
           {"id":"e","name":"Player E","seed":5,"rank":7},{"id":"g","name":"Player G","seed":6,"rank":12}]',
           '[{"match_no":1,"round":"QF","p1":{"type":"player","id":"c"},"p2":{"type":"player","id":"g"}},
             {"match_no":2,"round":"QF","p1":{"type":"player","id":"d"},"p2":{"type":"player","id":"e"}},
             {"match_no":3,"round":"SF","p1":{"type":"player","id":"a"},"p2":{"type":"winner","match":1}},
             {"match_no":4,"round":"SF","p1":{"type":"player","id":"b"},"p2":{"type":"winner","match":2}},
             {"match_no":5,"round":"3P","p1":{"type":"loser","match":3},"p2":{"type":"loser","match":4}},
             {"match_no":6,"round":"F","p1":{"type":"winner","match":3},"p2":{"type":"winner","match":4}}]')$$)`,
      );
      // reseat_paused_match only works on a match paused by a corrected result:
      const r = await one<string | null>(db, "select t.err('select reseat_paused_match(1)')");
      await db.exec("select t.as_owner()");
      expect(r).toBe("not_paused");
      expect(e).toMatch(/picks_exist_(bracket|players)_frozen/);
    }));
});
