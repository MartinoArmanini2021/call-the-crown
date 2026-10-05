// Section K tests on the in-process database (PGlite: a fresh private database per boot, nothing shared).
//   bun test tests/verify/k/k.test.ts
// - K3/K4/K5/K6/K2 lock-ins (k3-lockin.sql): PASS today; fail if a migration reopens anything.
// - K7 bug demonstration (k7-picks-leak.sql): the three "K7 BUG" checks FAIL today.
// - K7 proposed patch (tests/verify/proposed/k7-picks-own-rows.sql): applied after boot, the whole
//   supabase/tests suite (with the one inverted check from k7-security-sql.patch) and the leak file pass.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "../../../scripts/lib/db";

type Row = { name: string; result: string; detail: string | null };
const here = import.meta.dir;
const read = (...p: string[]) => readFileSync(join(...p), "utf8");

async function run(sqlText: string, patch?: string): Promise<Row[]> {
  const db = await bootDb({ prelude: true });
  try {
    if (patch) await db.exec(patch);
    const res = await db.exec(sqlText);
    return res
      .flatMap((r) => r.rows as Record<string, unknown>[])
      .filter((r) => "result" in r) as Row[];
  } finally {
    await db.close();
  }
}
const failing = (rows: Row[]) =>
  rows.filter((r) => r.result !== "PASS").map((r) => `${r.name} (${r.detail ?? ""})`);

describe("K lock-ins (pass today)", () => {
  test("K3/K4/K5/K6/K2: operator functions closed, default privileges closed, definers pinned, no write-through views, grants exact", async () => {
    const rows = await run(read(here, "k3-lockin.sql"));
    expect(rows.length).toBeGreaterThan(20);
    expect(failing(rows)).toEqual([]);
  }, 120_000);
});

describe("K7 picks policy", () => {
  test("K7 BUG (FAILS TODAY): a signed-in fan reads every pick of a started match across leagues", async () => {
    const rows = await run(read(here, "k7-picks-leak.sql"));
    expect(failing(rows)).toEqual([]);
  }, 120_000);

  const patch = read(ROOT, "tests", "verify", "proposed", "k7-picks-own-rows.sql");
  test("K7 patch: own-rows policy closes the leak and the app paths still work", async () => {
    const rows = await run(read(here, "k7-picks-leak.sql"), patch);
    expect(failing(rows)).toEqual([]);
  }, 120_000);

  const files = readdirSync(join(ROOT, "supabase", "tests"))
    .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
    .sort();
  for (const f of files)
    test(`K7 patch: supabase/tests/${f} still passes with the own-rows policy`, async () => {
      let text = read(ROOT, "supabase", "tests", f);
      if (f === "security.sql") {
        // the one check that asserted the leak, inverted (tests/verify/proposed/k7-security-sql.patch)
        const a =
          "select t.check('another fan''s pick is visible once the match has started',\n  (select count(*) from public.picks where user_id = t.uid(1) and match_no = 1) = 1);";
        expect(text.includes(a)).toBe(true);
        text = text.replace(
          a,
          "select t.check('another fan''s pick stays invisible after the match has started (K7: own rows only)',\n  (select count(*) from public.picks where user_id = t.uid(1) and match_no = 1) = 0);",
        );
      }
      const rows = await run(text, patch);
      expect(rows.length).toBeGreaterThan(0);
      expect(failing(rows)).toEqual([]);
    }, 180_000);
});
