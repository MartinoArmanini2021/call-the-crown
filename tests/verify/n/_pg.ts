// Section N2: a private, throwaway database on the local `supabase start` Postgres server, so real
// concurrency can be tested without touching the shared `postgres` database (other reviewers use it and
// its simulated clock). The database gets the PGlite shim's auth/vault/cron/net stand-ins (roles are
// cluster-wide and already exist, so those lines are skipped), the migrations in order, the event file
// and the test prelude. NO sim_clock.sql: app_now() is the production now().
// The database is dropped in afterAll.
import { SQL } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../../scripts/lib/db";
import { proposedSql } from "./_proposed";

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

export async function createAuditDb(name: string, max: number): Promise<SQL> {
  if (!/^n_audit_[a-z0-9_]+$/.test(name))
    throw new Error("audit database names start with n_audit_");
  const admin = new SQL(`${SERVER}/postgres`, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.close();
  }
  const setup = new SQL(`${SERVER}/${name}`, { max: 1 });
  try {
    const shim = read("supabase", "dev", "pglite_supabase_shim.sql")
      .replace(/^create role [^;]*;/gim, "-- (role exists on the server)")
      .replace(
        /^grant anon, authenticated, service_role to current_user;/gim,
        "-- (already a member)",
      );
    await setup.unsafe(shim);
    for (const f of readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const body = read("supabase", "migrations", f).replace(
        /^create extension[^;]*;/gim,
        "-- (shim)",
      );
      try {
        await setup.unsafe(body);
      } catch (e) {
        throw new Error(`migration ${f} failed in ${name}: ${(e as Error).message}`);
      }
    }
    for (const s of proposedSql()) await setup.unsafe(s);
    await setup.unsafe(read("supabase", "events", "sixkings_2026.sql"));
    await setup.unsafe(read("supabase", "tests", "_prelude.sql"));
  } finally {
    await setup.close();
  }
  return new SQL(`${SERVER}/${name}`, { max, idleTimeout: 5 });
}

export async function dropAuditDb(name: string): Promise<void> {
  const admin = new SQL(`${SERVER}/postgres`, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.close();
  }
}
