// Section N5: How to play says "If you said 2 sets and the match goes to 3, sets 1 and 2 can still be
// exactly right." Checked against score_match (0018) with every legal 2-set pick for the winner. PGlite.
//   bun test tests/verify/n/two-on-three.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { at, boot, inTx, one, pts, q, type Db } from "./_pglite";

let db: Db;
beforeAll(async () => {
  db = await boot();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const LEGAL = ["6-0", "6-1", "6-2", "6-3", "6-4", "7-5", "7-6"];
const flip = (s: string) => s.split("-").reverse().join("-");

/** Users 1..49 each pick C (p1 of match 1) with one of the 49 legal 2-set scores. */
async function allTwoSetPicks() {
  let n = 0;
  const sql: string[] = [];
  for (const a of LEGAL)
    for (const b of LEGAL) {
      n++;
      sql.push(`select t.new_user(${n}); select t.pick(t.uid(${n}), 1, 'c', '${a} ${b}');`);
    }
  await db.exec(sql.join("\n"));
  expect(await one(db, "select count(*)::int from picks where match_no = 1")).toBe(49);
}

describe("N5 picked 2 sets, the match went to 3", () => {
  test("set 1 exactly right still scores (C wins 6-4 4-6 6-3; pick 6-4 6-4 → 8/0/2/10)", () =>
    inTx(db, async () => {
      await at(db, "2026-10-20 12:00+00");
      await db.exec("select t.new_user(1); select t.pick(t.uid(1), 1, 'c', '6-4 6-4')");
      await at(db, "2026-10-21 18:30+00");
      await db.exec("select t.feed(1, 'completed', 'c', '6-4 4-6 6-3')");
      expect(await pts(db, 1, 1)).toBe("8/0/2/10");
      expect(await one(db, "select exact_flags::text from picks where user_id = t.uid(1)")).toBe(
        "{t,f,NULL}",
      );
    }));
  test("set 2 exactly right still scores (C wins 4-6 6-4 6-3; pick 6-3 6-4 → 8/0/2/10)", () =>
    inTx(db, async () => {
      await at(db, "2026-10-20 12:00+00");
      await db.exec("select t.new_user(1); select t.pick(t.uid(1), 1, 'c', '6-3 6-4')");
      await at(db, "2026-10-21 18:30+00");
      await db.exec("select t.feed(1, 'completed', 'c', '4-6 6-4 6-3')");
      expect(await pts(db, 1, 1)).toBe("8/0/2/10");
      expect(await one(db, "select exact_flags::text from picks where user_id = t.uid(1)")).toBe(
        "{f,t,NULL}",
      );
    }));
  // A 2-set pick has the winner taking sets 1 AND 2; a 3-set match has sets 1 and 2 split. So at most one
  // of them can match. The rule text reads as if both could be right: copy smell, scoring is consistent.
  for (const result of ["6-4 4-6 6-3", "4-6 6-4 7-6", "7-6 6-7 6-0"]) {
    test(`all 49 two-set picks vs ${result}: never both sets 1 and 2 exact (max exact_sets = 1)`, () =>
      inTx(db, async () => {
        await at(db, "2026-10-20 12:00+00");
        await allTwoSetPicks();
        await at(db, "2026-10-21 18:30+00");
        await db.exec(`select t.feed(1, 'completed', 'c', '${result}')`);
        const r = await q<{ mx: number; n1: number; pts_sets: number }>(
          db,
          `select max(exact_sets)::int as mx, count(*) filter (where exact_sets = 1)::int as n1,
                  max(pts_sets)::int as pts_sets from picks where match_no = 1`,
        );
        expect(r[0]).toEqual({ mx: 1, n1: 7, pts_sets: 0 });
      }));
  }
  test("the converse (picked 3 sets, went 2) also gives at most 1 exact set", () =>
    inTx(db, async () => {
      await at(db, "2026-10-20 12:00+00");
      let n = 0;
      const sql: string[] = [];
      for (const a of LEGAL)
        for (const b of LEGAL) {
          n++;
          sql.push(
            `select t.new_user(${n}); select t.pick(t.uid(${n}), 1, 'c', '${a} ${flip(b)} 6-4');`,
          );
          n++;
          sql.push(
            `select t.new_user(${n}); select t.pick(t.uid(${n}), 1, 'c', '${flip(a)} ${b} 6-4');`,
          );
        }
      await db.exec(sql.join("\n"));
      expect(await one(db, "select count(*)::int from picks")).toBe(98);
      await at(db, "2026-10-21 18:30+00");
      await db.exec("select t.feed(1, 'completed', 'c', '6-4 6-4')");
      expect(await one(db, "select max(exact_sets)::int from picks")).toBe(1);
    }));
});
