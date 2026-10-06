// Section N helpers: one fresh in-process database (PGlite, migrations + sim clock + event + _prelude)
// per test file; every test runs inside begin … rollback so tests do not see each other.
import type { PGlite } from "@electric-sql/pglite";
import { bootDb } from "../../../scripts/lib/db";

export type Db = PGlite;
import { proposedSql } from "./_proposed";
export async function boot() {
  const db = await bootDb({ prelude: true });
  for (const s of proposedSql()) await db.exec(s);
  return db;
}

/** Last result set of a multi-statement script. */
export async function q<T = Record<string, unknown>>(db: Db, sql: string): Promise<T[]> {
  const r = await db.exec(sql);
  return (r.at(-1)?.rows ?? []) as T[];
}
export async function one<T = unknown>(db: Db, sql: string): Promise<T> {
  const rows = await q<Record<string, T>>(db, sql);
  const row = rows[0];
  if (!row) throw new Error(`no row from: ${sql}`);
  return Object.values(row)[0] as T;
}
/** Run fn inside a transaction that is always rolled back; the standard event is set up first. */
export async function inTx(db: Db, fn: () => Promise<void>, setup = true): Promise<void> {
  await db.exec("begin");
  try {
    if (setup) await db.exec("select t.setup_event()");
    await fn();
  } finally {
    await db.exec("rollback");
  }
}
export const at = (db: Db, ts: string) => db.exec(`select public.dev_set_now('${ts}')`);
/** Save a pick through t.pick (as the fan, role authenticated); null on success, else the error code. */
export const pick = (db: Db, n: number, match: number, winner: string, sets: string) =>
  one<string | null>(db, `select t.pick(t.uid(${n}), ${match}, '${winner}', '${sets}')`);
/** Raw save_pick call as fan n with literal SQL arguments; null on success, else the error message. */
export async function rawPick(db: Db, n: number, args: string): Promise<string | null> {
  await db.exec(`select t.as_user(t.uid(${n}))`);
  try {
    return await one<string | null>(db, `select t.err($sql$select public.save_pick(${args})$sql$)`);
  } finally {
    await db.exec("select t.as_owner()");
  }
}
export const pts = (db: Db, n: number, match: number) =>
  one<string | null>(db, `select t.pts(t.uid(${n}), ${match})`);
