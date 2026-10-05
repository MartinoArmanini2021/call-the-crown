// Q3 — what is left of the ended organiser deal (full-debug brief, Part 2, section Q3).
// Nothing is removed (Rule 4 / Q3: the list is for Tino). These tests record where each leftover
// lives and whether anything still reaches it; the one named "SMELL" FAILS today on purpose.
// Proposed fix for it (Rule 4, consents): tests/verify/proposed/q-organiser-consent.patch
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, as, freshDb, one, uid } from "./_db";

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
function srcFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? srcFiles(join(dir, e.name))
      : /\.(ts|tsx|css|html)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}
const appCode = srcFiles("src").map((f) => [f, read(f)] as const);
const callers = (re: RegExp) =>
  appCode.filter(([, s]) => re.test(s)).map(([f]) => f.replace(/\\/g, "/"));

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
}, 60_000);
afterAll(async () => db?.close());

describe("Q3 organiser-only database objects: present, service-role only, unused by the app", () => {
  test("billing_report, snapshot_billing, export_optins exist and are not executable by anon or authenticated", async () => {
    const rows = (
      await db.query<{ f: string; anon: boolean; auth: boolean; svc: boolean }>(`
        select p.proname f, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
               has_function_privilege('service_role', p.oid, 'EXECUTE') svc
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('billing_report', 'snapshot_billing', 'export_optins')
         order by 1`)
    ).rows;
    expect(rows).toEqual([
      { f: "billing_report", anon: false, auth: false, svc: true },
      { f: "export_optins", anon: false, auth: false, svc: true },
      { f: "snapshot_billing", anon: false, auth: false, svc: true },
    ]);
  });

  test("billing_snapshots and activity_days have no anon/authenticated grant; activity_days is still written by every save_pick", async () => {
    for (const t of ["billing_snapshots", "activity_days"])
      for (const r of ["anon", "authenticated"])
        expect(await one(db, `select has_table_privilege('${r}', 'public.${t}', 'SELECT')`)).toBe(
          false,
        );
    expect(read("supabase", "migrations", "0005_user_rpcs.sql")).toContain(
      "insert into public.activity_days",
    );
  });

  test("the app never calls the billing or export functions", () => {
    expect(
      callers(
        /["'`](billing_report|snapshot_billing|export_optins|billing_snapshots|activity_days)["'`]/,
      ),
    ).toEqual([]);
  });

  test("event_config still carries billing_close_at, prizes, prize_terms_url, sponsor_slots (anon-readable)", async () => {
    const c = await one<Record<string, unknown>>(
      db,
      "select to_jsonb(e) - 'rules' - 'branding' - 'privacy' from public.event_config e",
    );
    expect(c["billing_close_at"]).toBe("2026-10-24T20:59:59+00:00");
    expect((c["prizes"] as unknown[]).length).toBe(3);
    expect(c["prize_terms_url"]).toBeNull();
    expect(c["sponsor_slots"]).toEqual([]);
    expect(
      await one(db, "select has_table_privilege('anon', 'public.event_config', 'SELECT')"),
    ).toBe(true);
  });

  test("the app still renders prizes and sponsor slots wherever config has them", () => {
    expect(callers(/<PrizeStrip/)).toEqual([
      "src/routes/how-to-play.tsx",
      "src/routes/index.tsx",
      "src/routes/standings.tsx",
    ]);
    expect(callers(/<SponsorSlot/)).toEqual([
      "src/routes/index.tsx",
      "src/routes/picks.tsx",
      "src/routes/results.tsx",
      "src/routes/standings.tsx",
    ]);
  });
});

describe("Q3 the organiser consent", () => {
  test("the consents table still allows party 'organiser', and every new account gets an organiser row", async () => {
    await db.exec("select t.new_user(1)");
    expect(
      await one(
        db,
        "select count(*)::int from public.consents where user_id = $1 and party = 'organiser'",
        [uid(1)],
      ),
    ).toBe(1);
  });

  test("the app sends organiser = false on every save (profile.tsx)", () => {
    expect(read("src", "routes", "profile.tsx")).toContain("updateConsents(false, gsgm,");
    expect(callers(/updateConsents\(/)).toEqual([
      "src/routes/profile.tsx",
      "src/routes/sign-in.tsx",
    ]);
    expect(read("src", "routes", "sign-in.tsx")).toMatch(/updateConsents\(\s*false,/);
  });

  // The UI no longer offers the organiser opt-in, but update_consents still takes p_organiser, so a
  // raw RPC call records a fresh "yes" to a list nobody runs, and export_optins('organiser') would hand
  // that address to whoever the operator exports it for.
  test("SMELL a fan can still opt in to the ended organiser list through the raw RPC", async () => {
    await db.exec(
      `begin; select t.as_user('${uid(1)}'); select t.err($$ select public.update_consents(true, false, 'draft-2') $$); commit;`,
    );
    const exported = await as(db, "service", "select email from public.export_optins('organiser')");
    expect(exported).toEqual([]); // FAILS today: fan1@example.test is exported
  });
});
