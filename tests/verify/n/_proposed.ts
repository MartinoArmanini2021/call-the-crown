// Optional: N_PROPOSED=n-save-pick-lock-race,n-real-start-early-final bun test tests/verify/n
// applies the SQL added by those patches in tests/verify/proposed/ after the migrations, so the "BUG"
// tests can be shown passing with the proposed fix. Nothing in supabase/ is changed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../../scripts/lib/db";

export function proposedSql(): string[] {
  const names = (process.env["N_PROPOSED"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.map((n) =>
    readFileSync(join(ROOT, "tests", "verify", "proposed", `${n}.patch`), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n"),
  );
}
