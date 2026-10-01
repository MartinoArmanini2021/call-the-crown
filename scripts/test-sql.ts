// Runs every supabase/tests/*.sql file (except _prelude.sql) against a fresh throwaway database and
// prints one PASS/FAIL line per check. Each file runs inside begin … rollback.
//   bun run test:sql            all files
//   bun run test:sql scoring    files whose name contains "scoring"
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "./lib/db";

const filter = process.argv[2] ?? "";
const dir = join(ROOT, "supabase", "tests");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("_") && f.includes(filter))
  .sort();

let failures = 0;
let checks = 0;
for (const file of files) {
  const db = await bootDb({ prelude: true });
  console.log(`\n${file}`);
  try {
    const results = await db.exec(readFileSync(join(dir, file), "utf8"));
    const rows = results
      .flatMap((r) => r.rows as Record<string, unknown>[])
      .filter((r) => "result" in r);
    if (rows.length === 0) throw new Error("the file reported no checks");
    for (const row of rows) {
      checks++;
      if (row.result !== "PASS") failures++;
      const detail = row.detail ? `  (${row.detail})` : "";
      console.log(`  ${row.result}  ${row.name}${row.result === "PASS" ? "" : detail}`);
    }
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${file} did not run: ${(e as Error).message}`);
  }
  await db.close();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
