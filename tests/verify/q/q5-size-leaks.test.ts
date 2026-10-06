// Q5 — size leaks: every place a count of users, picks, leagues or members reaches the browser
// (full-debug brief, Part 2, section Q5). These are for a decision by Tino, not bugs, so the tests
// are CHARACTERISATION tests: they PASS today and each shows the exact number a signed-in fan can
// read. If a leak is closed on purpose, its test fails and should be inverted.
// The last block locks in the whole anon/authenticated surface: a new grant fails it, so every new
// function or table is reviewed for leaks before it ships.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, as, freshDb, one, uid } from "./_db";

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const N = 7; // fans in the fixture
const fan1 = { uid: uid(1) };
let db: PGlite;
let league: { id: string; code: string };

beforeAll(async () => {
  db = await freshDb();
  await db.exec("select t.setup_event()");
  for (let n = 1; n <= N; n++) await db.query("select t.new_user($1)", [n]);
  // every fan picks QF1: odd fans C 6-4 6-4 (4 fans), even fans F 4-6 4-6 (3 fans)
  for (let n = 1; n <= N; n++) {
    const [w, s] = n % 2 ? ["c", "6-4 6-4"] : ["f", "4-6 4-6"];
    expect(await one(db, "select t.pick(t.uid($1), 1, $2, $3)", [n, w, s])).toBeNull();
  }
  const r = await db.exec(
    `begin; select t.as_user('${uid(1)}'); select public.create_league('Q5') as r; commit;`,
  );
  league = (r[2]!.rows[0] as { r: { id: string; code: string } }).r;
  for (const n of [2, 3])
    await db.exec(
      `begin; select t.as_user('${uid(n)}'); select public.join_league('${league.code}'); commit;`,
    );
}, 120_000);
afterAll(async () => db?.close());

describe("Q5 before the first result", () => {
  test("no global rank or total is served before any settlement", async () => {
    expect(await as(db, fan1, "select * from public.get_leaderboard(null, 0, 1)")).toEqual([]);
  });

  test("not a leak: before the start a fan reads only their own picks", async () => {
    expect(await as(db, fan1, "select count(*)::int as n from public.picks")).toEqual([{ n: 1 }]);
  });
});

describe("Q5 after the first ball and the first result (each test: a number a fan can read)", () => {
  beforeAll(async () => {
    await db.exec("select public.dev_set_now('2026-10-21 16:31+00')"); // QF1 started, not settled
  });

  test("LEAK picks table (RLS policy 0003_rls.sql:34): count(*) of a started match = players who picked it", async () => {
    expect(
      await as(db, fan1, "select count(*)::int as n from public.picks where match_no = 1"),
    ).toEqual([{ n: N }]);
    // and who: user_id + updated_at of every pick, joinable to names through get_leaderboard
    expect(
      await as(db, fan1, "select count(distinct user_id)::int as n from public.picks"),
    ).toEqual([{ n: N }]);
  });

  test("LEAK get_match_crowd (0012_match_crowd.sql:24): exact counts, no minimum, from the first ball", async () => {
    const [c] = await as(db, fan1, "select * from public.get_match_crowd(1)");
    expect(c?.["picks"]).toBe(N);
    expect((c?.["p1_picks"] as number) + (c?.["p2_picks"] as number)).toBe(N);
    expect([c?.["p1_picks"], c?.["p2_picks"], c?.["top_count"]]).toEqual([4, 3, 4]);
  });

  test("UI shows the crowd count and 0.1% shares (ResultCard.tsx:127, 157-159, 172-175)", () => {
    const card = read("src", "components", "ResultCard.tsx");
    expect(card).toContain('t("crowd_picks", { n: crowd.picks.toLocaleString("en-GB") })');
    expect(card).toContain("((n / of) * 100).toFixed(1)");
  });

  test("LEAK get_leaderboard.total (0005_user_rpcs.sql:378) = every ranked account; last rank = the same", async () => {
    await db.exec("select public.dev_set_now('2026-10-21 20:00+00')");
    await db.exec("select t.feed(1, 'completed', 'c', '6-4 6-4')");
    const [row] = await as(db, fan1, "select * from public.get_leaderboard(null, 0, 1)");
    expect(row?.["total"]).toBe(N);
    const last = await as(
      db,
      fan1,
      `select max(global_rank)::int as r from public.get_leaderboard(null, 0, 100)`,
    );
    expect(last).toEqual([{ r: N }]);
  });

  test("UI shows the total: Standings 'x–y of N' (standings.tsx:79, 192-194) and Results 'rank of N' (results.tsx:44-46, 59)", () => {
    expect(read("src", "routes", "standings.tsx")).toContain(
      't("page_of", { from: (page - 1) * PAGE + 1, to: Math.min(page * PAGE, total), total })',
    );
    expect(read("src", "routes", "results.tsx")).toContain(
      'of={me?.global_rank && ranked ? ranked.toLocaleString("en-GB") : null}',
    );
  });

  test("LEAK rank_new_fan (0017_rank_new_fans.sql:21): a new account's own rank = the number of accounts", async () => {
    await db.query("select t.new_user($1)", [N + 1]);
    const mine = await as(
      db,
      { uid: uid(N + 1) },
      "select global_rank from public.get_rank_window(null, 1) where is_me",
    );
    expect(mine).toEqual([{ global_rank: N + 1 }]);
  });

  test("LEAK league size: my_leagues.member_count (0005:253), league_members rows (0003:59), league total (0005:388)", async () => {
    expect(
      (await as(db, fan1, "select member_count from public.my_leagues()"))[0]?.["member_count"],
    ).toBe(3);
    expect(await as(db, fan1, "select count(*)::int as n from public.league_members")).toEqual([
      { n: 3 },
    ]);
    expect(
      (await as(db, fan1, `select total from public.get_leaderboard('${league.id}', 0, 1)`))[0]?.[
        "total"
      ],
    ).toBe(3);
    expect(read("src", "routes", "standings.tsx")).toContain(
      't("members", { n: league.member_count })',
    );
  });

  test("LEAK get_league_picks (0005:431): one row per member who picked = the league's pickers", async () => {
    expect(
      await as(
        db,
        fan1,
        `select count(*)::int as n from public.get_league_picks('${league.id}', 1)`,
      ),
    ).toEqual([{ n: 3 }]);
  });

  test("not a leak: anon reads nothing that counts people (only event_config, players, matches)", async () => {
    for (const q of [
      "select public.get_leaderboard(null, 0, 1)",
      "select public.get_match_crowd(1)",
      "select public.get_rank_window(null, 5)",
      "select public.my_leagues()",
      "select count(*) from public.picks",
      "select count(*) from public.league_members",
      "select count(*) from public.profiles",
    ]) {
      const [r] = await as(db, "anon", `select t.err($q$${q}$q$) as e`);
      expect(String(r?.["e"]), q).toContain("permission denied");
    }
  });
});

describe("Q5 lock-in: the whole surface a browser can reach (review any change for leaks)", () => {
  test("functions executable by anon / authenticated", async () => {
    const rows = (
      await db.query<{ fn: string; anon: boolean }>(`
        select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and (has_function_privilege('anon', p.oid, 'EXECUTE')
                or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         order by 1`)
    ).rows;
    expect(rows.filter((r) => r.anon).map((r) => r.fn)).toEqual(["app_now()"]);
    expect(rows.map((r) => r.fn)).toEqual([
      "app_now()",
      "create_league(p_name text)",
      "delete_account()",
      "delete_league(p_league uuid)",
      "get_leaderboard(p_league uuid, p_offset integer, p_limit integer)",
      "get_league_picks(p_league uuid, p_match integer)",
      "get_match_crowd(p_match integer)",
      "get_rank_window(p_league uuid, p_radius integer)",
      "join_league(p_code text)",
      "leave_league(p_league uuid)",
      "my_league_ids()",
      "my_leagues()",
      "remove_member(p_league uuid, p_user uuid)",
      "save_pick(p_match integer, p_winner text, p_sets integer, p_set_scores jsonb)",
      "update_consents(p_organiser boolean, p_gsgm boolean, p_text_version text)",
      "update_profile(p_display_name text, p_locale text)",
    ]);
  });

  test("tables readable by anon / authenticated (no write grant anywhere)", async () => {
    const rows = (
      await db.query<{ t: string; who: string; priv: string }>(`
        select c.relname t, r.who, pr.priv
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          cross join (values ('anon'), ('authenticated')) r(who)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(priv)
         where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
           and has_table_privilege(r.who, c.oid, pr.priv)
         order by 1, 2, 3`)
    ).rows.map((r) => `${r.t}:${r.who}:${r.priv}`);
    expect(rows).toEqual([
      "consents:authenticated:SELECT",
      "event_config:anon:SELECT",
      "event_config:authenticated:SELECT",
      "league_members:authenticated:SELECT",
      "leagues:authenticated:SELECT",
      "matches:anon:SELECT",
      "matches:authenticated:SELECT",
      "picks:authenticated:SELECT",
      "players:anon:SELECT",
      "players:authenticated:SELECT",
      "profiles:authenticated:SELECT",
    ]);
  });

  test("every src/ query goes through src/lib/api.ts (one place to review)", () => {
    const api = read("src", "lib", "api.ts");
    // table reads (supabase … .from("x")), not the storage bucket (storage.from("event"))
    const tables = [...api.matchAll(/(?<!storage)\.from\("(\w+)"\)/g)].map((m) => m[1]).sort();
    const rpcs = [...api.matchAll(/rpc<[^>]*>\("(\w+)"/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(["consents", "event_config", "matches", "picks", "players", "profiles"]);
    expect(rpcs).toEqual([
      "app_now",
      "create_league",
      "delete_account",
      "delete_league",
      "get_leaderboard",
      "get_leaderboard",
      "get_match_crowd",
      "get_rank_window",
      "join_league",
      "leave_league",
      "my_leagues",
      "remove_member",
      "save_pick",
      "update_consents",
      "update_profile",
    ]);
  });
});
