// poll-results — the only way a match result enters the database.
// Started every minute by pg_cron (supabase/migrations/0009_cron_watchdog.sql) with the service key
// from Vault. On each run it fetches, through the configured provider adapter, every match that is in
// its window (from 15 minutes before its start until it is settled) or that the operator asked to
// re-fetch, and hands each payload to public.ingest_result. The database decides; this only carries.
//
// Env: PROVIDER = sportradar | fixture · SPORTRADAR_API_KEY · SPORTRADAR_ACCESS_LEVEL (trial|production)
//      SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
// Patterns from tennis-fantasy/supabase/functions/_shared/serviceGuard.ts and ingest-draw/index.ts
// (retry shield for cold 502/503/504s; a heartbeat written on failure too; readable error text).
import { createClient } from "npm:@supabase/supabase-js@2";
import { FixtureAdapter, type FixtureFile } from "./adapters/fixture.ts";
import { SportradarAdapter } from "./adapters/sportradar.ts";
import type { ResultsAdapter } from "./adapters/types.ts";
import { dueMatches } from "./due.ts";
import fixtureEvent from "./fixtures/event.json" with { type: "json" };

// Only the service role may run this. The gateway (verify_jwt, on by default) verifies the signature
// before this code runs, so the role claim can be trusted. Never turn verify_jwt off for this function.
function decodeJwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

// The database calls are safe to retry: reads, and ingest_result, whose settlement is idempotent
// (a repeated payload is logged again and reports "unchanged").
const RETRY_STATUS = new Set([502, 503, 504]);
const retryingFetch: typeof fetch = async (input, init) => {
  let lastRes: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 1500 * (attempt - 1)));
    try {
      const res = await fetch(input, init);
      if (!RETRY_STATUS.has(res.status)) return res;
      lastRes = res;
      await res.body?.cancel().catch(() => {});
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastRes) return lastRes;
  throw lastErr;
};

const errorText = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  const m = (err as { message?: unknown } | null)?.message;
  if (typeof m === "string" && m) return m;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

function makeAdapter(): ResultsAdapter {
  const provider = Deno.env.get("PROVIDER") ?? "";
  if (provider === "sportradar") {
    const key = Deno.env.get("SPORTRADAR_API_KEY");
    if (!key) throw new Error("SPORTRADAR_API_KEY is not set");
    const level = Deno.env.get("SPORTRADAR_ACCESS_LEVEL") === "trial" ? "trial" : "production";
    return new SportradarAdapter(key, level);
  }
  if (provider === "fixture") return new FixtureAdapter(fixtureEvent as FixtureFile);
  // No default: a silent fallback once re-processed a dead event in Grand Slam GM.
  throw new Error(`PROVIDER must be "sportradar" or "fixture", got "${provider}"`);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (decodeJwtRole(auth.startsWith("Bearer ") ? auth.slice(7).trim() : "") !== "service_role") {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    global: { fetch: retryingFetch },
    auth: { persistSession: false },
  });

  try {
    const adapter = makeAdapter();

    // The server's clock (the simulated one, locally), never this function's.
    const { data: now, error: clockErr } = await db.rpc("app_now");
    if (clockErr) throw clockErr;
    const nowMs = Date.parse(now as string);

    const { data: matches, error: mErr } = await db
      .from("matches")
      .select("match_no, starts_at, status, refetch_requested_at")
      .eq("status", "scheduled");
    if (mErr) throw mErr;
    const due = dueMatches(matches ?? [], nowMs);
    if (due.length === 0) {
      await db.rpc("ingest_heartbeat", { p_ok: true, p_detail: "no match in its window" });
      return json({ ok: true, polled: 0 });
    }

    const { data: refs, error: rErr } = await db
      .from("provider_map")
      .select("provider_ref, our_ref")
      .eq("provider", adapter.provider)
      .eq("kind", "match");
    if (rErr) throw rErr;
    const refFor = new Map((refs ?? []).map((r) => [Number(r.our_ref), r.provider_ref as string]));

    const outcomes: unknown[] = [];
    for (const m of due) {
      const ref = refFor.get(m.match_no);
      if (!ref) {
        outcomes.push({ match_no: m.match_no, outcome: "no provider id mapped" });
        await db.rpc("ingest_heartbeat", { p_ok: false, p_detail: `match ${m.match_no} has no ${adapter.provider} id in provider_map` });
        continue;
      }
      const fetched = await adapter.fetchMatch(ref);
      const { data, error } = await db.rpc("ingest_result", {
        p_provider: adapter.provider,
        p_normalised: fetched.normalised,
        p_raw: fetched.raw,
        p_http_status: fetched.http_status,
      });
      if (error) throw error;
      outcomes.push({ match_no: m.match_no, ...(data as object) });
      if (fetched.http_status >= 400) {
        await db.rpc("ingest_heartbeat", { p_ok: false, p_detail: `${adapter.provider} answered ${fetched.http_status} for match ${m.match_no}` });
      }
    }
    return json({ ok: true, polled: due.length, outcomes });
  } catch (err) {
    const msg = errorText(err);
    await db.rpc("ingest_heartbeat", { p_ok: false, p_detail: msg }).then(() => {}, () => {});
    return json({ ok: false, error: msg }, 500);
  }
});
