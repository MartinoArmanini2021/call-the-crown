// Dress rehearsal of the ATP Finals 2026 event, end to end, in a throwaway database (PGlite) with the
// simulated clock: the real event and draw files, the real poller (poll-results/poll.ts) and the real
// Wikipedia adapter reading a page that is filled in as the week goes, the database's own stability
// rule (10 minutes), day scheduling, group standings and the semi-final fill. Results are INVENTED
// for the rehearsal (they are not predictions); the page is written in the 2025 article's format,
// which tests/wikipedia-rr.test.ts checks against the real 2025 page.
//   bun scripts/rehearse-atp-finals.ts
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WikipediaAdapter } from "../supabase/functions/poll-results/adapters/wikipedia.ts";
import { bootDb, ROOT } from "./lib/db";
import { pollAsService } from "./lib/poller";

let fails = 0;
function claim(ok: boolean, text: string, detail?: unknown) {
  console.log(
    `${ok ? "  ✓" : "  ✗"} ${text}${!ok && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ""}`,
  );
  if (!ok) fails++;
}
const section = (t: string) => console.log(`\n${t}`);

// ---- the page --------------------------------------------------------------------------------------
type Cell = { sets: [number, number][]; winnerRow: boolean } | null; // from the row's view
const NAMES: Record<string, string> = {
  zverev: "Alexander Zverev",
  shelton: "Ben Shelton",
  fils: "Arthur Fils",
  jodar: "Rafael Jódar",
  alcaraz: "Carlos Alcaraz",
  medvedev: "Daniil Medvedev",
  cobolli: "Flavio Cobolli",
  tiafoe: "Frances Tiafoe",
};
const GROUPS = {
  "John McEnroe": ["zverev", "shelton", "fils", "jodar"],
  "Ivan Lendl": ["alcaraz", "medvedev", "cobolli", "tiafoe"],
} as const;
const rr = new Map<string, Cell>(); // "McEnroe|1v4"
const ko = new Map<string, { team: string | null; bold: boolean; sets: number[] }>(); // "RD1|1"
const cellText = (c: Cell) =>
  !c
    ? ""
    : (c.winnerRow ? "'''" : "") +
      c.sets.map(([a, b]) => `${a}–${b}`).join(", ") +
      (c.winnerRow ? "'''" : "");
function page(): string {
  const out: string[] = [
    "==Draw==",
    "===Finals===",
    "{{4TeamBracket-Tennis3",
    "|RD1=Semifinals",
    "|RD2=Final",
  ];
  for (const [rd, n] of [
    ["RD1", 4],
    ["RD2", 2],
  ] as const) {
    for (let i = 1; i <= n; i++) {
      const k = ko.get(`${rd}|${i}`);
      const name = k?.team ? `{{flagicon|}} [[${NAMES[k.team]}]]` : "{{flagicon|}}";
      out.push(`|${rd}-team${i}=${k?.bold ? `'''${name}'''` : name}`);
      for (let s = 1; s <= 3; s++) {
        const g = k?.sets[s - 1];
        out.push(`|${rd}-score${i}-${s}=${g === undefined ? "" : k?.bold ? `'''${g}'''` : g}`);
      }
    }
  }
  out.push("}}");
  for (const [group, ids] of Object.entries(GROUPS)) {
    out.push(`===[[${group}]] Group===`, "{{4TeamRR-TennisWide");
    ids.forEach((id, i) => out.push(`| team-${i + 1}={{flagicon|}} [[${NAMES[id]}]]`));
    for (let i = 1; i <= 4; i++) {
      const cells = [1, 2, 3, 4]
        .filter((j) => j !== i)
        .map((j) => `|${i}v${j}=${cellText(rr.get(`${group}|${i}v${j}`) ?? null)}`);
      out.push(`|color-row-${i}= ${cells.join(" ")}`);
    }
    out.push("}}");
  }
  return out.join("\n");
}
// record a group result: winner/loser ids, sets from the winner's view
function groupResult(group: keyof typeof GROUPS, w: string, l: string, sets: [number, number][]) {
  const ids = GROUPS[group] as readonly string[];
  const iw = ids.indexOf(w) + 1;
  const il = ids.indexOf(l) + 1;
  rr.set(`${group}|${iw}v${il}`, { sets, winnerRow: true });
  rr.set(`${group}|${il}v${iw}`, { sets: sets.map(([a, b]) => [b, a]), winnerRow: false });
}
const adapter = new WikipediaAdapter(
  "2026 ATP Finals – Singles",
  "rehearsal",
  (async () =>
    new Response(
      JSON.stringify({
        query: {
          pages: [
            {
              revisions: [
                {
                  revid: 1,
                  timestamp: "2026-11-15T00:00:00Z",
                  slots: { main: { content: page() } },
                },
              ],
            },
          ],
        },
      }),
    )) as unknown as typeof fetch,
);
// a fresh adapter each run (it caches one page per run, as on the server)
const freshAdapter = () =>
  new WikipediaAdapter(
    "2026 ATP Finals – Singles",
    "rehearsal",
    (async () =>
      new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                revisions: [
                  {
                    revid: 1,
                    timestamp: "2026-11-15T00:00:00Z",
                    slots: { main: { content: page() } },
                  },
                ],
              },
            ],
          },
        }),
      )) as unknown as typeof fetch,
  );
void adapter;

// ---- the database ------------------------------------------------------------------------------------
const db: PGlite = await bootDb();
await db.exec(readFileSync(join(ROOT, "supabase", "events", "atp_finals_2026.sql"), "utf8"));
await db.query("select public.dev_set_now('2026-11-13 12:00+00')");
await db.exec(readFileSync(join(ROOT, "supabase", "events", "atp_finals_2026_draw.sql"), "utf8"));
const setClock = (at: string) => db.query("select public.dev_set_now($1)", [at]);
const q = async <T>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;
async function as<T>(uid: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}
const pick = (uid: string, match: number, winner: string, sets: [number, number][]) =>
  as(uid, (tx) =>
    tx.query("select public.save_pick($1, $2, $3, $4::jsonb)", [
      match,
      winner,
      sets.length,
      JSON.stringify(sets.map(([a, b]) => ({ p1_games: a, p2_games: b }))),
    ]),
  ).then(
    () => null,
    (e: Error) => e.message,
  );
// poll every minute for 13 minutes from `from`: enough for the 10-minute stability rule
async function pollWindow(from: string) {
  const t0 = Date.parse(from);
  for (let i = 0; i <= 13; i++) {
    await setClock(new Date(t0 + i * 60_000).toISOString());
    await pollAsService(db, freshAdapter());
  }
}
const status = async () =>
  Object.fromEntries(
    (
      await q<{ match_no: number; status: string }>("select match_no, status from public.matches")
    ).map((r) => [r.match_no, r.status]),
  );

section("1. The draw as loaded");
const m0 = await q<{
  match_no: number;
  round: string;
  grp: string | null;
  p1_id: string | null;
  p2_id: string | null;
  starts_at: string | null;
  p1_win_points: number | null;
  p2_win_points: number | null;
}>(
  "select match_no, round, grp, p1_id, p2_id, starts_at::text, p1_win_points, p2_win_points from public.matches order by 1",
);
claim(m0.length === 15, "15 matches: 12 group, 2 semi-finals, the final", m0.length);
claim(
  m0.filter((m) => m.round === "RR" && m.p1_id && m.p2_id).length === 12,
  "every group match has both players",
);
claim(
  m0
    .filter((m) => m.starts_at)
    .map((m) => m.match_no)
    .join() === "1,2,7,8,13,14,15",
  "locks set for day 1, the semi-finals and the final",
  m0.filter((m) => m.starts_at).map((m) => m.match_no),
);
claim(
  m0[0]!.p1_win_points === 8 && m0[0]!.p2_win_points === 10,
  "Zverev (1) v Jódar (10): 8 for Zverev, 10 for a Jódar upset (8 × 1.23 = 9.8)",
  [m0[0]!.p1_win_points, m0[0]!.p2_win_points],
);
const ev = (
  await q<{ timezone: string; name: string }>("select timezone, name from public.event_config")
)[0]!;
claim(
  ev.timezone === "Europe/Rome" && ev.name.includes("ATP Finals"),
  "event: Turin time, ATP Finals",
  ev,
);

section("2. Fans sign up and pick day 1");
const fans = [
  "00000000-0000-0000-0000-00000000a001",
  "00000000-0000-0000-0000-00000000a002",
  "00000000-0000-0000-0000-00000000a003",
];
for (const [i, id] of fans.entries())
  await db.query(
    "insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3)",
    [id, `fan${i + 1}@example.test`, JSON.stringify({ display_name: `Fan ${i + 1}` })],
  );
claim(
  (await pick(fans[0]!, 1, "zverev", [
    [6, 4],
    [6, 4],
  ])) === null,
  "fan 1: Zverev 6-4 6-4",
);
claim(
  (await pick(fans[1]!, 1, "jodar", [
    [4, 6],
    [4, 6],
  ])) === null,
  "fan 2: Jódar in two",
);
claim(
  (await pick(fans[0]!, 2, "fils", [
    [6, 7],
    [3, 6],
  ])) === null,
  "fan 1: Fils 7-6 6-3 (written Shelton first: 6-7 3-6)",
);
claim(
  (
    await pick(fans[2]!, 3, "zverev", [
      [6, 4],
      [6, 4],
    ])
  )?.includes("no_start_time") === true,
  "a day-3 match cannot be picked yet",
);

section("3. Sunday: McEnroe day 1 on the page, the poller settles it");
groupResult("John McEnroe", "zverev", "jodar", [
  [6, 4],
  [6, 4],
]);
await pollWindow("2026-11-15 15:45+01");
groupResult("John McEnroe", "fils", "shelton", [
  [7, 6],
  [6, 3],
]);
await pollWindow("2026-11-15 22:15+01");
const s1 = await status();
claim(
  s1[1] === "completed" && s1[2] === "completed",
  "both day-1 matches settled after 10 stable minutes",
  s1,
);
const pts1 = await q<{ match_no: number; pts_total: number }>(
  "select match_no, pts_total from public.picks where user_id = $1 order by 1",
  [fans[0]],
);
claim(
  pts1.map((p) => p.pts_total).join() === "16,17",
  "fan 1: 16 on Zverev (8 + 4 sets + 2×2 exact), 17 on Fils (upset 9 + 4 + 2×2 exact)",
  pts1,
);
const day = await q<{ match_no: number; matchday: number; starts_at: string }>(
  "select match_no, matchday, starts_at::text from public.matches where grp = 'McEnroe' and match_no > 2 order by 1",
);
claim(
  day
    .filter((d) => d.matchday === 2)
    .map((d) => d.match_no)
    .join() === "4,5",
  "day 2 = Zverev v Fils (winners), Shelton v Jódar (losers)",
  day,
);
claim(
  day
    .filter((d) => d.matchday === 3)
    .map((d) => d.match_no)
    .join() === "3,6",
  "day 3 = Zverev v Shelton, Fils v Jódar",
  day,
);
claim(
  day.find((d) => d.match_no === 4)!.starts_at.startsWith("2026-11-17 13:00"),
  "day 2 locks at 14:00 Turin on Tue 17 Nov",
  day.find((d) => d.match_no === 4),
);
claim(
  (await pick(fans[2]!, 4, "zverev", [
    [6, 3],
    [6, 3],
  ])) === null,
  "a day-2 match is now pickable",
);

section("4. Monday: Lendl day 1");
groupResult("Ivan Lendl", "alcaraz", "tiafoe", [
  [6, 2],
  [6, 2],
]);
groupResult("Ivan Lendl", "cobolli", "medvedev", [
  [6, 4],
  [6, 4],
]);
await pollWindow("2026-11-16 22:15+01");
const s2 = await status();
claim(s2[7] === "completed" && s2[8] === "completed", "Lendl day 1 settled", s2);
const lday = await q<{ match_no: number; matchday: number }>(
  "select match_no, matchday from public.matches where grp = 'Lendl' and match_no > 8 order by 1",
);
claim(
  lday
    .filter((d) => d.matchday === 2)
    .map((d) => d.match_no)
    .join() === "10,11",
  "day 2 = Alcaraz v Cobolli, Medvedev v Tiafoe",
  lday,
);

section("5. Days 2 and 3");
groupResult("John McEnroe", "zverev", "fils", [
  [6, 3],
  [6, 3],
]);
groupResult("John McEnroe", "shelton", "jodar", [
  [6, 4],
  [7, 5],
]);
await pollWindow("2026-11-17 23:00+01");
groupResult("Ivan Lendl", "alcaraz", "cobolli", [
  [6, 3],
  [6, 4],
]);
groupResult("Ivan Lendl", "medvedev", "tiafoe", [
  [6, 3],
  [6, 3],
]);
await pollWindow("2026-11-18 23:00+01");
claim(
  (await q<{ p1_id: string | null }>("select p1_id from public.matches where match_no = 13"))[0]!
    .p1_id === null,
  "no semi-final player before a group is complete",
);
groupResult("John McEnroe", "zverev", "shelton", [
  [7, 6],
  [6, 4],
]);
groupResult("John McEnroe", "fils", "jodar", [
  [6, 4],
  [3, 6],
  [6, 3],
]);
await pollWindow("2026-11-19 23:00+01");
// Lendl: a three-way tie on two wins. Alcaraz 5-2 in sets; Cobolli and Medvedev 4-3 each → head to head: Cobolli
groupResult("Ivan Lendl", "medvedev", "alcaraz", [
  [4, 6],
  [6, 4],
  [6, 4],
]);
groupResult("Ivan Lendl", "cobolli", "tiafoe", [
  [6, 7],
  [7, 6],
  [7, 5],
]);
await pollWindow("2026-11-20 23:00+01");
const s3 = await status();
claim(
  Object.entries(s3)
    .filter(([n]) => Number(n) <= 12)
    .every(([, s]) => s === "completed"),
  "all twelve group matches settled",
  s3,
);
const sf = await q<{
  match_no: number;
  p1_id: string;
  p2_id: string;
  p1_win_points: number;
  p2_win_points: number;
}>(
  "select match_no, p1_id, p2_id, p1_win_points, p2_win_points from public.matches where round = 'SF' order by 1",
);
claim(
  sf[0]!.p1_id === "zverev" && sf[0]!.p2_id === "cobolli",
  "SF1 = Zverev (McEnroe winner) v Cobolli (Lendl runner-up: 3-way tie, sets, then head to head over Medvedev)",
  sf[0],
);
claim(
  sf[1]!.p1_id === "alcaraz" && sf[1]!.p2_id === "fils",
  "SF2 = Alcaraz (Lendl winner) v Fils (McEnroe runner-up)",
  sf[1],
);
claim(
  sf.every((m) => m.p1_win_points === 13),
  "semi-final points stored (13 for the higher-ranked player)",
  sf,
);
claim(
  (await pick(fans[0]!, 13, "zverev", [
    [6, 4],
    [6, 4],
  ])) === null,
  "fan 1 picks SF1",
);
claim(
  (await pick(fans[1]!, 14, "fils", [
    [4, 6],
    [4, 6],
  ])) === null,
  "fan 2 picks Fils in SF2",
);

section("6. Semi-finals and final: the 4-team bracket");
ko.set("RD1|1", { team: "zverev", bold: true, sets: [6, 6] });
ko.set("RD1|2", { team: "cobolli", bold: false, sets: [4, 4] });
ko.set("RD1|3", { team: "alcaraz", bold: true, sets: [6, 6] });
ko.set("RD1|4", { team: "fils", bold: false, sets: [3, 2] });
await pollWindow("2026-11-21 23:30+01");
const s4 = await status();
claim(
  s4[13] === "completed" && s4[14] === "completed",
  "both semi-finals settled from the bracket",
  s4,
);
const fin = (
  await q<{ p1_id: string; p2_id: string }>(
    "select p1_id, p2_id from public.matches where match_no = 15",
  )
)[0]!;
claim(fin.p1_id === "zverev" && fin.p2_id === "alcaraz", "the final: Zverev v Alcaraz", fin);
claim(
  (await pick(fans[2]!, 15, "alcaraz", [
    [6, 7],
    [4, 6],
  ])) === null,
  "fan 3 picks Alcaraz 7-6 6-4",
);
ko.set("RD2|1", { team: "zverev", bold: false, sets: [6, 4] });
ko.set("RD2|2", { team: "alcaraz", bold: true, sets: [7, 6] });
await pollWindow("2026-11-22 20:30+01");
const fm = (
  await q<{ status: string; winner_id: string }>(
    "select status, winner_id from public.matches where match_no = 15",
  )
)[0]!;
claim(fm.status === "completed" && fm.winner_id === "alcaraz", "the final settled: Alcaraz", fm);
const f3 = (
  await q<{ pts_total: number }>(
    "select pts_total from public.picks where user_id = $1 and match_no = 15",
    [fans[2]],
  )
)[0]!;
claim(
  f3.pts_total === 21 + 10 + 4,
  "fan 3 on the final: 21 (no. 3 beats no. 1) + 10 sets + 2×2 exact = 35",
  f3,
);

section("7. The table");
const board = await q<{ display_name: string; points: number; rank: number }>(
  "select p.display_name, s.points, s.rank from public.standings s join public.profiles p using (user_id) order by s.rank",
);
claim(board.length === 3 && board.every((b) => b.rank >= 1), "every fan ranked", board);
const health = (
  await q<{ ok: boolean; detail: string }>(
    "select ok, detail from public.ops_health where key = 'poll-results'",
  )
)[0];
claim(health?.ok === true, "the poller's last heartbeat is healthy", health);
const alerts = await q<{ kind: string; n: number }>(
  "select kind, count(*)::int as n from public.ops_alerts group by 1 order by 1",
);
claim(
  !alerts.some((a) =>
    ["result_rejected", "bracket_conflict", "group_standings_manual"].includes(a.kind),
  ),
  "no rejected reading, no bracket conflict, no manual standings",
  alerts,
);

console.log(fails === 0 ? "\nrehearsal: every claim true" : `\nrehearsal: ${fails} claim(s) false`);
process.exit(fails === 0 ? 0 : 1);
