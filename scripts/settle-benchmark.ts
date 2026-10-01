// Runs loadtest/settle-100k.sql on the in-process Postgres (PGlite, WebAssembly, one thread) with the
// local event. Indicative only, and pessimistic: a real Postgres server is several times faster. The
// number that counts is the staging run in Phase 3.
//   bun scripts/settle-benchmark.ts [fans]     (default 100000)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "./lib/db";

const fans = Number(process.argv[2] ?? 100_000);
const db = await bootDb();
await db.exec(readFileSync(join(ROOT, "supabase", "dev", "seed_local.sql"), "utf8"));
const sql = readFileSync(join(ROOT, "loadtest", "settle-100k.sql"), "utf8").replaceAll(
  "generate_series(1, 100000)",
  `generate_series(1, ${fans})`,
);
const started = Date.now();
const results = await db.exec(sql);
for (const r of results) for (const row of r.rows) console.log(JSON.stringify(row));
console.log(
  `\n${fans} fans, whole script ${((Date.now() - started) / 1000).toFixed(1)} s (PGlite)`,
);
await db.close();
