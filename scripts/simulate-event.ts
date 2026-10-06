// The whole event, end to end, in a throwaway database with the simulated clock: the database half of
// the local walkthrough (the browser half: README, "Run it locally").
//   operator enters players + schedule → QF picks open → a fan signs up with both consents and picks
//   on two Riyadh days → the poller (same window logic, fixture adapter) delivers the QF results → the
//   SFs open → the board shows the breakdown (no prizes) → the fan counts as qualified.
// Every step asserts what it claims; the script exits 1 on the first broken claim.
//   bun run simulate
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootDb, ROOT } from "./lib/db";
import { pollAsService } from "./lib/poller";

let step = 0;
function claim(ok: boolean, text: string, detail?: unknown): void {
  step++;
  console.log(
    `${ok ? "  ✓" : "  ✗"} ${text}${!ok && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ""}`,
  );
  if (!ok) process.exit(1);
}
const section = (t: string) => console.log(`\n${t}`);

async function as<T>(
  db: PGlite,
  who: "service" | { uid: string },
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims =
      who === "service" ? { role: "service_role" } : { sub: who.uid, role: "authenticated" };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${who === "service" ? "service_role" : "authenticated"}`);
    return fn(tx);
  });
}
const setClock = (db: PGlite, at: string) => db.query("select public.dev_set_now($1)", [at]);

// One run of the poller: the edge function's own logic (poll-results/poll.ts) with the fixture
// adapter, which publishes each final result 90 minutes after the match's start.
async function poll(db: PGlite): Promise<Record<number, string>> {
  return Object.fromEntries((await pollAsService(db)).map((o) => [o.match_no, o.outcome]));
}

const db = await bootDb();
const FAN = "00000000-0000-0000-0000-00000000f001";
const OTHERS = ["00000000-0000-0000-0000-00000000f002", "00000000-0000-0000-0000-00000000f003"];
const pick = (uid: string, match: number, winner: string, sets: [number, number][]) =>
  as(
    db,
    { uid },
    async (tx) =>
      (
        await tx.query<{ r: { changed: boolean } }>(
          "select public.save_pick($1, $2, $3, $4::jsonb) as r",
          [
            match,
            winner,
            sets.length,
            JSON.stringify(sets.map(([a, b]) => ({ p1_games: a, p2_games: b }))),
          ],
        )
      ).rows[0]!.r,
  );

section("1. The operator enters the players and the schedule (supabase/dev/seed_local.sql)");
await db.exec(readFileSync(join(ROOT, "supabase", "dev", "seed_local.sql"), "utf8"));
const m0 = (
  await db.query<{ match_no: number; p1_id: string | null; p2_id: string | null }>(
    "select match_no, p1_id, p2_id from public.matches order by 1",
  )
).rows;
claim(m0.length === 6, "six matches in the bracket");
claim(
  m0
    .filter((m) => m.p1_id && m.p2_id)
    .map((m) => m.match_no)
    .join() === "1,2",
  "only the two quarter-finals have both players: QF picks are open",
);
claim(
  m0[2]!.p2_id === null && m0[3]!.p2_id === null,
  "the semi-finals wait for the quarter-final winners",
);

section(
  "2. A fan signs up with both marketing consents (as Supabase Auth would create the account)",
);
await db.query(
  `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
   ($1, 'fan1@example.test', now(), '{"display_name": "Fan One"}'),
   ($2, 'fan2@example.test', now(), '{"display_name": "Fan Two"}'),
   ($3, 'fan3@example.test', now(), '{"display_name": "Fan Three"}')`,
  [FAN, ...OTHERS],
);
// New accounts start with both consents not granted (0013); the verified fan's own answers follow.
await as(db, { uid: FAN }, (tx) =>
  tx.query("select public.update_consents(false, true, 'draft-1')"),
);
const consents = (
  await db.query<{ party: string; granted: boolean; text_version: string }>(
    `select distinct on (party) party, granted, text_version from public.consents
      where user_id = $1 order by party, changed_at desc`,
    [FAN],
  )
).rows;
claim(
  consents.length === 2 &&
    consents.some((c) => c.party === "gsgm" && c.granted && c.text_version === "draft-1") &&
    consents.some((c) => c.party === "organiser" && !c.granted),
  "the opt-in stored with its timestamp and the text version shown; the organiser list stays closed",
  consents,
);

section("3. Day 1 (20 Oct, Riyadh): the fan picks both quarter-finals: winner, sets, set scores");
claim(
  (
    await pick(FAN, 1, "f", [
      [4, 6],
      [6, 3],
      [4, 6],
    ])
  ).changed,
  "QF1: Player F in three sets (an upset)",
);
claim(
  (
    await pick(FAN, 2, "d", [
      [6, 4],
      [6, 4],
    ])
  ).changed,
  "QF2: Player D 6-4 6-4",
);
await pick(OTHERS[0]!, 1, "c", [
  [6, 4],
  [6, 4],
]);
await pick(OTHERS[0]!, 2, "d", [
  [6, 4],
  [6, 3],
]);
await pick(OTHERS[1]!, 1, "f", [
  [4, 6],
  [4, 6],
]);
claim(
  !(
    await pick(FAN, 2, "d", [
      [6, 4],
      [6, 4],
    ])
  ).changed,
  "saving the same pick again changes nothing",
);

section("4. Day 2 (21 Oct, Riyadh morning): the fan changes the QF2 score");
await setClock(db, "2026-10-21 08:00+00");
claim(
  (
    await pick(FAN, 2, "d", [
      [6, 4],
      [6, 3],
    ])
  ).changed,
  "QF2 changed to 6-4 6-3",
);
const days = (
  await db.query<{ day: string }>(
    "select day::text from public.activity_days where user_id = $1 order by 1",
    [FAN],
  )
).rows.map((r) => r.day);
claim(days.join() === "2026-10-20,2026-10-21", "two pick days recorded server-side", days);

section("5. Night 1: the poller runs before, during and after the quarter-finals");
await setClock(db, "2026-10-21 15:20+00");
claim(
  Object.keys(await poll(db)).length === 0,
  "15:20 UTC: no match in its window (it opens 60 minutes before a start), the provider is not called",
);
await setClock(db, "2026-10-21 16:20+00");
const early = await poll(db);
claim(
  early[1] === "not_final",
  "16:20 UTC: QF1 is in its window; the provider has no result yet",
  early,
);
claim(
  (await pick(OTHERS[1]!, 1, "c", [
    [6, 4],
    [6, 4],
  ]).catch((e: Error) => e.message)) !== "locked",
  "picks stay open until the scheduled start",
);
await setClock(db, "2026-10-21 16:31+00");
claim(
  String(
    await pick(OTHERS[1]!, 1, "c", [
      [6, 3],
      [6, 3],
    ]).catch((e: Error) => e.message),
  ).includes("locked"),
  "one minute after the start, QF1 is locked",
);
await setClock(db, "2026-10-21 20:00+00");
const night1 = await poll(db);
claim(
  night1[1] === "settled" && night1[2] === "settled",
  "20:00 UTC: the provider marks both QFs final (90 minutes after their starts): both settled",
  night1,
);

section("6. The semi-finals open with the quarter-final winners");
const sf = (
  await db.query<{
    match_no: number;
    p1_id: string;
    p2_id: string;
    p1_win_points: number;
    p2_win_points: number;
  }>(
    "select match_no, p1_id, p2_id, p1_win_points, p2_win_points from public.matches where match_no in (3, 4) order by 1",
  )
).rows;
claim(sf[0]!.p2_id === "f" && sf[1]!.p2_id === "d", "SF1 = A v F, SF2 = B v D", sf);
claim(
  sf[0]!.p2_win_points === 16,
  "potential points stored for the SF upset (rank 10 over rank 1: 16)",
  sf[0],
);
claim(
  (
    await pick(FAN, 3, "a", [
      [6, 4],
      [3, 6],
      [6, 3],
    ])
  ).changed,
  "the fan picks SF1",
);

section("7. The board: per-component breakdown, no prizes");
const breakdown = (
  await as(db, { uid: FAN }, (tx) =>
    tx.query<{
      match_no: number;
      pts_winner: number;
      pts_sets: number;
      pts_exact: number;
      pts_total: number;
    }>(
      "select match_no, pts_winner, pts_sets, pts_exact, pts_total from public.picks where user_id = $1 and pts_total is not null order by 1",
      [FAN],
    ),
  )
).rows;
for (const b of breakdown)
  console.log(
    `      match ${b.match_no}: winner ${b.pts_winner} + sets ${b.pts_sets} + exact sets ${b.pts_exact} = ${b.pts_total}`,
  );
claim(breakdown[0]?.pts_total === 20, "QF1: 10 (upset) + 4 + 6 = 20", breakdown[0]);
claim(breakdown[1]?.pts_total === 16, "QF2: 8 + 4 + 4 = 16", breakdown[1]);
const board = (
  await as(db, { uid: FAN }, (tx) =>
    tx.query<{ pos: number; display_name: string; points: number; is_me: boolean }>(
      "select pos, display_name, points, is_me from public.get_leaderboard(null, 0, 10)",
    ),
  )
).rows;
for (const r of board)
  console.log(
    `      ${r.pos}. ${r.display_name.padEnd(10)} ${String(r.points).padStart(3)}${r.is_me ? "  ← me" : ""}`,
  );
claim(board[0]?.is_me === true && board[0].points === 36, "the fan leads with 36", board);
const prizes = (
  await db.query<{ prizes: { place: number; title: string }[] }>(
    "select prizes from public.event_config",
  )
).rows[0]!.prizes;
claim(prizes.length === 0, "no prizes: bragging rights only (0019)", prizes);

section("8. Billing: who is a qualified fan (picks made or changed on 2+ Riyadh days)");
const perFan = (
  await db.query<{ email: string; days: number }>(
    `select u.email, (select count(*)::int from public.activity_days a where a.user_id = u.id) as days
     from auth.users u order by u.email`,
  )
).rows;
for (const f of perFan) console.log(`      ${f.email}: ${f.days} pick day(s)`);
// Fan One picked on 20 and 21 Oct; Fan Three picked on 20 Oct and changed a pick on 21 Oct (step 5);
// Fan Two picked on 20 Oct only.
const report = await as(
  db,
  "service",
  async (tx) =>
    (await tx.query<{ r: Record<string, unknown> }>("select public.billing_report() as r")).rows[0]!
      .r,
);
console.log(
  `      ${JSON.stringify({ registered: report.registered, verified: report.verified, qualified: report.qualified })}`,
);
claim(
  report.registered === 3 && report.verified === 3 && report.qualified === 2,
  "registered 3, verified 3, qualified 2 (Fan One and Fan Three; Fan Two picked on one day only)",
  report,
);

console.log(`\n${step} claims, all true.`);
await db.close();
