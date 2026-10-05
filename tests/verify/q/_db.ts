// Section Q helpers (full-debug brief, Part 2). A private in-process PGlite database per test file:
// every migration, the local simulated clock, the event file and the test prelude (scripts/lib/db.ts).
// Never touches the shared local stack at 127.0.0.1:55322.
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "../../../scripts/lib/db";

export { ROOT };
export type Row = Record<string, unknown>;

export async function freshDb(): Promise<PGlite> {
  const db = await bootDb({ prelude: true });
  // Only for checking a proposed patch by hand: Q_EXTRA_SQL=path[;path] applies extra SQL after boot.
  for (const p of (process.env["Q_EXTRA_SQL"] ?? "").split(";").filter(Boolean)) {
    await db.exec(readFileSync(p, "utf8"));
  }
  return db;
}

/** Loads the real draw file (players, bracket, start times, provider_map) as the operator would. */
export async function loadRealDraw(db: PGlite, clock = "2026-10-10 12:00+00") {
  await db.query(`select public.dev_set_now($1::timestamptz)`, [clock]);
  await db.exec(readFileSync(join(ROOT, "supabase", "events", "sixkings_2026_draw.sql"), "utf8"));
}

/** Rows of the last statement, run in one transaction as the given caller, then rolled back. */
export async function as(
  db: PGlite,
  who: { uid: string } | "anon" | "service",
  sql: string,
): Promise<Row[]> {
  const become =
    who === "anon"
      ? "select t.as_anon();"
      : who === "service"
        ? "select t.as_service();"
        : `select t.as_user('${who.uid}'::uuid);`;
  const res = await db.exec(`begin; ${become} ${sql}; rollback;`);
  // [begin, become, ...sql statements, rollback]
  return (res[res.length - 2]?.rows ?? []) as Row[];
}

/** Like `as`, but keeps the caller's side effects (commit). */
export async function asCommit(db: PGlite, who: { uid: string }, sql: string): Promise<Row[]> {
  const res = await db.exec(`begin; select t.as_user('${who.uid}'::uuid); ${sql}; commit;`);
  return (res[res.length - 2]?.rows ?? []) as Row[];
}

export const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: callers compare with expect()
export type Val = any;
export async function one<T = Val>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, params);
  const row = r.rows[0];
  return (row ? Object.values(row)[0] : undefined) as T;
}
