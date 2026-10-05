// Section P test users (audit, 5 Oct 2026). Creates p-a / p-b on the shared local stack through the
// admin API, a league owned by A with B in it, and a pick for each; writes the ids to out-users.json.
//   ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/setup-users.ts         (create)
//   ANON_KEY=… SERVICE_KEY=… bun tests/verify/p/setup-users.ts --delete
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createUser, deleteTestUsers, passwordSession, rpcAs } from "./lib";

if (process.argv.includes("--delete")) {
  console.log("deleted p-* users:", await deleteTestUsers());
  process.exit(0);
}

const PASS = "audit-P-section-7731";
const users: Record<string, { id: string; email: string; name: string }> = {};
for (const [k, name] of [
  ["a", "Pia Audit"],
  ["b", "Bo Audit"],
] as const) {
  const email = `p-${k}${Date.now() % 100000}@example.test`;
  const id = await createUser(email, PASS, name);
  users[k] = { id, email, name };
}
const sa = await passwordSession(users.a!.email, PASS);
const sb = await passwordSession(users.b!.email, PASS);
// names (the trigger may take the metadata; set them explicitly as the owners)
console.log(
  await rpcAs(sa.access_token, "update_profile", { p_display_name: users.a!.name, p_locale: "en" }),
);
console.log(
  await rpcAs(sb.access_token, "update_profile", { p_display_name: users.b!.name, p_locale: "ar" }),
);
const lg = await rpcAs(sa.access_token, "create_league", { p_name: "P audit league" });
const league = JSON.parse(lg.body);
console.log("league", lg.status, league);
console.log("join", await rpcAs(sb.access_token, "join_league", { p_code: league.code }));
const pick = (tok: string, match: number, winner: string, s: [number, number][]) =>
  rpcAs(tok, "save_pick", {
    p_match: match,
    p_winner: winner,
    p_sets: s.length,
    p_set_scores: s.map(([a, b]) => ({ p1_games: a, p2_games: b })),
  });
console.log(
  "pick a",
  await pick(sa.access_token, 1, "c", [
    [6, 4],
    [6, 3],
  ]),
);
console.log(
  "pick b",
  await pick(sb.access_token, 2, "e", [
    [3, 6],
    [6, 4],
    [4, 6],
  ]),
);
writeFileSync(
  path.join(import.meta.dirname, "out-users.json"),
  JSON.stringify({ users, password: PASS, league }, null, 2),
);
