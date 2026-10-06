// Section N4 through the real API (PostgREST behind the local gateway, http://127.0.0.1:55321), as a
// signed-in fan: type coercion, oversized bodies, extra/foreign ids, direct table writes.
// Shared stack: every call here is built to be refused BEFORE save_pick writes anything (unknown match
// 99, a type error, a missing grant), so it does not depend on, or change, the shared event or clock.
// One throwaway user (n-<tag>@example.test) is created and deleted in afterAll.
//   bun test tests/verify/n/api-tamper.test.ts      (skips itself when the stack is not up)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SQL } from "bun";

const API = "http://127.0.0.1:55321";
const DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const up = await fetch(`${API}/rest/v1/`, { signal: AbortSignal.timeout(3000) }).then(
  () => true,
  () => false,
);

let st: { ANON_KEY: string; SERVICE_ROLE_KEY: string };
let service: SupabaseClient;
let fan: SupabaseClient;
let token = "";
let userId = "";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function raw(body: string, auth = true) {
  const t0 = performance.now();
  const r = await fetch(`${API}/rest/v1/rpc/save_pick`, {
    method: "POST",
    headers: {
      apikey: st.ANON_KEY,
      Authorization: `Bearer ${auth ? token : st.ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 300), ms: Math.round(performance.now() - t0) };
}
const S2 = '[{"p1_games":6,"p2_games":4},{"p1_games":6,"p2_games":4}]';

describe.skipIf(!up)("N4 tampered save_pick through the API", () => {
  beforeAll(async () => {
    const out = await new Response(
      Bun.spawn(["bunx", "supabase", "status", "-o", "json"], { stderr: "ignore" }).stdout,
    ).text();
    st = JSON.parse(out.slice(out.indexOf("{")));
    service = createClient(API, st.SERVICE_ROLE_KEY, opts);
    const email = `n-${Date.now() % 1_000_000}@example.test`;
    const pw = crypto.randomUUID(); // test-only, never printed
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { display_name: "N Fan" },
    });
    if (error) throw error;
    userId = data.user.id;
    fan = createClient(API, st.ANON_KEY, opts);
    const s = await fan.auth.signInWithPassword({ email, password: pw });
    if (s.error) throw s.error;
    token = s.data.session!.access_token;
  }, 60_000);
  afterAll(async () => {
    if (userId) await service.auth.admin.deleteUser(userId);
  });

  test('a number sent as a string is coerced ("99" reaches the body: no_such_match)', async () => {
    const r = await raw(`{"p_match":"99","p_winner":"c","p_sets":"2","p_set_scores":${S2}}`);
    expect(r.status).toBe(400);
    expect(r.body).toContain("no_such_match");
  });
  test("a non-numeric string for an int is a type error before the body runs", async () => {
    const r = await raw(`{"p_match":"one","p_winner":"c","p_sets":2,"p_set_scores":${S2}}`);
    expect(r.status).toBe(400);
    expect(r.body).toContain("22P02");
  });
  test("an int overflow is a type error", async () => {
    const r = await raw(`{"p_match":99999999999,"p_winner":"c","p_sets":2,"p_set_scores":${S2}}`);
    expect(r.status).toBe(400);
    expect(r.body).toMatch(/22003|out of range/);
  });
  test("an extra p_user parameter (acting for another fan) finds no function", async () => {
    const r = await raw(
      `{"p_match":99,"p_winner":"c","p_sets":2,"p_set_scores":${S2},"p_user":"00000000-0000-0000-0000-000000000001"}`,
    );
    expect(r.status).toBe(404);
    expect(r.body).toContain("PGRST202");
  });
  test("null fields are refused by the body (no_such_match first)", async () => {
    const r = await raw(`{"p_match":null,"p_winner":null,"p_sets":null,"p_set_scores":null}`);
    expect(r.status).toBe(400);
    expect(r.body).toContain("no_such_match");
  });
  test("anon (no session) cannot call save_pick", async () => {
    const r = await raw(`{"p_match":99,"p_winner":"c","p_sets":2,"p_set_scores":${S2}}`, false);
    expect([401, 403]).toContain(r.status);
    expect(r.body).toMatch(/42501|permission denied/);
  });
  test("1 MB and 10 MB bodies: refused cheaply, the gateway does not crash", async () => {
    const one = JSON.stringify(
      Array.from({ length: 40_000 }, () => ({ p1_games: 6, p2_games: 4 })),
    );
    const ten = JSON.stringify(
      Array.from({ length: 400_000 }, () => ({ p1_games: 6, p2_games: 4 })),
    );
    const r1 = await raw(`{"p_match":99,"p_winner":"c","p_sets":2,"p_set_scores":${one}}`);
    const r10 = await raw(`{"p_match":99,"p_winner":"c","p_sets":2,"p_set_scores":${ten}}`);
    console.log(
      "N4 oversized",
      JSON.stringify({
        oneMB: { ...r1, body: r1.body.slice(0, 80), bytes: one.length },
        tenMB: { ...r10, body: r10.body.slice(0, 80), bytes: ten.length },
      }),
    );
    expect(r1.status).toBe(400);
    expect(r1.body).toContain("no_such_match");
    expect([400, 413]).toContain(r10.status);
    const ok = await raw(`{"p_match":99,"p_winner":"c","p_sets":2,"p_set_scores":${S2}}`);
    expect(ok.body).toContain("no_such_match"); // still serving
  }, 60_000);
  test("a fan cannot insert a pick directly, for themselves or for another fan", async () => {
    const mine = await fan
      .from("picks")
      .insert({ user_id: userId, match_no: 1, winner_id: "c", sets: 2, set_scores: [] });
    const other = await fan.from("picks").insert({
      user_id: "00000000-0000-0000-0000-000000000001",
      match_no: 1,
      winner_id: "c",
      sets: 2,
      set_scores: [],
    });
    expect(mine.error?.code).toBe("42501");
    expect(other.error?.code).toBe("42501");
    const db = new SQL(DB, { max: 1 });
    try {
      const [r] =
        await db`select count(*)::int as n from public.picks where user_id = ${userId}::uuid`;
      expect(r.n).toBe(0);
    } finally {
      await db.close();
    }
  });
});
