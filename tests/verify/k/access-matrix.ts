// K2 access matrix on the REAL local stack (PostgREST + GoTrue + RLS), through supabase-js.
//   bun tests/verify/k/access-matrix.ts            → writes tests/verify/k/access-matrix.json and prints a table
// Creates two invented accounts (k-a-<n>@example.test, k-b-<n>@example.test) through the Auth admin API,
// gives them picks (QF1, QF2), a league (A owns, B joins), then for every public table and every caller
// (anon, A, B) tries select / insert / update / delete / upsert. Update and delete use a filter that
// matches nothing, so a refused privilege shows as 42501 and an allowed one changes no row.
// TRUNCATE has no PostgREST verb; it is tried with raw role switching inside a rolled-back transaction.
// Never touches the clock. Deletes its two accounts at the end (cascade removes their rows).
// Refuses to run against anything but 127.0.0.1.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SQL } from "bun";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "http://127.0.0.1:55321";
const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const st = JSON.parse(
  await (async () => {
    const t = await new Response(
      Bun.spawn(["bunx", "supabase", "status", "-o", "json"], { stderr: "ignore" }).stdout,
    ).text();
    return t.slice(t.indexOf("{"));
  })(),
) as { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string };
if (st.API_URL !== API) throw new Error("local stack only");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(API, st.SERVICE_ROLE_KEY, opts);
const anon = createClient(API, st.ANON_KEY, opts);
const db = new SQL(DB);
const tag = Date.now() % 1_000_000;
const pw = crypto.randomUUID(); // test-only password, never printed

async function makeUser(letter: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `k-${letter}-${tag}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
    user_metadata: { display_name: `K Fan ${letter.toUpperCase()}` },
  });
  if (error) throw error;
  const client = createClient(API, st.ANON_KEY, opts);
  const s = await client.auth.signInWithPassword({ email, password: pw });
  if (s.error) throw s.error;
  return { id: data.user.id, client };
}

const A = await makeUser("a");
const B = await makeUser("b");
const ss = (...p: [number, number][]) => p.map(([a, b]) => ({ p1_games: a, p2_games: b }));
const setup: Record<string, unknown> = {};
try {
  setup["A pick QF1"] =
    (
      await A.client.rpc("save_pick", {
        p_match: 1,
        p_winner: "c",
        p_sets: 2,
        p_set_scores: ss([6, 4], [6, 4]),
      })
    ).error?.message ?? "ok";
  setup["A pick QF2"] =
    (
      await A.client.rpc("save_pick", {
        p_match: 2,
        p_winner: "d",
        p_sets: 2,
        p_set_scores: ss([6, 3], [6, 3]),
      })
    ).error?.message ?? "ok";
  setup["B pick QF1"] =
    (
      await B.client.rpc("save_pick", {
        p_match: 1,
        p_winner: "f",
        p_sets: 2,
        p_set_scores: ss([4, 6], [4, 6]),
      })
    ).error?.message ?? "ok";
  const lg = await A.client.rpc("create_league", { p_name: "K audit league" });
  setup["A create league"] = lg.error?.message ?? "ok";
  const code = (lg.data as { code: string }).code;
  setup["B join league"] = JSON.stringify(
    (await B.client.rpc("join_league", { p_code: code })).data,
  );
  setup["app_now"] = (await anon.rpc("app_now")).data;

  const tables = (
    (await db.unsafe(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    )) as { relname: string }[]
  ).map((r) => r.relname);
  const cols = async (t: string) =>
    (
      (await db.unsafe(
        `select attname from pg_attribute where attrelid = 'public.${t}'::regclass and attnum > 0
            and not attisdropped and attidentity = '' and attgenerated = '' order by attnum`,
      )) as { attname: string }[]
    ).map((r) => r.attname);

  // A plausible row for an insert / upsert attempt (owned by the caller where there is a user column).
  const rowFor = (t: string, uid: string | null): Record<string, unknown> => {
    const u = uid ?? "00000000-0000-0000-0000-000000000000";
    switch (t) {
      case "picks":
        return { user_id: u, match_no: 3, winner_id: "a", sets: 2, set_scores: ss([6, 0], [6, 0]) };
      case "profiles":
        return { user_id: u, display_name: "Hacker", locale: "en" };
      case "consents":
        return { user_id: u, party: "organiser", granted: true, text_version: "x" };
      case "leagues":
        return { name: "Hack", code: "ZZZZZ9", owner_id: u };
      case "league_members":
      case "league_removals":
        return { league_id: "00000000-0000-0000-0000-000000000000", user_id: u };
      case "standings":
        return { user_id: u, points: 999 };
      case "activity_days":
        return { user_id: u, day: "2026-10-20" };
      case "event_config":
        return { id: true, name: "x", rules: {} };
      case "players":
        return { id: "zz", name: "Z", rank_snapshot: 1 };
      case "matches":
        return { match_no: 99, round: "F", p1_source: {}, p2_source: {} };
      case "provider_map":
        return { provider: "k", kind: "match", provider_ref: "k", our_ref: "1" };
      case "match_crowd":
        return { match_no: 6, picks: 1, p1_picks: 1, p2_picks: 0, top_count: 0 };
      case "result_log":
        return { provider: "k", outcome: "k" };
      case "billing_snapshots":
        return { report: {}, sha256: "x" };
      case "ops_health":
        return { key: "k", ok: true };
      case "ops_alerts":
        return { kind: "k" };
      case "dev_clock":
        return { id: true, shift: "0" };
      default:
        return {};
    }
  };

  type Cell = { allowed: boolean; detail: string };
  const verdict = (e: { code?: string; message: string } | null, extra = ""): Cell =>
    e
      ? { allowed: false, detail: `${e.code ?? ""} ${e.message}`.trim() }
      : { allowed: true, detail: extra };

  const callers: [string, SupabaseClient, string | null][] = [
    ["anon", anon, null],
    ["A", A.client, A.id],
    ["B", B.client, B.id],
  ];
  const matrix: Record<string, Record<string, Record<string, Cell>>> = {};
  for (const t of tables) {
    matrix[t] = {};
    const c = await cols(t);
    const first = c[0]!;
    for (const [who, cl, uid] of callers) {
      const m: Record<string, Cell> = {};
      // select: total visible rows, and rows that belong to someone else
      const sel = await cl.from(t).select("*");
      if (sel.error) m["select"] = verdict(sel.error);
      else {
        const rows = sel.data as Record<string, unknown>[];
        const others = c.includes("user_id")
          ? rows.filter((r) => r["user_id"] !== uid).length
          : c.includes("owner_id")
            ? rows.filter((r) => r["owner_id"] !== uid).length
            : null;
        m["select"] = {
          allowed: true,
          detail: `${rows.length} rows${others === null ? "" : `, ${others} of another account`}`,
        };
      }
      const ins = await cl.from(t).insert(rowFor(t, uid));
      m["insert"] = verdict(ins.error, "ROW INSERTED");
      const up = await cl
        .from(t)
        .update({ [first]: rowFor(t, uid)[first] ?? null })
        .eq(first, "__k_matches_nothing__");
      // a type error on the filter would hide the privilege check; retry with an always-false numeric/uuid-safe filter
      m["update"] =
        up.error && /^22/.test(up.error.code ?? "")
          ? verdict(
              (
                await cl
                  .from(t)
                  .update({ [first]: rowFor(t, uid)[first] ?? null })
                  .is(first, null)
              ).error,
              "allowed (0 rows)",
            )
          : verdict(up.error, "allowed (0 rows)");
      const del = await cl.from(t).delete().eq(first, "__k_matches_nothing__");
      m["delete"] =
        del.error && /^22/.test(del.error.code ?? "")
          ? verdict((await cl.from(t).delete().is(first, null)).error, "allowed (0 rows)")
          : verdict(del.error, "allowed (0 rows)");
      const ups = await cl.from(t).upsert(rowFor(t, uid));
      m["upsert"] = verdict(ups.error, "ROW UPSERTED");
      matrix[t]![who] = m;
    }
    // TRUNCATE: raw role switching, rolled back whatever happens
    for (const [who, , uid] of callers) {
      const conn = await db.reserve();
      let cell: Cell;
      try {
        await conn.unsafe("begin");
        await conn.unsafe("set local lock_timeout = '1s'");
        await conn.unsafe(
          `select set_config('request.jwt.claims', '${JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })}', true)`,
        );
        await conn.unsafe(`set local role ${uid ? "authenticated" : "anon"}`);
        await conn.unsafe(`truncate public.${t}`);
        cell = { allowed: true, detail: "TRUNCATE ran (rolled back)" };
      } catch (e) {
        cell = { allowed: false, detail: (e as Error).message };
      } finally {
        await conn.unsafe("rollback").catch(() => {});
        conn.release();
      }
      matrix[t]![who]!["truncate"] = cell;
    }
  }

  // K7 on the real stack (match 1 has not started on the shared clock): B reading A's pick.
  const k7 = {
    app_now: setup["app_now"],
    b_reads_a_picks_before_start: (
      await B.client.from("picks").select("match_no").eq("user_id", A.id)
    ).data?.length,
    b_count_on_match1_before_start: (
      await B.client.from("picks").select("*", { count: "exact", head: true }).eq("match_no", 1)
    ).count,
  };

  // Storage: the public "event" bucket must refuse uploads from anon and from a fan.
  const storage: Record<string, string> = {};
  for (const [who, cl] of callers) {
    const up = await cl.storage
      .from("event")
      .upload(`k-probe-${tag}-${who}.png`, new Blob(["k"], { type: "image/png" }), {
        contentType: "image/png",
      });
    storage[who] = up.error ? `refused: ${up.error.message}` : "UPLOADED";
    if (!up.error) await service.storage.from("event").remove([`k-probe-${tag}-${who}.png`]);
  }

  // GraphQL: what anon can see through pg_graphql (introspection of the query root).
  const gql = await fetch(`${API}/graphql/v1`, {
    method: "POST",
    headers: { apikey: st.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "{ __schema { queryType { fields { name } } mutationType { fields { name } } } }",
    }),
  }).then(
    (r) =>
      r.json() as Promise<{
        data?: {
          __schema: {
            queryType: { fields: { name: string }[] };
            mutationType: { fields: { name: string }[] } | null;
          };
        };
      }>,
  );

  const out = {
    generated: new Date().toISOString(),
    setup,
    matrix,
    k7,
    storage,
    graphql_anon: {
      query: gql.data?.__schema.queryType.fields.map((f) => f.name),
      mutation: gql.data?.__schema.mutationType?.fields.map((f) => f.name) ?? [],
    },
  };
  writeFileSync(join(import.meta.dir, "access-matrix.json"), JSON.stringify(out, null, 2));
  const ops = ["select", "insert", "update", "delete", "upsert", "truncate"];
  console.log(`| table | caller | ${ops.join(" | ")} |`);
  console.log(`| --- | --- | ${ops.map(() => "---").join(" | ")} |`);
  for (const [t, byWho] of Object.entries(matrix))
    for (const [who, m] of Object.entries(byWho))
      console.log(
        `| ${t} | ${who} | ${ops.map((o) => (m[o]!.allowed ? `**ALLOWED** ${m[o]!.detail}` : "denied")).join(" | ")} |`,
      );
  console.log(JSON.stringify({ setup, k7, storage, graphql_anon: out.graphql_anon }, null, 2));
  // every refusal reason, once, so a "denied" can be checked to be a privilege refusal
  const reasons = new Set<string>();
  for (const byWho of Object.values(matrix))
    for (const m of Object.values(byWho))
      for (const c of Object.values(m))
        if (!c.allowed) reasons.add(c.detail.replace(/ [a-z_]+$/, " <table>"));
  console.log([...reasons].join("\n"));
} finally {
  for (const u of [A, B]) await service.auth.admin.deleteUser(u.id);
  const left = await db.unsafe(
    `select count(*)::int n from auth.users where email like 'k-%-${tag}@example.test'`,
  );
  console.log(`cleanup: ${(left[0] as { n: number }).n} k- test accounts left`);
  await db.close();
}
