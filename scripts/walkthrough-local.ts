// The definition-of-done walkthrough on the REAL local stack (`supabase start` + `supabase functions
// serve`): real Supabase Auth with the 6-digit code read from the local mail catcher (Mailpit), real
// PostgREST + RLS, real pg_cron → pg_net → edge function poller → settlement. Only the clock is moved,
// with the local-only simulated clock. Every step asserts what it claims; exit 1 on the first failure.
// Refuses to run against anything but 127.0.0.1. Invented fan only (fanN@example.test).
//   bun scripts/walkthrough-local.ts
// Afterwards `bunx supabase db reset` puts the local database back to the seed.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SQL } from "bun";

const API = "http://127.0.0.1:55321";
const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const MAIL = "http://127.0.0.1:55324";
const EMAIL = `fan${Date.now() % 100000}@example.test`;

const status = JSON.parse(
  await (async () => {
    const t = await new Response(
      Bun.spawn(["bunx", "supabase", "status", "-o", "json"], { stderr: "ignore" }).stdout,
    ).text();
    return t.slice(t.indexOf("{"));
  })(),
) as { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string };
if (status.API_URL !== API)
  throw new Error(`expected local Supabase at ${API}, got ${status.API_URL}`);

let n = 0;
function claim(ok: boolean, text: string, detail?: unknown) {
  n++;
  console.log(
    `${ok ? "  ✓" : "  ✗"} ${text}${!ok && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ""}`,
  );
  if (!ok) process.exit(1);
}
const section = (t: string) => console.log(`\n${t}`);
const db = new SQL(DB);
const setClock = (at: string) => db.unsafe(`select public.dev_set_now('${at}')`);
const fresh = () =>
  createClient(API, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createClient(API, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

async function latestMail(to: string): Promise<{ text: string; html: string }> {
  for (let i = 0; i < 30; i++) {
    const list = (await (
      await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    ).json()) as {
      messages?: { ID: string }[];
    };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const m = (await (await fetch(`${MAIL}/api/v1/message/${id}`)).json()) as {
        Text: string;
        HTML: string;
      };
      return { text: m.Text, html: m.HTML };
    }
    await Bun.sleep(1000);
  }
  throw new Error(`no email for ${to}`);
}

// ------------------------------------------------------------------------------------------------
section(
  "1. The operator's players and schedule are in (seed, through the operator RPCs); QF picks are open",
);
await setClock("2026-10-20 12:00+00");
const anon = fresh();
const matches = must(
  await anon.from("matches").select("match_no, p1_id, p2_id, starts_at").order("match_no"),
  "matches",
);
claim(matches.length === 6, "anon reads the six matches (public event data)");
claim(
  matches
    .filter((m) => m.p1_id && m.p2_id)
    .map((m) => m.match_no)
    .join() === "1,2",
  "both quarter-finals have their players; the semi-finals wait",
);
claim((await anon.from("picks").select("*")).error !== null, "anon cannot read picks at all");

section("2. A fan signs up with both consents: real Supabase Auth, 6-digit code by email");
// Audit 3 Oct 2026, F-01: nobody gets an account by typing an address. The bare password sign-up
// endpoint gives no session, its password does not work while the address is unproven, and it is
// wiped when the real owner proves the address with the emailed code (0014).
const SQUATTER = `squat${Date.now() % 100000}@example.test`;
const squat = await fresh().auth.signUp({ email: SQUATTER, password: "Squatter-pass-1" });
claim(!squat.data.session, "the bare password sign-up gives no session without the emailed code");
claim(
  !!(await fresh().auth.signInWithPassword({ email: SQUATTER, password: "Squatter-pass-1" })).error,
  "… and its password does not work on the unproven address",
);
await Bun.sleep(1500); // the resend interval
const owner = fresh();
must(
  await owner.auth.signInWithOtp({ email: SQUATTER, options: { shouldCreateUser: true } }),
  "owner signInWithOtp",
);
const ownerCode = /\b(\d{6})\b/.exec((await latestMail(SQUATTER)).text)?.[1];
must(
  await owner.auth.verifyOtp({ email: SQUATTER, token: ownerCode!, type: "email" }),
  "owner verifyOtp",
);
claim(
  !!(await fresh().auth.signInWithPassword({ email: SQUATTER, password: "Squatter-pass-1" })).error,
  "when the real owner proves the address with their code, the stranger's password is gone",
);
const fan = fresh();
must(
  await fan.auth.signInWithOtp({
    email: EMAIL,
    options: { shouldCreateUser: true, data: { display_name: "Fan One" } },
  }),
  "signInWithOtp",
);
const [before] = await db`select u.email_confirmed_at, array_agg(c.granted) as granted
                            from auth.users u join public.consents c on c.user_id = u.id
                           where u.email = ${EMAIL} group by u.email_confirmed_at`;
claim(
  before.email_confirmed_at === null && before.granted.every((g: boolean) => !g),
  "before the code: the address is not verified and both consents start not granted",
  before,
);
const mail = await latestMail(EMAIL);
const code = /\b(\d{6})\b/.exec(mail.text)?.[1];
claim(!!code, `the email carries a 6-digit code (${code})`);
claim(
  !/href=|https?:\/\//i.test(mail.html + mail.text),
  "the email has no link at all (codes only: links break in in-app browsers)",
);
const session = must(
  await fan.auth.verifyOtp({ email: EMAIL, token: code!, type: "email" }),
  "verifyOtp",
);
const uid = session.user!.id;
claim(!!session.session, "the code signs the fan in");
// F-02: the name and answers are written by the proven owner, after the code (as the app does).
must(
  await fan.rpc("update_profile", { p_display_name: "Fan One", p_locale: "en" }),
  "update_profile",
);
must(
  await fan.rpc("update_consents", { p_organiser: true, p_gsgm: true, p_text_version: "draft-1" }),
  "update_consents",
);
const consents = must(
  await fan
    .from("consents")
    .select("party, granted, text_version, changed_at")
    .order("changed_at", { ascending: false }),
  "consents",
);
const latest = ["organiser", "gsgm"].map((p) => consents.find((c) => c.party === p));
claim(
  latest.every((c) => c?.granted && c.text_version === "draft-1") && consents.length === 4,
  "both consents stored server-side with the text version (history: not granted, then granted)",
  consents,
);

// Tino, 3 Oct 2026: the code proves the email once; every later sign-in is email + password.
// Invented local test credential (this script and the local stack only).
section("2b. Later sign-ins: email + password, no email needed");
const PASSWORD = "Six-kings-local-1";
claim(
  (await fan.auth.updateUser({ password: "short1" })).error !== null,
  "a password under 8 characters is refused",
);
must(await fan.auth.updateUser({ password: PASSWORD }), "updateUser");
const later = await fresh().auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
claim(
  !later.error && later.data.user?.id === uid,
  "the fan signs in again with email + password, without a new code",
);
claim(
  (await fresh().auth.signInWithPassword({ email: EMAIL, password: "Wrong-password-1" })).error !==
    null,
  "a wrong password is refused",
);

section("3. Day 1 (20 Oct, Riyadh): picks — winner, sets, set scores");
const pick = (m: number, w: string, sets: [number, number][]) =>
  fan.rpc("save_pick", {
    p_match: m,
    p_winner: w,
    p_sets: sets.length,
    p_set_scores: sets.map(([a, b]) => ({ p1_games: a, p2_games: b })),
  });
claim(
  !(
    await pick(1, "f", [
      [4, 6],
      [6, 3],
      [4, 6],
    ])
  ).error,
  "QF1: Player F in three sets (an upset)",
);
claim(
  !(
    await pick(2, "d", [
      [6, 4],
      [6, 4],
    ])
  ).error,
  "QF2: Player D 6-4 6-4",
);
claim(
  (
    await pick(2, "d", [
      [7, 3],
      [6, 4],
    ])
  ).error?.message === "illegal_set_score",
  "the server refuses an illegal set (7-3)",
);
claim(
  (
    await fan
      .from("picks")
      .insert({ user_id: uid, match_no: 3, winner_id: "a", sets: 2, set_scores: [] })
  ).error !== null,
  "a direct insert into picks is refused (writes only through save_pick)",
);

section("4. Day 2 (21 Oct, Riyadh morning): the fan changes a pick");
await setClock("2026-10-21 08:00+00");
claim(
  !(
    await pick(2, "d", [
      [6, 4],
      [6, 3],
    ])
  ).error,
  "QF2 changed to 6-4 6-3",
);
const days = await db.unsafe(
  `select day::text from public.activity_days where user_id = '${uid}' order by 1`,
);
claim(
  days.map((d: { day: string }) => d.day).join() === "2026-10-20,2026-10-21",
  "two pick days recorded server-side",
  days,
);

section(
  "5. Night 1: results arrive by themselves (pg_cron → pg_net → edge function poller → ingest_result)",
);
await setClock("2026-10-21 20:00+00");
let settled: { match_no: number; status: string; winner_id: string }[] = [];
for (let i = 0; i < 40 && settled.length < 2; i++) {
  await Bun.sleep(5000);
  settled = must(
    await anon
      .from("matches")
      .select("match_no, status, winner_id")
      .in("match_no", [1, 2])
      .neq("status", "scheduled"),
    "settled",
  );
}
claim(
  settled.length === 2,
  "within the next cron minute both quarter-finals are settled (no person involved)",
  settled,
);
const log = await db.unsafe(
  `select provider, outcome from public.result_log where outcome = 'settled' order by id`,
);
claim(
  log.length === 2 && log.every((r: { provider: string }) => r.provider === "fixture"),
  "result_log holds the two provider payloads that settled them",
);
const sf = must(
  await anon
    .from("matches")
    .select("match_no, p2_id, p2_win_points")
    .in("match_no", [3, 4])
    .order("match_no"),
  "sf",
);
claim(
  sf[0]?.p2_id === "f" && sf[1]?.p2_id === "d",
  "the semi-finals opened with the winners (F, D)",
  sf,
);

section("6. Results and leaderboard: the stored breakdown, no prizes");
const mine = must(
  await fan
    .from("picks")
    .select("match_no, pts_winner, pts_sets, pts_exact, pts_total")
    .order("match_no"),
  "picks",
);
for (const p of mine)
  console.log(
    `      match ${p.match_no}: winner ${p.pts_winner} + sets ${p.pts_sets} + exact ${p.pts_exact} = ${p.pts_total}`,
  );
claim(
  mine[0]?.pts_total === 20 && mine[1]?.pts_total === 16,
  "QF1 20 (upset 10 + 4 + 6), QF2 16 (8 + 4 + 4)",
  mine,
);
const board = must(
  await fan.rpc("get_leaderboard", { p_league: null, p_offset: 0, p_limit: 10 }),
  "board",
) as { pos: number; display_name: string; points: number; is_me: boolean }[];
claim(
  board[0]?.is_me === true && board[0].points === 36 && board[0].display_name === "Fan One",
  "the fan leads the global board with 36",
  board,
);
const cfg = must(await anon.from("event_config").select("prizes"), "config")[0] as {
  prizes: unknown[];
};
claim(cfg.prizes.length === 0, "no prizes: bragging rights only (0019)", cfg.prizes);

section("7. Billing: the fan is a qualified fan (service role only)");
claim((await fan.rpc("billing_report")).error !== null, "billing_report is refused to the fan");
const report = must(await service.rpc("billing_report"), "billing") as {
  registered: number;
  verified: number;
  qualified: number;
};
claim(
  // verified 2: the fan, and the owner who proved the squatted address in section 2
  report.qualified === 1 && report.verified === 2,
  `billing_report: registered ${report.registered}, verified ${report.verified}, qualified ${report.qualified}`,
  report,
);

console.log(`\n${n} claims, all true, on the real local Supabase stack.`);
await db.close();
