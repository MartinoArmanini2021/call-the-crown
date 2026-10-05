/* eslint-disable @typescript-eslint/no-explicit-any -- audit harness: Playwright/Deno handles */
// O4: who can trigger poll-results (and the SQL that starts it) on the REAL local stack.
// Read-only towards the shared event: the service-role call is made only when no match is due (then the
// poller writes its "no match in its window" heartbeat and nothing else, exactly what the cron does every
// minute). Creates one test user o-poller-<ts>@example.test and deletes it at the end.
// Skipped when the local stack is not running.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { createHmac } from "node:crypto";
import { dueMatches } from "../../../supabase/functions/poll-results/due.ts";

type Status = {
  API_URL: string;
  FUNCTIONS_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  PUBLISHABLE_KEY?: string;
  SECRET_KEY?: string;
  DB_URL: string;
};
let st: Status | null = null;
try {
  const p = Bun.spawnSync(["bunx", "supabase", "status", "-o", "json"], {
    cwd: `${import.meta.dir}/../../..`,
    stderr: "ignore",
  });
  st = JSON.parse(p.stdout.toString()) as Status;
} catch {
  st = null;
}
const d = st ? describe : describe.skip;

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const forge = (payload: object, secret: string) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const call = async (auth: string | null, apikey?: string) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers.Authorization = `Bearer ${auth}`;
  if (apikey) headers.apikey = apikey;
  const r = await fetch(`${st!.FUNCTIONS_URL}/poll-results`, {
    method: "POST",
    headers,
    body: "{}",
  });
  return { status: r.status, body: await r.text() };
};

let userId = "";
let userJwt = "";
const email = `o-poller-${Date.now()}@example.test`;

d("O4 poll-results: who may run it", () => {
  beforeAll(async () => {
    const password = crypto.randomUUID() + "Aa1!";
    const admin = {
      apikey: st!.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${st!.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };
    const created = (await (
      await fetch(`${st!.API_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ email, password, email_confirm: true }),
      })
    ).json()) as any;
    userId = created.id;
    const tok = (await (
      await fetch(`${st!.API_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: st!.ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
    ).json()) as any;
    userJwt = tok.access_token;
  });
  afterAll(async () => {
    if (userId) {
      await fetch(`${st!.API_URL}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { apikey: st!.SERVICE_ROLE_KEY, Authorization: `Bearer ${st!.SERVICE_ROLE_KEY}` },
      });
    }
  });

  it("no Authorization header: 401", async () => {
    expect((await call(null)).status).toBe(401);
  });
  it("anon key: 401", async () => {
    expect((await call(st!.ANON_KEY, st!.ANON_KEY)).status).toBe(401);
  });
  it("publishable key (sb_publishable_…): 401", async () => {
    if (!st!.PUBLISHABLE_KEY) return;
    expect((await call(st!.PUBLISHABLE_KEY, st!.PUBLISHABLE_KEY)).status).toBe(401);
  });
  it("a signed-in fan's JWT: 401", async () => {
    expect(userJwt).toBeTruthy();
    expect((await call(userJwt, st!.ANON_KEY)).status).toBe(401);
  });
  it("a forged service_role JWT (wrong secret) and an alg:none token: 401 (the gateway verifies signatures)", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      (
        await call(
          forge({ role: "service_role", iss: "supabase-demo", exp: now + 600 }, "not-the-secret"),
        )
      ).status,
    ).toBe(401);
    const none = `${b64u(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64u(JSON.stringify({ role: "service_role", exp: now + 600 }))}.`;
    expect((await call(none)).status).toBe(401);
  });
  it("INFO: the new-format secret key (sb_secret_…) is refused too: Vault must hold the legacy service_role JWT", async () => {
    if (!st!.SECRET_KEY) return;
    const r = await call(st!.SECRET_KEY, st!.SECRET_KEY);
    console.log(`[O4] sb_secret_ key → HTTP ${r.status} ${r.body.slice(0, 120)}`);
    expect(r.status).toBe(401);
  });
  it("the service_role JWT runs it (only checked when no match is due, so nothing is fetched or ingested)", async () => {
    const sql = new SQL(st!.DB_URL);
    try {
      const now = (await sql`select public.app_now()::text as n`)[0].n as string;
      const ms =
        await sql`select match_no, starts_at::text, status, refetch_requested_at::text, settled_at::text from public.matches`;
      if (dueMatches(ms as any, Date.parse(now)).length > 0) {
        console.log(
          "[O4] a match is due on the shared stack: service-role call skipped to avoid ingesting",
        );
        return;
      }
      const before = (await sql`select count(*)::int as n from public.result_log`)[0].n;
      const r = await call(st!.SERVICE_ROLE_KEY, st!.SERVICE_ROLE_KEY);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ ok: true, outcomes: [] });
      expect((await sql`select count(*)::int as n from public.result_log`)[0].n).toBe(before);
    } finally {
      await sql.close();
    }
  });
  it("the SQL entry points (kick_poller, request_refetch, ingest_result, watchdog) are not callable through the API by anon or a fan", async () => {
    for (const [key, bearer] of [
      [st!.ANON_KEY, st!.ANON_KEY],
      [st!.ANON_KEY, userJwt],
    ] as const) {
      for (const [fn, body] of [
        ["kick_poller", {}],
        ["request_refetch", { p_match: 1 }],
        ["ingest_result", { p_provider: "wikipedia", p_normalised: {}, p_raw: {} }],
        ["watchdog", {}],
        ["ingest_heartbeat", { p_ok: true, p_detail: "x" }],
      ] as const) {
        const r = await fetch(`${st!.API_URL}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        expect({ fn, refused: [401, 403, 404].includes(r.status) }).toEqual({ fn, refused: true });
      }
    }
  });
});
