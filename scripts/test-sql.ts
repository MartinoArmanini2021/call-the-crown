// Runs every supabase/tests/*.sql file (except _prelude.sql) and prints one PASS/FAIL line per check.
// Each file runs inside begin … rollback, so nothing it does survives.
//   bun run test:sql            all files, on a fresh in-process database (PGlite) per file
//   bun run test:sql scoring    files whose name contains "scoring"
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres bun run test:sql
//                               the same files on a real Postgres (`supabase start`): the test helpers
//                               (_prelude.sql) are created inside each file's transaction and rolled
//                               back with it. Never point this at staging or production.
import { SQL } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "./lib/db";

const filter = process.argv[2] ?? "";
const dir = join(ROOT, "supabase", "tests");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("_") && f.includes(filter))
  .sort();
const url = process.env["TEST_DATABASE_URL"];
if (url && !/@(127\.0\.0\.1|localhost):55322\//.test(url)) {
  throw new Error(
    "TEST_DATABASE_URL must be the local `supabase start` database (127.0.0.1:55322)",
  );
}

type Row = Record<string, unknown>;

async function runPglite(file: string): Promise<Row[]> {
  const db = await bootDb({ prelude: true });
  try {
    const results = await db.exec(readFileSync(join(dir, file), "utf8"));
    return results.flatMap((r) => r.rows as Row[]);
  } finally {
    await db.close();
  }
}

async function runPostgres(sql: SQL, file: string): Promise<Row[]> {
  // The file's own begin/rollback are replaced by ours, so the prelude shares the transaction.
  const body = readFileSync(join(dir, file), "utf8")
    .replace(/^\s*begin\s*;/im, "")
    .replace(/rollback\s*;\s*$/i, "");
  const prelude = readFileSync(join(dir, "_prelude.sql"), "utf8");
  const conn = await sql.reserve();
  try {
    await conn.unsafe("begin");
    await conn.unsafe(prelude);
    await conn.unsafe(body);
    return (await conn.unsafe("select * from t.report()")) as Row[];
  } finally {
    await conn.unsafe("rollback").catch(() => {});
    conn.release();
  }
}

const sql = url ? new SQL(url) : null;
if (sql) {
  // The test files build their own event inside each transaction; leftovers from a walkthrough
  // (fans, picks, settled matches) would change what they see. Start from the seed.
  const [state] = (await sql.unsafe(
    "select (select count(*) from auth.users)::int as users, (select count(*) from public.matches where status <> 'scheduled')::int as settled",
  )) as { users: number; settled: number }[];
  if (state && (state.users > 0 || state.settled > 0)) {
    console.log(
      `The local database is not at the seed (${state.users} account(s), ${state.settled} settled match(es)). Run \`bunx supabase db reset\` first.`,
    );
    process.exit(1);
  }
}
console.log(url ? "database: local Supabase (Postgres)" : "database: in-process (PGlite)");

let failures = 0;
let checks = 0;
for (const file of files) {
  console.log(`\n${file}`);
  try {
    const rows = (sql ? await runPostgres(sql, file) : await runPglite(file)).filter(
      (r) => "result" in r,
    );
    if (rows.length === 0) throw new Error("the file reported no checks");
    for (const row of rows) {
      checks++;
      if (row["result"] !== "PASS") failures++;
      const detail = row["detail"] ? `  (${String(row["detail"])})` : "";
      console.log(
        `  ${String(row["result"])}  ${String(row["name"])}${row["result"] === "PASS" ? "" : detail}`,
      );
    }
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${file} did not run: ${(e as Error).message}`);
  }
}
await sql?.close();

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
