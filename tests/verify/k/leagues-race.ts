// Old-audit leads re-checked on the REAL local stack (real Postgres concurrency through PostgREST):
//   F-11 parallel create/join past the 10-league cap; F-10 a removed member rejoins; S-20 the wrong-code
//   throttle is per account in a fixed window.
//   bun tests/verify/k/leagues-race.ts
// Invented accounts only (k-race-<n>-<tag>@example.test), deleted at the end. Never touches the clock.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SQL } from "bun";

const API = "http://127.0.0.1:55321";
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
const db = new SQL("postgresql://postgres:postgres@127.0.0.1:55322/postgres");
const tag = Date.now() % 1_000_000;
const pw = crypto.randomUUID();
const made: string[] = [];

async function user(n: number): Promise<{ id: string; c: SupabaseClient }> {
  const email = `k-race-${n}-${tag}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
  });
  if (error) throw error;
  made.push(data.user.id);
  const c = createClient(API, st.ANON_KEY, opts);
  const s = await c.auth.signInWithPassword({ email, password: pw });
  if (s.error) throw s.error;
  return { id: data.user.id, c };
}
const memberships = async (uid: string) =>
  (
    (await db.unsafe(
      `select count(*)::int n from public.league_members where user_id = '${uid}'`,
    )) as { n: number }[]
  )[0]!.n;

const out: Record<string, unknown> = {};
try {
  // F-11: 9 leagues, then 6 creations at once → must end at 10.
  const trials: number[] = [];
  for (let trial = 0; trial < 5; trial++) {
    const u = await user(100 + trial);
    for (let i = 0; i < 9; i++) await u.c.rpc("create_league", { p_name: `k ${i}` });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => u.c.rpc("create_league", { p_name: `k race ${i}` })),
    );
    trials.push(await memberships(u.id));
  }
  out["F-11 parallel creates, memberships after (cap 10)"] = trials;

  // F-11 mixed: 9 leagues, then 3 joins + 3 creates at once.
  const host = await user(200);
  const codes: string[] = [];
  for (let i = 0; i < 3; i++)
    codes.push(
      ((await host.c.rpc("create_league", { p_name: `host ${i}` })).data as { code: string }).code,
    );
  const mixed: number[] = [];
  for (let trial = 0; trial < 3; trial++) {
    const u = await user(210 + trial);
    for (let i = 0; i < 9; i++) await u.c.rpc("create_league", { p_name: `k ${i}` });
    await Promise.all([
      ...codes.map((code) => u.c.rpc("join_league", { p_code: code })),
      ...[0, 1, 2].map((i) => u.c.rpc("create_league", { p_name: `k mix ${i}` })),
    ]);
    mixed.push(await memberships(u.id));
  }
  out["F-11 parallel joins + creates, memberships after (cap 10)"] = mixed;

  // F-10: remove, then rejoin with the same code.
  const owner = await user(300);
  const member = await user(301);
  const lg = (await owner.c.rpc("create_league", { p_name: "k removal" })).data as {
    id: string;
    code: string;
  };
  await member.c.rpc("join_league", { p_code: lg.code });
  const rm = await owner.c.rpc("remove_member", { p_league: lg.id, p_user: member.id });
  const rejoin = await member.c.rpc("join_league", { p_code: lg.code });
  out["F-10 remove error"] = rm.error?.message ?? null;
  out["F-10 rejoin answer"] = rejoin.data;
  // Can the removed member come back if the owner wants? (no un-remove path exists)
  out["F-10 removed member visible to owner afterwards"] = (
    await owner.c.from("league_members").select("user_id").eq("league_id", lg.id)
  ).data?.length;

  // S-20: 11 wrong codes from one account, then the next account starts fresh.
  const g1 = await user(400);
  const g2 = await user(401);
  const answers1: string[] = [];
  for (let i = 0; i < 11; i++)
    answers1.push(
      (
        (await g1.c.rpc("join_league", { p_code: `QQQQ${String(i).padStart(2, "2")}` })).data as {
          error: string;
        }
      ).error,
    );
  const a2 = ((await g2.c.rpc("join_league", { p_code: "QQQQ99" })).data as { error: string })
    .error;
  // A right code from a throttled account is refused too (so the throttle is not an oracle)
  const right = await g1.c.rpc("join_league", { p_code: lg.code });
  out["S-20 account 1, 11 wrong codes"] = answers1;
  out["S-20 account 2, first wrong code"] = a2;
  out["S-20 account 1 right code while throttled"] = right.data;
  // Concurrency on the throttle: 15 wrong codes at once from a fresh account
  const g3 = await user(402);
  const burst = await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      g3.c.rpc("join_league", { p_code: `WWWW${String(i).padStart(2, "3")}` }),
    ),
  );
  out["S-20 15 parallel wrong codes: answers"] = burst.map(
    (r) => (r.data as { error: string } | null)?.error ?? r.error?.message,
  );
  out["S-20 15 parallel wrong codes: stored fail count"] = (
    (await db.unsafe(`select join_fail_count from public.profiles where user_id = '${g3.id}'`)) as {
      join_fail_count: number;
    }[]
  )[0]?.join_fail_count;
} finally {
  for (const id of made) await service.auth.admin.deleteUser(id);
  const left = (await db.unsafe(
    `select count(*)::int n from auth.users where email like 'k-race-%-${tag}@example.test'`,
  )) as { n: number }[];
  out["cleanup: accounts left"] = left[0]!.n;
  console.log(JSON.stringify(out, null, 2));
  await db.close();
}
