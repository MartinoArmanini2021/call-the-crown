// LOCAL DEV ONLY — a Docker-free stand-in for the parts of Supabase this app uses, so the app can be
// run and walked through on a machine without Docker. Never deployed; listens on 127.0.0.1 only.
// `supabase start` replaces it with no change to the app (same URL shape; set .env from `supabase status`).
//
// It runs the real migrations on an in-process Postgres (PGlite, scripts/lib/db.ts) and answers:
//   /auth/v1   otp · verify · token (refresh) · user · logout      (email codes, shown on /_dev)
//   /rest/v1   GET <table>?select=…&col=eq.v&order=col.asc · POST rpc/<fn>
//   /_dev      the operator console: simulated clock, poller, mailbox, billing report, alerts
// Every request runs as the caller's role (anon / authenticated) with its JWT claims, exactly like
// PostgREST, so RLS, grants and every RPC guard are the real ones.
//   bun run dev:backend
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { bootDb, ROOT } from "./lib/db";
import { pollAsService } from "./lib/poller";

const PORT = 55321;
const ANON_KEY = "local-dev-anon-key";
const SECRET = randomUUID(); // tokens die with the process, like the database
const db: PGlite = await bootDb();
await db.exec(readFileSync(join(ROOT, "supabase", "dev", "seed_local.sql"), "utf8"));

// ---------------------------------------------------------------------------------------------- JWT
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function sign(payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${b64url(createHmac("sha256", SECRET).update(`${head}.${body}`).digest())}`;
}
function verify(token: string): Record<string, unknown> | null {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const expected = createHmac("sha256", SECRET).update(`${h}.${b}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString()) as Record<string, unknown>;
  return typeof payload["exp"] === "number" && payload["exp"] * 1000 > Date.now() ? payload : null;
}
type Caller = { role: "anon" | "authenticated"; claims: Record<string, unknown> };
function caller(req: Request): Caller {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const claims = token && token !== ANON_KEY ? verify(token) : null;
  return claims ? { role: "authenticated", claims } : { role: "anon", claims: { role: "anon" } };
}
async function asCaller<T>(c: Caller, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c.claims)]);
    await tx.exec(`set local role ${c.role}`);
    return fn(tx);
  });
}

// --------------------------------------------------------------------------------------------- HTTP
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const pgError = (e: unknown) => {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  const status = err.code === "42501" ? 403 : 400;
  return json(
    {
      code: err.code ?? "XX000",
      message: err.message ?? String(e),
      details: err.detail ?? null,
      hint: err.hint ?? null,
    },
    status,
  );
};
const IDENT = /^[a-z_][a-z0-9_]*$/;

// ---------------------------------------------------------------------------------------------- auth
type Mail = { at: string; email: string; code: string };
const mailbox: Mail[] = [];
const codes = new Map<string, { code: string; exp: number }>();
const refreshTokens = new Map<string, string>(); // refresh token → user id

type UserRow = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  raw_user_meta_data: Record<string, unknown>;
  created_at: string;
};
const userById = async (id: string) =>
  (
    await db.query<UserRow>(
      "select id, email, email_confirmed_at::text, raw_user_meta_data, created_at::text from auth.users where id = $1",
      [id],
    )
  ).rows[0];
const userByEmail = async (email: string) =>
  (
    await db.query<UserRow>(
      "select id, email, email_confirmed_at::text, raw_user_meta_data, created_at::text from auth.users where lower(email) = lower($1)",
      [email],
    )
  ).rows[0];

const userJson = (u: UserRow) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  email_confirmed_at: u.email_confirmed_at,
  user_metadata: u.raw_user_meta_data,
  app_metadata: { provider: "email" },
  created_at: u.created_at,
});
function session(u: UserRow) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const refresh = randomUUID();
  refreshTokens.set(refresh, u.id);
  return {
    access_token: sign({
      sub: u.id,
      email: u.email,
      role: "authenticated",
      aud: "authenticated",
      exp,
    }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: refresh,
    user: userJson(u),
  };
}

async function handleAuth(req: Request, path: string, url: URL): Promise<Response> {
  if (path === "/auth/v1/otp" && req.method === "POST") {
    const body = (await req.json()) as {
      email?: string;
      data?: Record<string, unknown>;
      create_user?: boolean;
    };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json(
        { code: "validation_failed", msg: "Unable to validate email address: invalid format" },
        400,
      );
    if (!(await userByEmail(email))) {
      if (body.create_user === false)
        return json({ code: "otp_disabled", msg: "Signups not allowed for otp" }, 422);
      // Supabase Auth creates the account unconfirmed; the code confirms it. handle_new_user runs here.
      await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb)", [
        email,
        JSON.stringify(body.data ?? {}),
      ]);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    codes.set(email, { code, exp: Date.now() + 10 * 60_000 });
    mailbox.unshift({ at: new Date().toISOString(), email, code });
    console.log(`[mail] sign-in code for ${email}: ${code}`);
    return json({});
  }
  if (path === "/auth/v1/verify" && req.method === "POST") {
    const body = (await req.json()) as { email?: string; token?: string };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const entry = codes.get(email);
    if (!entry || entry.exp < Date.now() || entry.code !== String(body.token ?? "")) {
      return json({ code: "otp_expired", msg: "Token has expired or is invalid" }, 403);
    }
    codes.delete(email);
    await db.query(
      "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where lower(email) = $1",
      [email],
    );
    return json(session((await userByEmail(email))!));
  }
  if (path === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const body = (await req.json()) as { refresh_token?: string };
    const uid = refreshTokens.get(String(body.refresh_token ?? ""));
    const u = uid ? await userById(uid) : undefined;
    if (!u) return json({ code: "refresh_token_not_found", msg: "Invalid Refresh Token" }, 400);
    refreshTokens.delete(String(body.refresh_token));
    return json(session(u));
  }
  if (path === "/auth/v1/user" && req.method === "GET") {
    const c = caller(req);
    const u = c.role === "authenticated" ? await userById(String(c.claims["sub"])) : undefined;
    return u ? json(userJson(u)) : json({ code: "bad_jwt", msg: "invalid JWT" }, 401);
  }
  if (path === "/auth/v1/logout") return new Response(null, { status: 204, headers: cors });
  return json({ msg: "not supported by the local stand-in" }, 404);
}

// ---------------------------------------------------------------------------------------------- rest
async function handleTable(req: Request, table: string, url: URL): Promise<Response> {
  if (!IDENT.test(table)) return json({ message: "bad table" }, 400);
  const select = url.searchParams.get("select") ?? "*";
  const cols =
    select === "*"
      ? "*"
      : select
          .split(",")
          .map((c) => c.trim())
          .filter((c) => IDENT.test(c))
          .join(", ");
  const where: string[] = [];
  const params: unknown[] = [];
  let order = "";
  for (const [key, value] of url.searchParams) {
    if (key === "select") continue;
    if (key === "order") {
      order =
        " order by " +
        value
          .split(",")
          .map((o) => {
            const [col, dir] = o.split(".");
            if (!col || !IDENT.test(col)) throw new Error("bad order");
            return `${col} ${dir === "desc" ? "desc" : "asc"}`;
          })
          .join(", ");
      continue;
    }
    if (!IDENT.test(key) || !value.startsWith("eq."))
      return json({ message: `filter ${key}=${value} not supported by the local stand-in` }, 400);
    params.push(value.slice(3));
    where.push(`${key}::text = $${params.length}`);
  }
  const sql = `select ${cols} from public.${table}${where.length ? " where " + where.join(" and ") : ""}${order}`;
  try {
    return json(await asCaller(caller(req), async (tx) => (await tx.query(sql, params)).rows));
  } catch (e) {
    return pgError(e);
  }
}

type FnInfo = { retset: boolean; names: string[]; types: string[] };
async function fnInfo(name: string): Promise<FnInfo | undefined> {
  const r = await db.query<{
    retset: boolean;
    names: string[] | null;
    types: string[];
    nargs: number;
  }>(
    `select p.proretset as retset, p.proargnames as names, p.pronargs as nargs,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  const row = r.rows[0];
  return row
    ? { retset: row.retset, names: (row.names ?? []).slice(0, row.nargs), types: row.types }
    : undefined;
}

async function handleRpc(req: Request, fn: string): Promise<Response> {
  if (!IDENT.test(fn)) return json({ message: "bad function" }, 400);
  const info = await fnInfo(fn);
  if (!info)
    return json({ code: "PGRST202", message: `Could not find the function public.${fn}` }, 404);
  const args = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as Record<
    string,
    unknown
  >;
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(args)) {
    const i = info.names.indexOf(k);
    if (i < 0) return json({ code: "PGRST202", message: `public.${fn} has no argument ${k}` }, 404);
    params.push(v === null ? null : info.types[i] === "jsonb" ? JSON.stringify(v) : v);
    parts.push(`${k} => $${params.length}::${info.types[i]}`);
  }
  const call = `public.${fn}(${parts.join(", ")})`;
  try {
    const result = await asCaller(caller(req), async (tx) =>
      info.retset
        ? (await tx.query(`select * from ${call}`, params)).rows
        : ((await tx.query<{ r: unknown }>(`select ${call} as r`, params)).rows[0]?.r ?? null),
    );
    return json(result);
  } catch (e) {
    return pgError(e);
  }
}

// ----------------------------------------------------------------------------------------------- dev
async function devState() {
  const q = async <T>(sql: string) => (await db.query<T>(sql)).rows;
  return {
    now: (await q<{ now: string }>("select public.app_now()::text as now"))[0]?.now,
    matches: await q(
      "select match_no, round, p1_id, p2_id, starts_at::text, status, winner_id, set_scores from public.matches order by 1",
    ),
    mailbox: mailbox.slice(0, 10),
    billing: (await q<{ r: unknown }>("select public.billing_report() as r"))[0]?.r,
    alerts: await q(
      "select id, at::text, kind, detail from public.ops_alerts order by id desc limit 10",
    ),
    result_log: await q(
      "select id, match_no, outcome, note, fetched_at::text from public.result_log order by id desc limit 10",
    ),
  };
}
async function handleDev(req: Request, path: string): Promise<Response> {
  if (path === "/_dev" || path === "/_dev/") {
    return new Response(readFileSync(join(ROOT, "scripts", "dev-console.html"), "utf8"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (path === "/_dev/state") return json(await devState());
  if (path === "/_dev/clock" && req.method === "POST") {
    const { at } = (await req.json()) as { at: string };
    await db.query("select public.dev_set_now($1::timestamptz)", [at]);
    const polled = await pollAsService(db);
    return json({ ok: true, polled });
  }
  if (path === "/_dev/poll" && req.method === "POST")
    return json({ ok: true, polled: await pollAsService(db) });
  return json({ message: "unknown dev route" }, 404);
}

// The poller, every 15 seconds (the real one: every minute from pg_cron).
setInterval(() => {
  pollAsService(db).catch((e: Error) => console.error("[poller]", e.message));
}, 15_000);

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (path.startsWith("/auth/v1/")) return await handleAuth(req, path, url);
      if (path.startsWith("/rest/v1/rpc/"))
        return await handleRpc(req, path.slice("/rest/v1/rpc/".length));
      if (path.startsWith("/rest/v1/"))
        return await handleTable(req, path.slice("/rest/v1/".length), url);
      if (path.startsWith("/_dev")) return await handleDev(req, path);
      return json({ message: "not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ message: (e as Error).message }, 500);
    }
  },
});
console.log(
  `local stand-in on http://127.0.0.1:${PORT}  ·  operator console: http://127.0.0.1:${PORT}/_dev`,
);
