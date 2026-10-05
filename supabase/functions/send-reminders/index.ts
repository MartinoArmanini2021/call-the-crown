// send-reminders — the night reminder emails (brief "bragging rights", Phase 5). Started every 5 minutes
// by pg_cron through public.kick_reminders (0022), the same way kick_poller starts poll-results: the
// service key from Vault, verified by the gateway (verify_jwt stays on). The logic is reminders.ts.
//
// Env: RESEND_API_KEY (missing = dry run: nothing is sent) · REMINDER_FROM (the sign-in emails' sender)
//      PUBLIC_APP_URL (e.g. https://callthecrown.example) · REMINDER_UNSUB_SECRET (the token key)
//      SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from "npm:@supabase/supabase-js@2";
import { resendSender, runReminders, type Candidate, type RemindersDb } from "./reminders.ts";

// Same guard as poll-results/index.ts: only the service role may run this.
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (decodeJwtRole(auth.startsWith("Bearer ") ? auth.slice(7).trim() : "") !== "service_role") {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const client = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const must = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  const db: RemindersDb = {
    candidates: async () => must(await client.rpc("reminder_candidates")) as Candidate[],
    timezone: async () =>
      (must(await client.from("event_config").select("timezone").single()) as { timezone: string }).timezone,
    claim: async (u, n, dry) =>
      must(await client.rpc("claim_reminder", { p_user: u, p_night: n, p_dry_run: dry })) as boolean,
    failed: async (u, n, detail) => {
      must(await client.rpc("reminder_failed", { p_user: u, p_night: n, p_detail: detail }));
    },
    heartbeat: async (ok, detail) => {
      must(await client.rpc("reminders_heartbeat", { p_ok: ok, p_detail: detail }));
    },
  };
  const apiKey = Deno.env.get("RESEND_API_KEY") || undefined;
  const from = Deno.env.get("REMINDER_FROM") ?? "";
  try {
    const summary = await runReminders(
      db,
      {
        apiKey,
        from,
        appUrl: Deno.env.get("PUBLIC_APP_URL") ?? "",
        functionsUrl: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`,
        secret: Deno.env.get("REMINDER_UNSUB_SECRET") ?? "",
      },
      apiKey ? resendSender(apiKey, from) : async () => {},
    );
    return json({ ok: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    await db.heartbeat(false, msg).catch(() => {});
    return json({ ok: false, error: msg }, 500);
  }
});
