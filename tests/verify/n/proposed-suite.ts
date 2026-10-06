// Runs the existing SQL suite (supabase/tests/*.sql, PGlite) with the section N proposed patches applied
// after the migrations, to show the patches do not break any existing check.
//   N_PROPOSED=n-save-pick-lock-race,n-real-start-early-final bun tests/verify/n/proposed-suite.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../../scripts/lib/db";
import { boot } from "./_pglite";

const dir = join(ROOT, "supabase", "tests");
let checks = 0;
let fails = 0;
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith(".sql") && !x.startsWith("_"))
  .sort()) {
  const db = await boot();
  try {
    const rows = (await db.exec(readFileSync(join(dir, f), "utf8")))
      .flatMap((r) => r.rows as Record<string, unknown>[])
      .filter((r) => "result" in r);
    for (const r of rows) {
      checks++;
      if (r["result"] !== "PASS") {
        fails++;
        console.log(`FAIL ${f}: ${String(r["name"])} ${String(r["detail"] ?? "")}`);
      }
    }
  } finally {
    await db.close();
  }
}
console.log(
  `patches: ${process.env["N_PROPOSED"] ?? "(none)"} · ${checks} checks, ${fails} failed`,
);
process.exit(fails ? 1 : 0);
