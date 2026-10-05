// reminder-unsubscribe, the logic (brief "bragging rights", Phase 5). POST only: a GET never
// unsubscribes, because mail scanners open every link in an email. The user id and token come in the
// address (?u=…&t=…), both from the /unsubscribe page's button and from the mail app's one-click
// List-Unsubscribe-Post. A token that is not the HMAC of that user id gets 403.
import { checkUnsubToken } from "../_shared/unsubToken.ts";

export type UnsubDeps = {
  secret: string;
  /** reminders off for this user (public.unsubscribe_reminders); true when they were on */
  unsubscribe: (userId: string) => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
};
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function handleUnsubscribe(req: Request, deps: UnsubDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405,
      headers: { ...CORS, Allow: "POST", "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!UUID.test(u) || !(await checkUnsubToken(deps.secret, u, t))) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }
  await deps.unsubscribe(u);
  return json({ ok: true }, 200);
}
