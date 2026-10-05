// A private, throwaway database on the local `supabase start` Postgres server (127.0.0.1:55322), for
// what PGlite cannot do: several connections at once. It gets the PGlite shim's auth/vault/cron/net
// stand-ins (roles are cluster-wide and already exist, so those lines are skipped), the migrations in
// order, the event file and the SQL test helpers (supabase/tests/_prelude.sql). No simulated clock:
// app_now() is the production now(), so tests move match times relative to now() instead.
// The local `postgres` database is never touched. Adapted from tests/verify/n/_pg.ts (audit, 5 Oct 2026).
import { SQL } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./db";

export const SERVER = "postgresql://postgres:postgres@127.0.0.1:55322";
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

export async function serverUp(): Promise<boolean> {
  const s = new SQL(`${SERVER}/postgres`, { max: 1, connectionTimeout: 3 });
  try {
    await s`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await s.close().catch(() => {});
  }
}

export async function createScratchDb(name: string, max: number): Promise<SQL> {
  if (!/^scratch_[a-z0-9_]+$/.test(name))
    throw new Error("scratch database names start with scratch_");
  const admin = new SQL(`${SERVER}/postgres`, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.close();
  }
  const setup = new SQL(`${SERVER}/${name}`, { max: 1 });
  try {
    await setup.unsafe(
      read("supabase", "dev", "pglite_supabase_shim.sql")
        .replace(/^create role [^;]*;/gim, "-- (role exists on the server)")
        .replace(
          /^grant anon, authenticated, service_role to current_user;/gim,
          "-- (already a member)",
        ),
    );
    for (const f of readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      try {
        await setup.unsafe(
          read("supabase", "migrations", f).replace(/^create extension[^;]*;/gim, "-- (shim)"),
        );
      } catch (e) {
        throw new Error(`migration ${f} failed in ${name}: ${(e as Error).message}`);
      }
    }
    await setup.unsafe(read("supabase", "events", "sixkings_2026.sql"));
    await setup.unsafe(read("supabase", "tests", "_prelude.sql"));
  } finally {
    await setup.close();
  }
  return new SQL(`${SERVER}/${name}`, { max, idleTimeout: 5 });
}

export async function dropScratchDb(name: string): Promise<void> {
  const admin = new SQL(`${SERVER}/postgres`, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.close();
  }
}
