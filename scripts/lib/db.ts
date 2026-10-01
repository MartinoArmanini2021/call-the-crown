// A throwaway in-process Postgres (PGlite) with the whole schema applied: a stand-in for Supabase's
// auth/vault/cron, the migrations in order, the local simulated clock and the event file.
// Used by the SQL tests and the fixture replay. A real `supabase start` does not need any of this.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// PGlite has no extensions to create; the shim provides the cron and net functions instead.
const withoutExtensions = (sql: string) =>
  sql.replace(/^create extension[^;]*;/gim, "-- (extension provided by the test shim)");

export async function bootDb(opts: { prelude?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(read("supabase", "dev", "pglite_supabase_shim.sql"));
  const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    try {
      await db.exec(withoutExtensions(read("supabase", "migrations", file)));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
  }
  await db.exec(read("supabase", "dev", "sim_clock.sql"));
  await db.exec(read("supabase", "events", "sixkings_2026.sql"));
  if (opts.prelude) await db.exec(read("supabase", "tests", "_prelude.sql"));
  return db;
}
