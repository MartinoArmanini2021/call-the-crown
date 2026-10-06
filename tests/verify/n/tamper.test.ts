// Section N4: tampered save_pick calls made directly as a signed-in fan (role authenticated + JWT claims,
// what PostgREST does), bypassing the app's own checks. PGlite.
//   bun test tests/verify/n/tamper.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { at, boot, inTx, one, rawPick, type Db } from "./_pglite";

let db: Db;
beforeAll(async () => {
  db = await boot();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const S = (o: unknown) => `'${JSON.stringify(o)}'::jsonb`;
const set = (a: number, b: number) => ({ p1_games: a, p2_games: b });

// Each case: [name, args, expected error]. Match 1 = C (p1) v F (p2), open at 20 Oct 12:00.
const cases: [string, string, string][] = [
  ["winner not in the match", `1, 'a', 2, ${S([set(6, 4), set(6, 4)])}`, "winner_not_in_match"],
  [
    "winner that is no player at all",
    `1, 'zzz', 2, ${S([set(6, 4), set(6, 4)])}`,
    "winner_not_in_match",
  ],
  ["null winner", `1, null, 2, ${S([set(6, 4), set(6, 4)])}`, "winner_not_in_match"],
  ["sets = 3 with 2 scores", `1, 'c', 3, ${S([set(6, 4), set(6, 4)])}`, "set_scores_incomplete"],
  [
    "sets = 2 with 3 scores",
    `1, 'c', 2, ${S([set(6, 4), set(4, 6), set(6, 4)])}`,
    "set_scores_incomplete",
  ],
  [
    "third set after 2-0",
    `1, 'c', 3, ${S([set(6, 4), set(6, 4), set(6, 4)])}`,
    "third_set_after_two_nil",
  ],
  [
    "loser wins two sets (2 sets)",
    `1, 'c', 2, ${S([set(4, 6), set(4, 6)])}`,
    "winner_must_win_two_sets",
  ],
  [
    "loser wins sets 2 and 3",
    `1, 'c', 3, ${S([set(6, 4), set(4, 6), set(4, 6)])}`,
    "winner_must_win_two_sets",
  ],
  [
    "loser wins sets 1 and 2 (3 listed)",
    `1, 'c', 3, ${S([set(4, 6), set(4, 6), set(6, 4)])}`,
    "third_set_after_two_nil",
  ],
  [
    "string games",
    `1, 'c', 2, '[{"p1_games":"6","p2_games":4},{"p1_games":6,"p2_games":4}]'::jsonb`,
    "set_scores_incomplete",
  ],
  [
    "boolean games",
    `1, 'c', 2, '[{"p1_games":true,"p2_games":4},{"p1_games":6,"p2_games":4}]'::jsonb`,
    "set_scores_incomplete",
  ],
  [
    "null games",
    `1, 'c', 2, '[{"p1_games":null,"p2_games":4},{"p1_games":6,"p2_games":4}]'::jsonb`,
    "set_scores_incomplete",
  ],
  [
    "missing key",
    `1, 'c', 2, '[{"p1_games":6},{"p1_games":6,"p2_games":4}]'::jsonb`,
    "set_scores_incomplete",
  ],
  ["array instead of object", `1, 'c', 2, '[[6,4],[6,4]]'::jsonb`, "set_scores_incomplete"],
  [
    "object instead of array",
    `1, 'c', 2, '{"0":{"p1_games":6,"p2_games":4}}'::jsonb`,
    "set_scores_required",
  ],
  ["string instead of array", `1, 'c', 2, '"6-4 6-4"'::jsonb`, "set_scores_required"],
  ["null set_scores", `1, 'c', 2, null`, "set_scores_required"],
  ["null sets", `1, 'c', null, ${S([set(6, 4), set(6, 4)])}`, "sets_must_be_2_or_3"],
  ["sets = 1", `1, 'c', 1, ${S([set(6, 4)])}`, "sets_must_be_2_or_3"],
  [
    "sets = 5",
    `1, 'c', 5, ${S([set(6, 4), set(6, 4), set(6, 4), set(6, 4), set(6, 4)])}`,
    "sets_must_be_2_or_3",
  ],
  ["fractional games 6.5-4", `1, 'c', 2, ${S([set(6.5, 4), set(6, 4)])}`, "illegal_set_score"],
  ["7-7", `1, 'c', 2, ${S([set(7, 7), set(6, 4)])}`, "illegal_set_score"],
  ["6-5", `1, 'c', 2, ${S([set(6, 5), set(6, 4)])}`, "illegal_set_score"],
  ["8-6 (no advantage set)", `1, 'c', 2, ${S([set(8, 6), set(6, 4)])}`, "illegal_set_score"],
  ["negative games", `1, 'c', 2, ${S([set(6, -4), set(6, 4)])}`, "illegal_set_score"],
  [
    "1e309-style huge number",
    `1, 'c', 2, '[{"p1_games":1e300,"p2_games":4},{"p1_games":6,"p2_games":4}]'::jsonb`,
    "illegal_set_score",
  ],
  [
    "players not known yet (SF1: A v winner QF1)",
    `3, 'a', 2, ${S([set(6, 4), set(6, 4)])}`,
    "players_unknown",
  ],
  ["no such match", `99, 'c', 2, ${S([set(6, 4), set(6, 4)])}`, "no_such_match"],
  ["null match", `null, 'c', 2, ${S([set(6, 4), set(6, 4)])}`, "no_such_match"],
];

describe("N4 tampered save_pick as a signed-in fan", () => {
  for (const [name, args, code] of cases) {
    test(`${name} → ${code}, nothing written`, () =>
      inTx(db, async () => {
        await db.exec("select t.new_user(1)");
        await at(db, "2026-10-20 12:00+00");
        expect(await rawPick(db, 1, args)).toBe(code);
        expect(await one(db, "select count(*)::int from picks")).toBe(0);
        expect(await one(db, "select count(*)::int from activity_days")).toBe(0);
      }));
  }

  test("6.0 is accepted and stored canonically as 6; extra keys are dropped", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-20 12:00+00");
      expect(
        await rawPick(
          db,
          1,
          `1, 'c', 2, '[{"p1_games":6.0,"p2_games":4,"user_id":"x","pts_total":99},{"p1_games":6,"p2_games":4}]'::jsonb`,
        ),
      ).toBeNull();
      expect(await one(db, "select set_scores::text from picks")).toBe(
        '[{"p1_games": 6, "p2_games": 4}, {"p1_games": 6, "p2_games": 4}]',
      );
    }));

  test("oversized payload: 10,000 set entries and a ~1 MB array are refused before any loop", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-20 12:00+00");
      const big = JSON.stringify(Array.from({ length: 10_000 }, () => set(6, 4)));
      const t0 = performance.now();
      expect(await rawPick(db, 1, `1, 'c', 2, '${big}'::jsonb`)).toBe("set_scores_incomplete");
      const huge = JSON.stringify(Array.from({ length: 40_000 }, () => set(6, 4))); // ~1.2 MB
      expect(huge.length).toBeGreaterThan(1_000_000);
      expect(await rawPick(db, 1, `1, 'c', 2, '${huge}'::jsonb`)).toBe("set_scores_incomplete");
      // a 1 MB string inside a valid-length array
      const pad = "x".repeat(1_000_000);
      expect(
        await rawPick(
          db,
          1,
          `1, 'c', 2, '[{"p1_games":6,"p2_games":4,"pad":"${pad}"},{"p1_games":6,"p2_games":4}]'::jsonb`,
        ),
      ).toBeNull();
      expect(await one(db, "select length(set_scores::text) < 100 from picks")).toBe(true);
      expect(performance.now() - t0).toBeLessThan(10_000);
    }));

  test("a fan cannot write picks directly (no INSERT/UPDATE/DELETE grant) or act for another user", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1); select t.new_user(2)");
      await at(db, "2026-10-20 12:00+00");
      expect(await rawPick(db, 2, `1, 'c', 2, ${S([set(6, 4), set(6, 4)])}`)).toBeNull();
      await db.exec("select t.as_user(t.uid(1))");
      const r = await one<Record<string, string>>(
        db,
        `select json_build_object(
          'ins', t.err($$insert into picks (user_id, match_no, winner_id, sets, set_scores) values (t.uid(1), 1, 'c', 2, '[]')$$),
          'upd', t.err($$update picks set winner_id = 'f' where user_id = t.uid(2)$$),
          'upd_score', t.err($$update picks set pts_total = 999 where user_id = t.uid(1)$$),
          'del', t.err($$delete from picks where user_id = t.uid(2)$$),
          'see_other', (select count(*) from picks where user_id = t.uid(2))::text)`,
      );
      await db.exec("select t.as_owner()");
      expect(r.ins).toContain("permission denied");
      expect(r.upd).toContain("permission denied");
      expect(r.upd_score).toContain("permission denied");
      expect(r.del).toContain("permission denied");
      expect(r.see_other).toBe("0"); // another fan's pick is invisible before the start
      expect(await one(db, "select winner_id from picks where user_id = t.uid(2)")).toBe("c");
    }));

  test("anon cannot call save_pick", () =>
    inTx(db, async () => {
      await at(db, "2026-10-20 12:00+00");
      await db.exec("select t.as_anon()");
      const e = await one<string>(db, `select t.err($$select save_pick(1, 'c', 2, '[]'::jsonb)$$)`);
      await db.exec("select t.as_owner()");
      expect(e).toContain("permission denied");
    }));

  test("signed-in role with no sub claim → not_signed_in", () =>
    inTx(db, async () => {
      await at(db, "2026-10-20 12:00+00");
      await db.exec(
        `select set_config('request.jwt.claims', '{"role":"authenticated"}', true); set local role authenticated`,
      );
      const e = await one<string>(db, `select t.err($$select save_pick(1, 'c', 2, '[]'::jsonb)$$)`);
      await db.exec("select t.as_owner()");
      expect(e).toBe("not_signed_in");
    }));

  test("a settled match refuses picks even if its start were moved (status check)", () =>
    inTx(db, async () => {
      await db.exec("select t.new_user(1)");
      await at(db, "2026-10-21 18:00+00");
      await db.exec("select t.feed(1, 'completed', 'c', '6-4 6-4')");
      expect(await rawPick(db, 1, `1, 'c', 2, ${S([set(6, 4), set(6, 4)])}`)).toBe("locked");
    }));
});
