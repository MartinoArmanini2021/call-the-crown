// Q4 — test and staff accounts (profiles.is_test, profiles.is_staff) never appear in public rankings,
// crew boards, crowd percentages or rarity shares; and they never consume a rank number, change a
// league table or the leaderboard's total (full-debug brief, Part 2, section Q4).
// Every function a signed-in fan can call is exercised as a fan (role authenticated), on PGlite.
// Tests named "BUG" FAIL today on purpose. Proposed fix (Rule 4, touches recompute_standings):
// tests/verify/proposed/q-test-accounts.patch
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { as, freshDb, one, uid, type Row } from "./_db";

const FANS = [1, 2, 3, 4];
const TEST = 90; // is_test
const STAFF = 91; // is_staff
const HIDDEN = [uid(TEST), uid(STAFF)];
const fan1 = { uid: uid(1) };

let db: PGlite;
let leagueId: string;

beforeAll(async () => {
  db = await freshDb();
  await db.exec("select t.setup_event()"); // QF1 c(3) v f(10), QF2 d(5) v e(7); clock 20 Oct
  for (const n of [...FANS, TEST, STAFF]) await db.query("select t.new_user($1)", [n]);
  // flagged by the operator, as the README says (update profiles set is_staff / is_test)
  await db.exec(`update public.profiles set is_test = true where user_id = t.uid(${TEST});
                 update public.profiles set is_staff = true where user_id = t.uid(${STAFF});`);
  // The hidden accounts call QF1 perfectly (top of the table); real fans are spread below them.
  const picks: [number, string, string][] = [
    [TEST, "c", "6-4 6-4"],
    [STAFF, "c", "6-4 6-4"],
    [1, "c", "6-4 6-3"],
    [2, "c", "6-3 6-3"],
    [3, "f", "4-6 4-6"],
    [4, "f", "4-6 6-4 4-6"],
  ];
  for (const [n, w, s] of picks)
    expect(await one(db, "select t.pick(t.uid($1), 1, $2, $3)", [n, w, s])).toBeNull();
  // a friends league: fan 1 owns it, the test account joins it
  const r = await db.exec(
    `begin; select t.as_user('${uid(1)}'); select public.create_league('Q4 league') as r; commit;`,
  );
  const league = (r[2]!.rows[0] as { r: { id: string; code: string } }).r;
  leagueId = league.id;
  await db.exec(
    `begin; select t.as_user('${uid(TEST)}'); select public.join_league('${league.code}'); commit;`,
  );
  await db.exec(
    `begin; select t.as_user('${uid(2)}'); select public.join_league('${league.code}'); commit;`,
  );
  // QF1 is played and settled
  await db.exec("select public.dev_set_now('2026-10-21 20:00+00')");
  await db.exec("select t.feed(1, 'completed', 'c', '6-4 6-4')");
}, 120_000);
afterAll(async () => db?.close());

const ids = (rows: Row[]) => rows.map((r) => r["user_id"] as string);

describe("Q4 what this branch has", () => {
  test("no crew board and no rarity shares exist on build/phase-1 (nothing to check there)", async () => {
    const fns = (
      await db.query<{ proname: string }>(
        "select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
      )
    ).rows.map((r) => r.proname);
    expect(fns.filter((f) => /crew|rarity|my_call|badge/.test(f))).toEqual([]);
  });

  test("the fixture is what it claims: two hidden accounts flagged, both scored top", async () => {
    expect(
      await one(db, "select count(*)::int from public.profiles where is_test or is_staff"),
    ).toBe(2);
    expect(await one(db, "select t.pts(t.uid($1), 1)", [TEST])).toBe("8/4/4/16");
  });
});

describe("Q4 global standings (get_leaderboard, get_rank_window), as a signed-in fan", () => {
  test("BUG the global leaderboard lists no test or staff account", async () => {
    const rows = await as(db, fan1, "select * from public.get_leaderboard(null, 0, 50)");
    expect(ids(rows).filter((u) => HIDDEN.includes(u))).toEqual([]);
  });

  test("BUG real fans are numbered 1..n with no rank taken by a hidden account", async () => {
    const rows = await as(db, fan1, "select * from public.get_leaderboard(null, 0, 50)");
    const real = rows.filter((r) => !HIDDEN.includes(r["user_id"] as string));
    expect(real.map((r) => r["global_rank"])).toEqual([1, 2, 3, 4]); // today: [3, 4, 5, 6]
  });

  test("BUG the leaderboard's total counts real fans only", async () => {
    const rows = await as(db, fan1, "select * from public.get_leaderboard(null, 0, 1)");
    expect(rows[0]?.["total"]).toBe(FANS.length); // today: 6
  });

  test("BUG 'my rank ± 5' shows no hidden account and the fan's rank among real fans", async () => {
    const rows = await as(db, fan1, "select * from public.get_rank_window(null, 5)");
    expect(ids(rows).filter((u) => HIDDEN.includes(u))).toEqual([]);
    expect(rows.find((r) => r["is_me"])?.["global_rank"]).toBe(1); // fan 1 is the best real fan
  });

  test("BUG a test account created after a result gets no rank number (rank_new_fan)", async () => {
    await db.exec(
      `select t.new_user(92); update public.profiles set is_test = true where user_id = t.uid(92);`,
    );
    expect(await one(db, "select rank from public.standings where user_id = t.uid(92)")).toBeNull();
  });
});

describe("Q4 friends league table, as a member", () => {
  test("BUG the league table lists no test account and its total counts real members", async () => {
    const rows = await as(db, fan1, `select * from public.get_leaderboard('${leagueId}', 0, 50)`);
    expect(ids(rows).filter((u) => HIDDEN.includes(u))).toEqual([]);
    expect(rows.map((r) => r["pos"])).toEqual([1, 2]);
    expect(rows[0]?.["total"]).toBe(2);
  });

  // Reported, not asserted as a bug: a member sees every member's picks of a started match with names
  // (get_league_picks), the member list (league_members) and my_leagues.member_count, test accounts
  // included. A test account is only there if someone joined it on purpose.
  test("record: get_league_picks and my_leagues.member_count include the test member", async () => {
    const picks = await as(db, fan1, `select * from public.get_league_picks('${leagueId}', 1)`);
    expect(ids(picks)).toContain(uid(TEST));
    const mine = await as(db, fan1, "select * from public.my_leagues()");
    expect(mine[0]?.["member_count"]).toBe(3);
  });
});

describe("Q4 crowd shares (get_match_crowd) and the raw picks table", () => {
  test("BUG 'How fans picked' counts real fans' picks only", async () => {
    const [c] = await as(db, fan1, "select * from public.get_match_crowd(1)");
    // real fans: 2 on c (fans 1, 2), 2 on f (fans 3, 4) → 50.0% / 50.0%; today 4 v 2 = 66.7% / 33.3%
    expect({ picks: c?.["picks"], p1: c?.["p1_picks"], p2: c?.["p2_picks"] }).toEqual({
      picks: 4,
      p1: 2,
      p2: 2,
    });
  });

  test("BUG the picks policy hands a fan the hidden accounts' picks of a started match", async () => {
    const rows = await as(db, fan1, "select user_id from public.picks where match_no = 1");
    expect(ids(rows).filter((u) => HIDDEN.includes(u))).toEqual([]); // see also K7: everyone's picks
  });
});
