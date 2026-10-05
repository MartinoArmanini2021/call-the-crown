// M7 — mid-event sign-ups and deletions: rank_new_fan and close_rank_gap keep ranks dense and correct.
import { afterAll, describe, expect, it } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { drawNumber } from "../oracle";
import { boot, freshRecompute, ingest, one, payload, q, setNow, uid } from "./harness";

const dbs: PGlite[] = [];
afterAll(async () => {
  for (const d of dbs) await d.close();
});
const ranks = (db: PGlite) =>
  q<{ user_id: string; rank: number | null; points: number }>(
    db,
    "select user_id, rank, points from public.standings order by rank nulls last, user_id",
  );
const dense = (rs: { rank: number | null }[]) =>
  rs.every((r) => r.rank !== null) &&
  [...rs.map((r) => r.rank!)].sort((a, b) => a - b).every((r, i) => r === i + 1);

async function eventWithFirstResult(db: PGlite, users: number) {
  await db.query("select t.setup_event()");
  await db.query(`select t.new_user(n) from generate_series(1, ${users}) n`);
  await db.query("select t.pick(t.uid(1), 1, 'c', '6-4 6-4')"); // fan 1 scores; the rest have 0
  await setNow(db, "2026-10-21 20:00+00");
  expect(
    (
      await ingest(
        db,
        payload(
          1,
          "c",
          "f",
          "completed",
          1,
          [
            [6, 4],
            [6, 4],
          ],
          false,
        ),
      )
    ).outcome,
  ).toBe("settled");
}

describe("M7 mid-event ranks", () => {
  it("before any result a new fan has no rank; after one, sign-ups take the next places and deletions close the gap (dense 1..n)", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(1)");
    expect((await ranks(db))[0]!.rank).toBeNull();
    await db.query("select t.new_user(n) from generate_series(2, 20) n");
    await db.query("select t.pick(t.uid(1), 1, 'c', '6-4 6-4')");
    await setNow(db, "2026-10-21 20:00+00");
    await ingest(
      db,
      payload(
        1,
        "c",
        "f",
        "completed",
        1,
        [
          [6, 4],
          [6, 4],
        ],
        false,
      ),
    );
    expect(dense(await ranks(db))).toBe(true);
    for (const n of [21, 22, 23]) {
      await db.query("select t.new_user($1)", [n]);
      const r = await ranks(db);
      expect(r.find((x) => x.user_id === uid(n))!.rank).not.toBeNull(); // today: n (last); see the SMELL test
      expect(dense(r)).toBe(true);
    }
    // one deletion (the delete_account path: auth.users → cascade)
    await db.query("delete from auth.users where id = $1", [uid(5)]);
    expect(dense(await ranks(db))).toBe(true);
    await db.query("delete from auth.users where id = $1", [uid(12)]);
    // and a sign-up after deletions
    await db.query("select t.new_user(30)");
    const r = await ranks(db);
    expect(dense(r)).toBe(true);
    // the relative order is still the rules' order (new fans last): a fresh recompute agrees except
    // for fans who joined after the result (see the SMELL test below)
  }, 120_000);

  it("BUG (fails today): deleting several accounts in ONE statement (auth.users, e.g. an operator purging test accounts) leaves duplicate and missing ranks", async () => {
    const db = await boot();
    dbs.push(db);
    await eventWithFirstResult(db, 20);
    // Two accounts, the one created first ranked higher (smaller rank) and not adjacent: the cascade
    // fires the gap-closing trigger in creation order, smaller rank first, with the ranks as they were.
    const r0 = await ranks(db);
    const rk = (n: number) => r0.find((x) => x.user_id === uid(n))!.rank!;
    let pair: [number, number] | null = null;
    for (let x = 2; x <= 20 && !pair; x++)
      for (let y = x + 1; y <= 20 && !pair; y++) if (rk(x) + 1 < rk(y) && rk(y) < 20) pair = [x, y]; // not adjacent, and someone ranked below both
    await db.query("delete from auth.users where id = any($1::uuid[])", [
      [uid(pair![0]), uid(pair![1])],
    ]);
    const r2 = await ranks(db);
    console.log(
      JSON.stringify({
        section: "M7.1b",
        deleted: pair!.map((n) => ({ fan: n, rank: rk(n) })),
        afterBulkAuthDelete: r2.map((x) => x.rank),
      }),
    );
    expect(dense(r2)).toBe(true);
  }, 120_000);

  it("BUG (fails today, same root cause): several standings rows deleted in ONE statement leave duplicate ranks (close_rank_gap is order-dependent)", async () => {
    const db = await boot();
    dbs.push(db);
    await eventWithFirstResult(db, 10);
    const r0 = await ranks(db);
    // two rows deleted together in one statement on standings: the one stored first ranked higher, not
    // adjacent, someone ranked below both (the row triggers then fire smaller rank first)
    const rk = (n: number) => r0.find((x) => x.user_id === uid(n))!.rank!;
    let pair: [number, number] | null = null;
    for (let x = 2; x <= 10 && !pair; x++)
      for (let y = x + 1; y <= 10 && !pair; y++) if (rk(x) + 1 < rk(y) && rk(y) < 10) pair = [x, y];
    const victims = pair!.map(uid);
    await db.query("delete from public.standings where user_id = any($1::uuid[])", [victims]);
    const r1 = await ranks(db);
    console.log(
      JSON.stringify({
        section: "M7.2",
        before: r0.map((x) => x.rank),
        after: r1.map((x) => x.rank),
      }),
    );
    expect(dense(r1)).toBe(true);
  }, 120_000);

  it("SMELL (fails today): a fan who joins after the last result is ranked last, not where the published tiebreak order puts them", async () => {
    const db = await boot();
    dbs.push(db);
    await db.query("select t.setup_event()");
    await db.query("select t.new_user(n) from generate_series(1, 10) n");
    // A seed (set before play, allowed) under which the fan who joins later (no. 11) draws ahead of
    // every other 0-point fan: the rules then put them 2nd, right after fan 1.
    let seed = "";
    for (let i = 0; ; i++) {
      seed = `m7-seed-${i}`;
      const mine = drawNumber(seed, uid(11));
      if ([2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => mine < drawNumber(seed, uid(n)))) break;
    }
    await db.query("update public.event_config set tiebreak_seed = $1", [seed]);
    await db.query("select t.pick(t.uid(1), 1, 'c', '6-4 6-4')");
    await setNow(db, "2026-10-21 20:00+00");
    await ingest(
      db,
      payload(
        1,
        "c",
        "f",
        "completed",
        1,
        [
          [6, 4],
          [6, 4],
        ],
        false,
      ),
    );
    await db.query("select t.new_user(11)");
    const shown = (await ranks(db)).find((x) => x.user_id === uid(11))!.rank;
    await freshRecompute(db);
    const byRule = (await ranks(db)).find((x) => x.user_id === uid(11))!.rank;
    console.log(
      JSON.stringify({ section: "M7.3", seed, rankShown: shown, rankByTheRules: byRule }),
    );
    expect(shown).toBe(byRule);
  }, 120_000);
});

void one;
