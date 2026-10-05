// Section L helpers for the REAL local stack (GoTrue + Mailpit + Postgres on 127.0.0.1:5532x).
// Local only: every URL is pinned to 127.0.0.1 and the test refuses anything else.
// Test users are always `l-<tag>@example.test` and are deleted by `cleanup()`.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const API = "http://127.0.0.1:55321";
export const MAILPIT = "http://127.0.0.1:55324";
export const DB_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
// The CLI's fixed local demo anon key (bunx supabase status -o json → ANON_KEY). Not a secret.
export const ANON_KEY =
  process.env["LOCAL_ANON_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const LIVE = process.env["L_LIVE"] === "1";

export const sql = LIVE ? new SQL(DB_URL) : (null as unknown as SQL);

export const client = (): SupabaseClient =>
  createClient(API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

export const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
export const addr = (tag: string) => `l-${tag}-${RUN}@example.test`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type MailSummary = { ID: string; Created: string; Snippet: string; To: { Address: string }[] };

/** All codes mailed to `email`, newest first. */
export async function codes(email: string): Promise<string[]> {
  const r = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  );
  const j = (await r.json()) as { messages: MailSummary[] };
  return j.messages
    .filter((m) => m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()))
    .sort((a, b) => b.Created.localeCompare(a.Created))
    .map((m) => /\b(\d{6})\b/.exec(m.Snippet)?.[1])
    .filter((c): c is string => !!c);
}

/** Wait until `email` has more than `already` codes; returns the newest. */
export async function nextCode(email: string, already: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const c = await codes(email);
    if (c.length > already) return c[0]!;
    await sleep(250);
  }
  throw new Error(`no new code for ${email}`);
}

/** Delete every auth user created by this run (cascades to the app tables). */
export async function cleanup() {
  if (!LIVE) return;
  await sql`delete from auth.users where email like ${`l-%-${RUN}@example.test`}`;
}

/**
 * The sign-in screen's own error mapper, lifted from src/routes/sign-in.tsx (not a copy: the source
 * is read and transpiled at test time, so the test follows the code).
 */
export function appAuthError(): (msg: string) => string {
  const src = readFileSync(
    join(import.meta.dir, "..", "..", "..", "src", "routes", "sign-in.tsx"),
    "utf8",
  );
  const start = src.indexOf("const authError = (msg: string) => {");
  const end = src.indexOf("\n  };", start);
  if (start < 0 || end < 0) throw new Error("authError not found in sign-in.tsx");
  const ts = src.slice(start, end + 4);
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(ts);
  return new Function("t", `${js}\nreturn authError;`)((k: string) => k) as (m: string) => string;
}
