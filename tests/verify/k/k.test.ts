// Section K tests on the in-process database (PGlite: a fresh private database per boot, nothing shared).
//   bun test tests/verify/k/k.test.ts
// - K3/K4/K5/K6/K2 lock-ins (k3-lockin.sql): PASS today; fail if a migration reopens anything.
// - K7 (k7-picks-leak.sql): failed on build/phase-1; passes since migration 0041_picks_own_rows (applied
//   on Tino's word, 6 Oct 2026). The supabase/tests suite runs with the policy in the gate.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb } from "../../../scripts/lib/db";

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
  test("K7 (fixed by 0041): a signed-in fan cannot read other fans' picks of a started match", async () => {
    const rows = await run(read(here, "k7-picks-leak.sql"));
    expect(failing(rows)).toEqual([]);
  }, 120_000);
});
